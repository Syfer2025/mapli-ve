import type { Vec2 } from "@theatrum/core-math";
import type * as PixiTypes from "pixi.js";
import {
  SLOT_IDS,
  type CapturedFrame,
  type NodeLayout,
  type NodeMatte,
  type ParticlesPrimitive,
  type RenderBackend,
  type SlotId,
  type SurfaceSet,
  type SymbolPrimitive,
  type VisualPrimitive,
} from "./contracts.js";
import { RendererError } from "./errors.js";
import { visualPlacement } from "./placement.js";
import {
  buildParticleGeometryData,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
} from "./particle-mesh.js";
import { destroyFilterChain, syncFilterChain, type FilterChain } from "./pixi-filter-chain.js";

type PixiModule = typeof PixiTypes;
type Application = PixiTypes.Application;
type Container = PixiTypes.Container;
type Graphics = PixiTypes.Graphics;
type Sprite = PixiTypes.Sprite;
type Text = PixiTypes.Text;
type Texture = PixiTypes.Texture;
type Mesh = PixiTypes.Mesh<PixiTypes.Geometry, PixiTypes.Shader>;

export interface PixiRenderBackendOptions {
  readonly preference?: "webgl2" | "webgpu";
}

interface PixiNode {
  readonly id: string;
  slot: SlotId;
  readonly root: Container;
  visual: Container | undefined;
  visualKind: VisualPrimitive["kind"] | undefined;
  label: Text | undefined;
  source: string | undefined;
  filterChain: FilterChain | undefined;
  /** Recorte pedido no último `update`. */
  matte: NodeMatte | undefined;
  /** `"${origem}:${modo}"` já aplicado, ou vazio. Evita remontar a máscara. */
  appliedMatte: string;
  /** `true` enquanto o nó serve de origem de recorte para algum outro. */
  matteSource: boolean;
}

/**
 * Adaptador Pixi carregado sob demanda. Importar `@theatrum/renderer` em Node
 * não toca DOM nem inicializa GPU; somente `init()` faz o import dinâmico.
 */
export function createPixiRenderBackend(options: PixiRenderBackendOptions = {}): RenderBackend {
  const preference = options.preference ?? "webgl2";
  const kind = preference;
  const nodes = new Map<string, PixiNode>();
  const slots = new Map<SlotId, Container>();
  let pixi: PixiModule | undefined;
  let app: Application | undefined;
  let size: Vec2 = [1, 1];
  let pixelRatio = 1;
  let state: "new" | "ready" | "disposed" = "new";

  function assertReady(): { readonly pixi: PixiModule; readonly app: Application } {
    if (state !== "ready" || pixi === undefined || app === undefined) {
      throw new RendererError("backend-state", `Backend Pixi não está pronto (${state}).`);
    }
    return { pixi, app };
  }

  function requireNode(nodeId: string): PixiNode {
    const node = nodes.get(nodeId);
    if (node === undefined) {
      throw new RendererError("backend-state", `Nó Pixi "${nodeId}" não está montado.`);
    }
    return node;
  }

  /**
   * Resolve os recortes depois que todos os nós já receberam `update`.
   *
   * Não pode ser feito dentro de `update`: o nó de origem costuma vir **depois**
   * na ordem de desenho — no After Effects o matte é a camada de cima — e naquele
   * momento ainda não está montado. Aqui o quadro está completo.
   */
  function reconcileMattes(): void {
    const isSource = new Set<string>();
    for (const node of nodes.values()) {
      if (node.matte !== undefined && nodes.has(node.matte.source)) isSource.add(node.matte.source);
    }

    for (const node of nodes.values()) {
      const serving = isSource.has(node.id);
      if (serving === node.matteSource) continue;
      node.matteSource = serving;
      // Ao deixar de servir de origem o nó volta a ser desenhado por conta
      // própria: o Pixi tira `includeInBuild` ao montar a máscara e o `reset()`
      // dele não devolve. Sem isto o nó desapareceria para sempre.
      if (!serving) {
        node.root.includeInBuild = true;
        node.root.renderable = true;
        node.root.measurable = true;
      }
    }

    for (const node of nodes.values()) {
      const source = node.matte === undefined ? undefined : nodes.get(node.matte.source);
      const wanted =
        node.matte === undefined || source === undefined
          ? ""
          : `${node.matte.source}:${node.matte.mode}`;
      if (wanted === node.appliedMatte) continue;
      node.appliedMatte = wanted;

      if (node.matte === undefined || source === undefined) {
        // Origem ausente do frame: o nó volta a desenhar inteiro. Avisar é
        // responsabilidade de quem monta a cena; o frame não pode sumir.
        node.root.setMask({ mask: null });
        continue;
      }
      node.root.setMask({
        mask: source.root,
        /**
         * `alpha` lê a transparência da origem; `red`, o canal vermelho dela — que
         * é o que o Pixi oferece de mais próximo de brilho.
         *
         * A tentativa anterior foi converter luminância Rec. 709 em alfa com um
         * passe próprio na cadeia da origem. Não funciona: ao montar a máscara o
         * Pixi deixa o contêiner com `measurable = false`, e o sistema de filtros
         * descarta um passe cujo alvo não tem área — o filtro não roda e o matte
         * de luma se comporta como o de alfa, em silêncio. O canal vermelho é
         * caminho suportado e reage ao brilho; o preço é medir só um canal, o que
         * subestima o verde. Para matte em tons de cinza — o caso normal — dá o
         * mesmo resultado. Ver docs/08-ROADMAP.md § Fase 6.
         */
        channel: node.matte.mode.startsWith("luma") ? "red" : "alpha",
        inverse: node.matte.mode.endsWith("-inverted"),
      });
    }
  }

  return {
    kind,

    async init(surfaces: SurfaceSet): Promise<void> {
      if (state !== "new") {
        throw new RendererError("backend-state", `init() inválido no estado "${state}".`);
      }
      const canvas = surfaces.overlay.native;
      if (!isCanvas(canvas)) {
        throw new RendererError(
          "invalid-surface",
          "O backend Pixi requer `surfaces.overlay.native` com uma superfície canvas.",
        );
      }

      /**
       * O CSP do Electron proíbe `unsafe-eval`. Apesar do nome histórico do
       * entrypoint, este módulo instala justamente os geradores interpretados
       * que evitam `new Function`/eval no Pixi.
       */
      await import("pixi.js/unsafe-eval");
      const module = await import("pixi.js");
      const application = new module.Application();
      await application.init({
        canvas,
        width: size[0],
        height: size[1],
        resolution: pixelRatio,
        autoDensity: true,
        antialias: true,
        backgroundAlpha: 0,
        autoStart: false,
        sharedTicker: false,
        preference: preference === "webgpu" ? "webgpu" : "webgl",
        powerPreference: "high-performance",
      });

      for (const slot of SLOT_IDS) {
        const container = new module.Container({ label: `theatrum:${slot}` });
        slots.set(slot, container);
        application.stage.addChild(container);
      }

      pixi = module;
      app = application;
      state = "ready";
    },

    resize(nextSize: Vec2, nextPixelRatio: number): void {
      const ready = assertReady();
      size = [nextSize[0], nextSize[1]];
      pixelRatio = nextPixelRatio;
      ready.app.renderer.resize(nextSize[0], nextSize[1], nextPixelRatio);
    },

    mount(nodeId: string, slot: SlotId): void {
      const ready = assertReady();
      if (nodes.has(nodeId)) {
        throw new RendererError("backend-state", `Nó Pixi "${nodeId}" já está montado.`);
      }
      const root = new ready.pixi.Container({ label: `node:${nodeId}` });
      const target = slots.get(slot);
      if (target === undefined) {
        throw new RendererError("backend-state", `Container do slot "${slot}" não existe.`);
      }
      target.addChild(root);
      nodes.set(nodeId, {
        id: nodeId,
        slot,
        root,
        visual: undefined,
        visualKind: undefined,
        label: undefined,
        source: undefined,
        filterChain: undefined,
        matte: undefined,
        appliedMatte: "",
        matteSource: false,
      });
    },

    move(nodeId: string, slot: SlotId): void {
      assertReady();
      const node = requireNode(nodeId);
      if (node.slot === slot) return;
      const target = slots.get(slot);
      if (target === undefined) {
        throw new RendererError("backend-state", `Container do slot "${slot}" não existe.`);
      }
      node.root.removeFromParent();
      target.addChild(node.root);
      node.slot = slot;
    },

    update(nodeId: string, visual: VisualPrimitive, layout: NodeLayout): void {
      const ready = assertReady();
      const node = requireNode(nodeId);
      node.root.setFromMatrix(new ready.pixi.Matrix(...layout.matrix));
      node.root.alpha = clamp01(layout.opacity);
      node.root.visible = layout.visible;
      node.root.blendMode = normalizeBlendMode(layout.blendMode);

      // A cadeia troca de objeto só quando a lista de tipos muda; caso contrário
      // `syncFilterChain` devolve a mesma instância com uniforms novos, e atribuir
      // o mesmo array ao contêiner não custa nada.
      node.matte = layout.matte;
      const chain = syncFilterChain(ready.pixi, node.filterChain, layout.filters);
      if (chain !== node.filterChain) {
        destroyFilterChain(node.filterChain);
        node.filterChain = chain;
        node.root.filters = chain === undefined ? [] : [...chain.filters];
      }

      ensureVisual(ready.pixi, node, visual);
      updateVisual(ready.pixi, node, visual, layout);
    },

    unmount(nodeId: string): void {
      assertReady();
      const node = requireNode(nodeId);
      nodes.delete(nodeId);
      node.root.filters = [];
      destroyFilterChain(node.filterChain);
      node.filterChain = undefined;
      // Quem usava este nó como recorte precisa soltar a máscara agora: guardar
      // referência a um contêiner destruído travaria o próximo frame.
      if (node.appliedMatte !== "") {
        node.root.setMask({ mask: null });
        node.appliedMatte = "";
      }
      for (const other of nodes.values()) {
        if (other.matte?.source !== nodeId || other.appliedMatte === "") continue;
        other.root.setMask({ mask: null });
        other.appliedMatte = "";
      }
      node.root.removeFromParent();
      node.root.destroy({ children: true });
    },

    setOrder(slot: SlotId, nodeIds: readonly string[]): void {
      assertReady();
      const target = slots.get(slot);
      if (target === undefined) {
        throw new RendererError("backend-state", `Container do slot "${slot}" não existe.`);
      }

      target.removeChildren();
      for (const nodeId of nodeIds) {
        const node = requireNode(nodeId);
        if (node.slot !== slot) {
          throw new RendererError(
            "backend-state",
            `Nó "${nodeId}" pertence a "${node.slot}", não a "${slot}".`,
          );
        }
        target.addChild(node.root);
      }
    },

    composite(order: readonly SlotId[]): void {
      const ready = assertReady();
      reconcileMattes();
      ready.app.stage.removeChildren();
      for (const slot of order) {
        const target = slots.get(slot);
        if (target !== undefined) ready.app.stage.addChild(target);
      }
      ready.app.render();
    },

    async capture(): Promise<CapturedFrame> {
      const ready = assertReady();
      ready.app.render();
      const output = ready.app.renderer.extract.pixels({
        target: ready.app.stage,
        frame: new ready.pixi.Rectangle(0, 0, size[0], size[1]),
        resolution: pixelRatio,
      });
      const data = new Uint8Array(
        output.pixels.buffer.slice(
          output.pixels.byteOffset,
          output.pixels.byteOffset + output.pixels.byteLength,
        ),
      );
      return {
        width: output.width,
        height: output.height,
        pixelRatio,
        encoding: "rgba8",
        data,
      };
    },

    dispose(): void {
      if (state === "disposed") return;
      for (const node of nodes.values()) destroyFilterChain(node.filterChain);
      nodes.clear();
      slots.clear();
      app?.destroy(false, { children: true, context: true });
      app = undefined;
      pixi = undefined;
      state = "disposed";
    },
  };
}

function ensureVisual(module: PixiModule, node: PixiNode, visual: VisualPrimitive): void {
  if (node.visualKind === visual.kind) return;

  node.visual?.removeFromParent();
  node.visual?.destroy();
  node.label?.removeFromParent();
  node.label?.destroy();
  node.visual = undefined;
  node.label = undefined;
  node.source = undefined;
  node.visualKind = visual.kind;

  switch (visual.kind) {
    case "none":
      return;
    case "text":
      node.visual = new module.Text();
      break;
    case "image":
      node.visual = new module.Sprite(module.Texture.EMPTY);
      break;
    case "line":
    case "polygon":
    case "circle":
    case "symbol":
      node.visual = new module.Graphics();
      break;
    case "particles":
      node.visual = createParticleMesh(module, visual);
      node.source = visual.bufferId;
      break;
  }

  if (node.visual !== undefined) node.root.addChild(node.visual);
}

function updateVisual(
  module: PixiModule,
  node: PixiNode,
  visual: VisualPrimitive,
  layout: NodeLayout,
): void {
  const placement = visualPlacement(visual, layout.size);
  switch (visual.kind) {
    case "none":
      return;

    case "text": {
      const text = node.visual as Text;
      text.text = visual.text;
      text.style.fontFamily = visual.fontFamily;
      text.style.fontSize = visual.fontSize;
      text.style.fontWeight = visual.fontWeight;
      text.style.fill = visual.color;
      text.style.align = visual.align;
      text.anchor.set(placement.anchor[0], placement.anchor[1]);
      text.position.set(placement.position[0], placement.position[1]);
      return;
    }

    case "image": {
      const sprite = node.visual as Sprite;
      if (node.source !== visual.source) {
        node.source = visual.source;
        sprite.texture = cachedTexture(module, visual.source);
      }
      sprite.tint = visual.tint;
      sprite.anchor.set(placement.anchor[0], placement.anchor[1]);
      sprite.position.set(placement.position[0], placement.position[1]);
      sprite.width = layout.size[0];
      sprite.height = layout.size[1];
      return;
    }

    case "line": {
      const graphics = node.visual as Graphics;
      graphics.clear();
      graphics.position.set(placement.position[0], placement.position[1]);
      const first = visual.points[0];
      if (first === undefined) return;
      graphics.moveTo(first[0], first[1]);
      for (let index = 1; index < visual.points.length; index += 1) {
        const point = visual.points[index];
        if (point !== undefined) graphics.lineTo(point[0], point[1]);
      }
      graphics.stroke({ color: visual.color, width: visual.width });
      return;
    }

    case "polygon": {
      const graphics = node.visual as Graphics;
      graphics.clear();
      graphics.position.set(placement.position[0], placement.position[1]);
      graphics.poly(flattenPoints(visual.points), true);
      if (visual.fillAlpha > 0) {
        graphics.fill({ color: visual.fill, alpha: visual.fillAlpha });
      }
      if (visual.strokeWidth > 0) {
        graphics.stroke({ color: visual.stroke, width: visual.strokeWidth });
      }
      return;
    }

    case "circle": {
      const graphics = node.visual as Graphics;
      graphics.clear();
      graphics.position.set(placement.position[0], placement.position[1]);
      graphics.circle(0, 0, visual.radius);
      if (visual.fillAlpha > 0) {
        graphics.fill({ color: visual.fill, alpha: visual.fillAlpha });
      }
      if (visual.strokeWidth > 0) {
        graphics.stroke({ color: visual.stroke, width: visual.strokeWidth });
      }
      return;
    }

    case "symbol": {
      const graphics = node.visual as Graphics;
      graphics.clear();
      graphics.position.set(placement.position[0], placement.position[1]);
      drawSymbol(graphics, visual);
      updateSymbolLabel(module, node, visual, placement.position);
      return;
    }

    case "particles": {
      const mesh = node.visual as Mesh;
      // Só o uniform muda entre frames. Se o buffer trocou de identidade, o
      // visual é recriado no caminho de criação, não aqui.
      const uniforms = particleUniformsOf(mesh);
      if (uniforms !== undefined) {
        uniforms["uFrame"] = visual.frame;
        uniforms["uOpacity"] = visual.opacity;
        uniforms["uFade"] = FADE_CODES[visual.fade];
        uniforms["uWobble"] = visual.wobble;
        uniforms["uWobbleOmega"] = (visual.wobbleHz * 2 * Math.PI) / Math.max(1, visual.fps);
        uniforms["uDrift"] = visual.drift ? 1 : 0;
      }
      mesh.position.set(placement.position[0], placement.position[1]);
      mesh.blendMode =
        visual.blend === "add" ? "add" : visual.blend === "screen" ? "screen" : "normal";
      return;
    }
  }
}

const FADE_CODES: Readonly<Record<ParticlesPrimitive["fade"], number>> = Object.freeze({
  out: 0,
  "in-out": 1,
  flash: 2,
  hold: 3,
});

/**
 * Malha de partículas: geometria estática mais um shader cujo único parâmetro
 * variável é o frame. Um material, um draw call.
 */
function createParticleMesh(module: PixiModule, visual: ParticlesPrimitive): Mesh {
  const geometryData = buildParticleGeometryData(visual);
  const geometry = new module.Geometry({
    attributes: {
      aCorner: { buffer: geometryData.corner, format: "float32x2" },
      aBirth: { buffer: geometryData.birth, format: "float32x4" },
      aMotion: { buffer: geometryData.motion, format: "float32x4" },
      aShape: { buffer: geometryData.shape, format: "float32x4" },
      aTint: { buffer: geometryData.tint, format: "float32x4" },
    },
    indexBuffer: geometryData.indices,
  });
  const uniforms = new module.UniformGroup({
    uFrame: { value: visual.frame, type: "f32" },
    uOpacity: { value: visual.opacity, type: "f32" },
    uFade: { value: FADE_CODES[visual.fade], type: "i32" },
    uWobble: { value: visual.wobble, type: "f32" },
    uWobbleOmega: {
      value: (visual.wobbleHz * 2 * Math.PI) / Math.max(1, visual.fps),
      type: "f32",
    },
    uDrift: { value: visual.drift ? 1 : 0, type: "i32" },
  });
  const shader = module.Shader.from({
    gl: { vertex: PARTICLE_VERTEX_SHADER, fragment: PARTICLE_FRAGMENT_SHADER },
    resources: { particleUniforms: uniforms },
  });
  return new module.Mesh({ geometry, shader });
}

function particleUniformsOf(mesh: Mesh): Record<string, number> | undefined {
  const group = mesh.shader?.resources["particleUniforms"] as
    { readonly uniforms: Record<string, number> } | undefined;
  return group?.uniforms;
}

function drawSymbol(graphics: Graphics, visual: SymbolPrimitive): void {
  const half = visual.size / 2;
  switch (visual.shape) {
    case "square":
      graphics.rect(-half, -half, visual.size, visual.size);
      break;
    case "diamond":
      graphics.poly([0, -half, half, 0, 0, half, -half, 0], true);
      break;
    case "triangle":
      graphics.poly([0, -half, half, half, -half, half], true);
      break;
    case "circle":
      graphics.circle(0, 0, half);
      break;
  }
  graphics.fill({ color: visual.fill });
  if (visual.strokeWidth > 0) {
    graphics.stroke({ color: visual.stroke, width: visual.strokeWidth });
  }
}

function updateSymbolLabel(
  module: PixiModule,
  node: PixiNode,
  visual: SymbolPrimitive,
  position: Vec2,
): void {
  if (visual.label.length === 0) {
    node.label?.removeFromParent();
    node.label?.destroy();
    node.label = undefined;
    return;
  }

  const label = node.label ?? new module.Text();
  if (node.label === undefined) {
    node.label = label;
    node.root.addChild(label);
  }
  label.text = visual.label;
  label.style.fontFamily = "Open Sans";
  label.style.fontSize = Math.max(8, visual.size * 0.28);
  label.style.fontWeight = "bold";
  label.style.fill = visual.labelColor;
  label.anchor.set(0.5);
  label.position.set(position[0], position[1]);
}

function cachedTexture(module: PixiModule, source: string): Texture {
  if (source.length === 0 || !module.Assets.cache.has(source)) return module.Texture.EMPTY;
  const cached: unknown = module.Assets.cache.get(source);
  return cached instanceof module.Texture ? cached : module.Texture.EMPTY;
}

function flattenPoints(points: readonly Vec2[]): number[] {
  const flat: number[] = [];
  for (const point of points) flat.push(point[0], point[1]);
  return flat;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function normalizeBlendMode(value: string): Container["blendMode"] {
  const supported = [
    "normal",
    "add",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ] as const;
  return supported.some((mode) => mode === value) ? (value as Container["blendMode"]) : "normal";
}

function isCanvas(value: unknown): value is HTMLCanvasElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "getContext" in value &&
    typeof value.getContext === "function"
  );
}
