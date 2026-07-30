import { evaluate, type EvaluatedScene } from "@theatrum/animation";
import {
  applySceneBehaviors,
  createBuiltinBehaviorRegistry,
  expandLiveActions,
  pathGeometry,
  pointAt,
  type ActionDiagnostic,
  type BehaviorDiagnostic,
} from "@theatrum/behaviors";
import { mat2d, rect, type Mat2D, type Rect, type Vec2 } from "@theatrum/core-math";
import {
  createPixiRenderBackend,
  createRenderer,
  createScreenScene,
  EXPORT_SLOT_ORDER,
  PREVIEW_SLOT_ORDER,
  registerBuiltinRenderables,
  RenderableRegistry,
  type CapturedFrame,
  type Renderer,
  type ScreenScene as RendererScreenScene,
} from "@theatrum/renderer";
import { layoutScene, type ScreenScene as LayoutScreenScene } from "@theatrum/scene-graph";
import type { Composition, PathData } from "@theatrum/schema";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { editorEffectRegistry } from "../../plugins/editor-plugin-runtime.js";
import {
  clearRuntimeExpressionDiagnostics,
  publishRuntimeExpressionDiagnostics,
} from "../../diagnostics/runtime-diagnostics.js";
import { Button } from "../../ui/index.js";
import { createMapLibreProjectorPort } from "./maplibre-adapters.js";
import {
  collectModel3dNodes,
  collectRoute3dNodes,
  scene3dLayerPending,
  syncScene3dLayer,
} from "./scene3d-layer.js";
import { activeStudioPendingModels } from "./studio-scene.js";
import { expandGeoNodes, type GeoExpansion, type GeoViewport } from "./geo-nodes.js";
import { expandCalloutNodes, type CalloutExpansion } from "./callout-nodes.js";
import { expandRouteNodes, type RouteExpansion } from "./route-nodes.js";
import { activeActionCameraCenter } from "./action-camera.js";
import { drawCompositionFrame } from "./composition-frame.js";
import {
  startDebugExport,
  type DebugExportOptions,
  type StartExportResult,
} from "../../export/export-service.js";
import { bindExportViewport } from "../../export/export-controller.js";
import { applyOverrideToElement, useExportSurface } from "../../export/useExportSurface.js";
import { effectivePixelRatio, surfaceMatches } from "../../export/surface-override.js";
import {
  previewPixelRatioForSize,
  usePreviewSupersampling,
} from "../../export/preview-supersampling.js";
import { onGeoLayerLoaded } from "../../geo/geo-data.js";
import { expandParticleEffects, type ParticleExpansion } from "./particle-nodes.js";
import {
  addVertex,
  canCommit,
  dragHandle,
  EMPTY_PEN,
  endDrag,
  penDocumentVertices,
  penPolyline,
  removeLastVertex,
  type PenState,
} from "./pen-tool.js";
import {
  hitTestLayouts,
  marqueeLayouts,
  rectFromDrag,
  transformFromDrag,
  type GizmoMode,
  type TransformSnapshot,
} from "./viewport-interactions.js";

interface SceneOverlayProps {
  readonly map: MapLibreMap | null;
  /** Muda em todo movimento de câmera e força layout no mesmo frame do mapa. */
  readonly cameraRevision: number;
}

interface RenderMetrics {
  readonly evaluateMs: number;
  readonly layoutMs: number;
  readonly renderMs: number;
  readonly totalMs: number;
}

interface ProjectedPath {
  readonly id: string;
  readonly name: string;
  readonly points: readonly Vec2[];
  readonly vertices: readonly Vec2[];
}

/**
 * Caixa visível e zoom, do mapa para o passe geográfico.
 *
 * A caixa ganha folga de dez por cento: descartar exatamente na borda faria o
 * território piscar ao entrar em cena, e um contorno que aparece atrasado é pior
 * que um projetado a mais.
 */
function geoViewportOf(map: MapLibreMap): GeoViewport {
  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const padX = Math.abs(east - west) * 0.1;
  const padY = Math.abs(north - south) * 0.1;
  return {
    zoom: map.getZoom(),
    bounds: {
      west: west - padX,
      east: east + padX,
      south: south - padY,
      north: north + padY,
    },
  };
}

/**
 * Sobrepõe as caixas reais dos nós geográficos no layout.
 *
 * O estágio de layout roda antes da projeção da malha, então mede o tamanho
 * padrão do nó. Quem sabe a extensão do contorno é o passe geográfico, e é depois
 * dele que o frame ganha um layout utilizável para clique e gizmo.
 *
 * A matriz recebe o mesmo remendo do passe: os anéis são relativos à âncora,
 * então o pivot `anchorPoint × tamanho` aplicado pelo layout genérico tem de ser
 * devolvido — senão gizmo e hit-test apontam para a geometria deslocada.
 */
function withGeoBounds(
  layout: LayoutScreenScene,
  bounds: ReadonlyMap<string, Rect>,
  evaluated: EvaluatedScene,
): LayoutScreenScene {
  if (bounds.size === 0) return layout;
  const layouts = new Map(layout.layouts);
  for (const [nodeId, box] of bounds) {
    const current = layouts.get(nodeId);
    if (current === undefined) continue;
    const anchorPoint = evaluated.nodes.get(nodeId)?.transform.anchorPoint ?? [0, 0];
    layouts.set(nodeId, {
      ...current,
      matrix: mat2d.multiply(
        current.matrix,
        mat2d.translate(
          (anchorPoint[0] ?? 0) * current.sizePx[0],
          (anchorPoint[1] ?? 0) * current.sizePx[1],
        ),
      ),
      bounds: box,
      sizePx: [box.width, box.height],
      // O passe só devolve caixa para nó que desenhou, então ele não está culled.
      culled: false,
    });
  }
  return { ...layout, layouts };
}

interface OverlayFrame {
  readonly composition: Composition;
  readonly evaluated: EvaluatedScene;
  readonly layout: LayoutScreenScene;
  readonly screen: RendererScreenScene;
  readonly actions: readonly ActionDiagnostic[];
  readonly actionNodes: number;
  readonly actionKeyframes: number;
  readonly behaviors: readonly BehaviorDiagnostic[];
  readonly effects: ParticleExpansion["diagnostics"];
  readonly particleNodes: number;
  readonly particles: number;
  readonly filters: number;
  readonly mattes: number;
  readonly geo: Omit<GeoExpansion, "scene">;
  readonly callouts: Omit<CalloutExpansion, "scene">;
  readonly routes: Omit<RouteExpansion, "scene" | "pathIds" | "bounds">;
  readonly paths: readonly ProjectedPath[];
  readonly metrics: RenderMetrics;
}

type Interaction =
  | {
      readonly kind: "marquee";
      readonly start: Vec2;
      current: Vec2;
      readonly additive: boolean;
      readonly contained: boolean;
    }
  | {
      readonly kind: "transform";
      readonly nodeId: string;
      readonly start: Vec2;
      current: Vec2;
      readonly center: Vec2;
      readonly initial: TransformSnapshot;
      readonly mode: GizmoMode;
    };

interface OverlayController {
  readonly renderer: Renderer;
  dispose(): void;
}

interface CachedController {
  refs: number;
  readonly promise: Promise<OverlayController>;
  disposeTimer: number | null;
}

interface ControllerLease {
  readonly controller: Promise<OverlayController>;
  release(): void;
}

const controllers = new WeakMap<HTMLCanvasElement, CachedController>();

const READY_STATUS = "Pixi · WebGL2";

/** Um registry por renderer: comportamentos e efeitos são puros e sem estado. */
const behaviorRegistry = createBuiltinBehaviorRegistry();
const effectRegistry = editorEffectRegistry;

/**
 * O cache com descarte adiado torna a inicialização WebGL segura sob React
 * StrictMode: o cleanup de verificação é seguido imediatamente por um segundo
 * acquire e não destrói um contexto que ainda está sendo criado.
 */
function acquireController(canvas: HTMLCanvasElement): ControllerLease {
  let cached = controllers.get(canvas);
  if (cached === undefined) {
    const registry = new RenderableRegistry();
    const builtins = registerBuiltinRenderables(registry);
    const renderer = createRenderer({
      backend: createPixiRenderBackend({ preference: "webgl2" }),
      registry,
      missingRenderable: "skip",
    });
    const promise = renderer.init({ overlay: { native: canvas } }).then(
      () =>
        ({
          renderer,
          dispose(): void {
            renderer.dispose();
            builtins.dispose();
          },
        }) satisfies OverlayController,
    );
    cached = { refs: 0, promise, disposeTimer: null };
    controllers.set(canvas, cached);
  }

  // `entry` fixa a narrowing dentro da closure de `release`.
  const entry = cached;
  entry.refs += 1;
  if (entry.disposeTimer !== null) {
    window.clearTimeout(entry.disposeTimer);
    entry.disposeTimer = null;
  }
  let released = false;
  return {
    controller: entry.promise,
    release(): void {
      if (released) return;
      released = true;
      entry.refs -= 1;
      entry.disposeTimer = window.setTimeout(() => {
        if (entry.refs > 0) return;
        controllers.delete(canvas);
        void entry.promise.then((controller) => controller.dispose()).catch(() => undefined);
      }, 0);
    },
  };
}

export function SceneOverlay({ map, cameraRevision }: SceneOverlayProps): ReactNode {
  const session = useEditorSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const pixiCanvasRef = useRef<HTMLCanvasElement>(null);
  const uiCanvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * O mapa por referência, não por closure.
   *
   * A superfície de depuração é montada num efeito de dependências vazias, e
   * naquele instante o mapa ainda é nulo — capturá-lo ali deixava o export
   * respondendo "mapa indisponível" para sempre.
   */
  const mapRef = useRef<MapLibreMap | null>(null);
  const leaseRef = useRef<ControllerLease | null>(null);
  const frameRef = useRef<OverlayFrame | null>(null);
  const sessionRef = useRef(session);
  const gizmoModeRef = useRef<GizmoMode>("position");
  const interactionRef = useRef<Interaction | null>(null);
  const renderGenerationRef = useRef(0);
  const renderCountRef = useRef(0);
  const penRef = useRef<PenState | null>(null);
  const [surfaceSize, setSurfaceSize] = useState<Vec2>([1, 1]);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("position");
  const [penState, setPenState] = useState<PenState | null>(null);
  const [rendererStatus, setRendererStatus] = useState("preparando GPU…");
  /** Incrementa quando uma camada geográfica chega, para refazer o frame. */
  const [geoRevision, setGeoRevision] = useState(0);
  const previewSupersampling = usePreviewSupersampling();
  const previewPixelRatio = previewPixelRatioForSize(
    window.devicePixelRatio,
    previewSupersampling,
    surfaceSize[0],
    surfaceSize[1],
  );

  sessionRef.current = session;
  gizmoModeRef.current = gizmoMode;
  mapRef.current = map;

  /**
   * O overlay acompanha o mapa no tamanho de export ([ADR-022](../../../../../docs/adr/ADR-022-export-resolution-from-composition.md)).
   *
   * A raiz `.scene-overlay` é posicionada sobre o mapa, então ela precisa do mesmo
   * tamanho de CSS — senão o Pixi fica no tamanho do painel e a composição
   * estica um sobre o outro sem erro nenhum. O canvas Pixi em si não é tocado
   * aqui: quem o dimensiona é a `ScreenScene`, pelo `pixelRatio` abaixo.
   */
  const exportOverride = useExportSurface(
    "map-overlay",
    (override) => {
      applyOverrideToElement(rootRef.current, override);
    },
    // **Este é o predicado que a regressão do critério 6 cobrou.** O mapa
    // redimensiona de forma síncrona em `map.resize()`; o Pixi só chega ao tamanho
    // novo depois de `ResizeObserver` → `setState` → efeito de render. Confirmar
    // antes disso deixava o compositor esticar um overlay de 2360×800 dentro de um
    // frame de 1920×1080 — plausível, e diferente entre execuções.
    (override) => surfaceMatches(override, pixiCanvasRef.current),
  );

  /**
   * Anuncia mapa e sonda ao controlador de export.
   *
   * A sonda é lida por **função**, não por valor: o painel de fila e o motor
   * consultam a cada volta do laço, e um valor congelado no momento do bind
   * faria o `settle` esperar para sempre uma repintura que já aconteceu.
   */
  useEffect(() => {
    if (map === null) return;
    return bindExportViewport({
      map,
      probe: () => ({
        frame: frameRef.current?.screen.frame ?? -1,
        renders: renderCountRef.current,
        // GLB em parse é trabalho pendente que o settle precisa ver: a camada
        // 3D do mapa e o palco do estúdio. Erro de carga conta como resolvido
        // lá dentro — senão um modelo quebrado travaria o export no timeout.
        pendingAssets: scene3dLayerPending(map) + activeStudioPendingModels(),
      }),
    });
  }, [map]);

  const updatePen = useCallback((next: PenState | null): void => {
    penRef.current = next;
    setPenState(next);
    drawUi(
      uiCanvasRef.current,
      frameRef.current,
      sessionRef.current.selectedNodeIds,
      gizmoModeRef.current,
      interactionRef.current,
      next,
    );
  }, []);

  /**
   * Grava o caminho desenhado. Cada handle vira deslocamento em graus pela
   * diferença entre o ponto absoluto desprojetado e o vértice desprojetado — a
   * conversão direta de um offset em pixels para graus seria errada, porque a
   * escala muda com a latitude e com a rotação da câmera.
   */
  const commitPen = useCallback((): string | null => {
    const pen = penRef.current;
    if (pen === null || map === null || !canCommit(pen)) {
      updatePen(null);
      return null;
    }
    const vertices = penDocumentVertices(pen).map((vertex) => {
      const anchor = map.unproject([vertex.point[0], vertex.point[1]]);
      const offset = (handle: Vec2 | null): [number, number] | null => {
        if (handle === null) return null;
        const projected = map.unproject([handle[0], handle[1]]);
        return [projected.lng - anchor.lng, projected.lat - anchor.lat];
      };
      return {
        point: [anchor.lng, anchor.lat] as [number, number],
        inHandle: offset(vertex.inHandle),
        outHandle: offset(vertex.outHandle),
      };
    });
    const count = Object.keys(sessionRef.current.document.paths).length + 1;
    const pathId = editorActions.createPath({
      name: `Caminho ${count}`,
      space: "geo",
      vertices,
      interpolation: "bezier",
    });
    updatePen(null);
    return pathId;
  }, [map, updatePen]);

  useEffect(() => {
    const canvas = pixiCanvasRef.current;
    if (canvas === null) return;
    const lease = acquireController(canvas);
    leaseRef.current = lease;
    let active = true;
    void lease.controller
      .then(() => {
        if (active) setRendererStatus(READY_STATUS);
      })
      .catch((error: unknown) => {
        if (active) {
          setRendererStatus(
            `GPU indisponível · ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    return () => {
      active = false;
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.release();
    };
  }, []);

  useEffect(() => {
    if (map === null) return;
    // Mede o canvas do MapLibre, não `getCanvasContainer()`: o container tem
    // altura 0 no layout e o espaço de pixels que `map.project()` devolve é
    // exatamente o do canvas.
    const surface = map.getCanvas();
    const updateSize = (): void => {
      const width = Math.max(1, Math.round(surface.clientWidth));
      const height = Math.max(1, Math.round(surface.clientHeight));
      setSurfaceSize((current) =>
        current[0] === width && current[1] === height ? current : [width, height],
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    const lease = leaseRef.current;
    if (map === null || lease === null || surfaceSize[0] <= 1 || surfaceSize[1] <= 1) {
      return;
    }
    // O canvas do MapLibre ainda pode estar com 0 px enquanto o mapa inicializa,
    // e nesse instante a porta de projeção recusa a snapshot. Pular o frame é o
    // certo: um render a mais chega logo, e mostrar "falha" seria mentira.
    const surface = map.getCanvas();
    if (surface.clientWidth <= 1 || surface.clientHeight <= 1) return;
    const composition = session.document.compositions.find(
      (candidate) => candidate.id === session.selectedCompositionId,
    );
    if (composition === undefined) return;
    const generation = ++renderGenerationRef.current;
    let active = true;

    void lease.controller
      .then(({ renderer }) => {
        if (!active || generation !== renderGenerationRef.current) return;
        const startedAt = performance.now();
        // Actions viram um documento derivado com nós/comportamentos/keyframes
        // normais. O bake persiste exatamente a mesma expansão, então live e
        // materializado não têm duas implementações visuais para divergir.
        const actions = expandLiveActions(session.document, composition.id);
        const renderComposition =
          actions.document.compositions.find((entry) => entry.id === composition.id) ?? composition;
        // `evaluate` é puro e não conhece comportamentos (L2 não pode importar
        // L3); o passe de comportamentos roda depois sobre o documento já
        // expandido pelas Actions.
        const pass = applySceneBehaviors(
          evaluate(actions.document, composition.id, session.playheadFrame),
          actions.document,
          composition.id,
          { registry: behaviorRegistry },
        );
        const evaluated = pass.scene;
        publishRuntimeExpressionDiagnostics(
          "map",
          composition.id,
          evaluated.frame,
          evaluated.diagnostics,
        );
        const actionCamera = activeActionCameraCenter(evaluated, actions.expansions);
        if (actionCamera !== null) {
          const current = map.getCenter();
          if (
            Math.abs(current.lng - actionCamera[0]) > 0.000_001 ||
            Math.abs(current.lat - actionCamera[1]) > 0.000_001
          ) {
            map.jumpTo({ center: [actionCamera[0], actionCamera[1]] });
          }
        }
        const evaluatedAt = performance.now();
        const projector = createMapLibreProjectorPort(map);
        const compToScreen = compositionToViewport(composition, surfaceSize);
        const baseLayout = layoutScene(evaluated, projector, {
          compToScreen,
          viewport: {
            x: 0,
            y: 0,
            width: surfaceSize[0],
            height: surfaceSize[1],
          },
        });
        // O palco saiu deste painel (ADR-014): ele tem o seu, com o seu contexto e
        // o seu passe de avaliação. Aqui o layout é o do mapa, sempre — sem o
        // pós-processamento que trocava a entrada dos `model3d` pela câmera
        // orbital, que só existia porque os dois modos dividiam um painel.
        const layout = baseLayout;
        const laidOutAt = performance.now();
        const composed = createScreenScene(evaluated, layout, {
          size: surfaceSize,
          // Durante o export a escala do job manda; fora dele, a tela. O Pixi é a
          // única das três superfícies que já repetia bit a bit com MSAA
          // (ADR-023), mas o TAMANHO dele tem de casar com o do mapa de todo
          // jeito — o `frame-composer` compõe pelo tamanho da primeira.
          pixelRatio: effectivePixelRatio(exportOverride, previewPixelRatio),
        });
        // Efeitos de partícula entram como nós sintéticos: um por instância,
        // logo depois do nó dono na ordem de desenho.
        // Territórios e rios recebem a geometria projetada antes dos efeitos: o
        // nó já existe no documento, o que falta é `props.rings`.
        const geo = expandGeoNodes(composed, evaluated, layout, geoViewportOf(map), (lngLat) =>
          projector.project([lngLat[0], lngLat[1]]),
        );
        // Rotas depois da geografia e antes dos rótulos: uma rota é desenhada
        // sobre o território, e um rótulo pode apontar para ela.
        const routes2d = expandRouteNodes(
          geo.scene,
          evaluated,
          layout,
          session.document.paths,
          (lngLat) => projector.project([lngLat[0], lngLat[1]]),
        );
        // Rótulos depois da geografia e antes dos efeitos: eles podem apontar
        // para um território, e o alvo precisa já ter layout resolvido.
        const callouts = expandCalloutNodes(
          routes2d.scene,
          evaluated,
          layout,
          session.document.paths,
          compToScreen,
          (lngLat) => projector.project([lngLat[0], lngLat[1]]),
        );
        const particles = expandParticleEffects(
          callouts.scene,
          evaluated,
          layout,
          renderComposition,
          effectRegistry,
        );
        const screen = particles.scene;
        renderer.render(screen, PREVIEW_SLOT_ORDER);
        // Nós 3D: a camada Three.js do mapa recebe a cena avaliada (âncora e
        // rumo já resolvidos pelos comportamentos) e repinta sob demanda. As
        // rotas precisam também dos caminhos do projeto — a geometria delas mora
        // em `document.paths`, não na cena avaliada.
        // Sem porta condicionada ao palco. Antes o mapa suprimia os próprios
        // modelos quando havia `studio.stage` na cena, porque os dois modos
        // dividiam um canvas e a mesma aeronave sairia pintada duas vezes. Com
        // painéis separados (ADR-014) cada um é uma VISTA do mesmo documento: o
        // Viewport mostra o modelo na âncora geográfica, o Palco mostra o mesmo
        // modelo em `stageX`/`stageZ`. Suprimir aqui esvaziaria o mapa por causa
        // de um nó que hoje mora em outra aba.
        const routes3d = collectRoute3dNodes(evaluated, session.document.paths);
        syncScene3dLayer(map, { models: collectModel3dNodes(evaluated), routes: routes3d });
        const renderedAt = performance.now();
        renderCountRef.current += 1;
        frameRef.current = {
          composition,
          evaluated,
          // Clique e gizmo consultam este layout. Sem as caixas reais eles apontariam
          // para um quadrado de 64 px na âncora em vez do território inteiro.
          layout: withGeoBounds(layout, new Map([...geo.bounds, ...routes2d.bounds]), evaluated),
          screen,
          actions: actions.diagnostics,
          actionNodes: actions.generatedNodes,
          actionKeyframes: actions.generatedKeyframes,
          behaviors: pass.diagnostics,
          effects: particles.diagnostics,
          particleNodes: particles.particleNodes,
          particles: particles.particles,
          filters: particles.filters,
          mattes: particles.mattes,
          geo: {
            diagnostics: geo.diagnostics,
            drawn: geo.drawn,
            culled: geo.culled,
            vertices: geo.vertices,
            level: geo.level,
            bounds: geo.bounds,
          },
          callouts: {
            diagnostics: callouts.diagnostics,
            anchored: callouts.anchored,
            loose: callouts.loose,
          },
          routes: { diagnostics: routes2d.diagnostics, drawn: routes2d.drawn },
          paths: projectPaths(
            session.document.paths,
            projector,
            compToScreen,
            // Caminho já traçado por uma rota — 2D ou 3D — sai do desenho cru de
            // caminhos: senão a mesma trajetória aparece duas vezes, uma delas
            // como a linha de referência da caneta.
            new Set([...routes3d.map((route) => route.pathId), ...routes2d.pathIds]),
          ),
          metrics: {
            evaluateMs: evaluatedAt - startedAt,
            layoutMs: laidOutAt - evaluatedAt,
            renderMs: renderedAt - laidOutAt,
            totalMs: renderedAt - startedAt,
          },
        };
        drawUi(
          uiCanvasRef.current,
          frameRef.current,
          sessionRef.current.selectedNodeIds,
          gizmoModeRef.current,
          interactionRef.current,
        );
        // Um frame bom apaga a falha anterior: status de erro que não se limpa
        // faz o usuário desconfiar de um render que já voltou ao normal.
        setRendererStatus((current) => (current === READY_STATUS ? current : READY_STATUS));
      })
      .catch((error: unknown) => {
        if (active) {
          setRendererStatus(
            `Falha ao renderizar · ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });

    return () => {
      active = false;
    };
  }, [
    map,
    cameraRevision,
    geoRevision,
    session.document,
    session.playheadFrame,
    session.selectedCompositionId,
    session.selectedNodeIds,
    surfaceSize,
    // Mudar a escala do export tem de repintar: é ela que dimensiona o Pixi.
    exportOverride,
    // Preferência local, ignorada pelo override enquanto o job está ativo.
    previewPixelRatio,
  ]);

  /**
   * A malha geográfica entra sob demanda, então o primeiro frame que pede um
   * território ainda não tem geometria. Sem este gatilho o contorno só apareceria
   * no próximo movimento de câmera — parecendo que o comando falhou.
   */
  useEffect(() => onGeoLayerLoaded(() => setGeoRevision((value) => value + 1)), []);

  useEffect(() => () => clearRuntimeExpressionDiagnostics("map"), []);

  useEffect(() => {
    if (map === null) return;
    const container = map.getCanvasContainer();

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      const frame = frameRef.current;
      if (frame === null) return;
      const point = eventPoint(event, container);
      const snapshot = sessionRef.current;

      // A caneta tem prioridade sobre seleção e gizmos: em modo de desenho, um
      // clique no mapa é sempre um vértice novo.
      if (penRef.current !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        capturePointer(container, event.pointerId);
        updatePen(addVertex(penRef.current, point));
        return;
      }
      const hit = hitTestLayouts(frame.layout.layouts, frame.layout.drawOrder, point, (nodeId) => {
        const source = frame.composition.nodes[nodeId];
        const evaluated = frame.evaluated.nodes.get(nodeId);
        return (
          source !== undefined &&
          source.id !== frame.composition.root &&
          !source.locked &&
          evaluated?.visible === true
        );
      });

      event.preventDefault();
      event.stopImmediatePropagation();
      capturePointer(container, event.pointerId);

      if (hit !== null && snapshot.selectedNodeIds.includes(hit)) {
        const evaluated = frame.evaluated.nodes.get(hit);
        const layout = frame.layout.layouts.get(hit);
        if (evaluated !== undefined && layout !== undefined) {
          interactionRef.current = {
            kind: "transform",
            nodeId: hit,
            start: point,
            current: point,
            center: rect.center(layout.bounds),
            initial: {
              position: evaluated.transform.position,
              rotation: evaluated.transform.rotation,
              scale: evaluated.transform.scale,
            },
            mode: gizmoModeRef.current,
          };
        }
      } else if (hit !== null) {
        editorActions.selectNode(
          frame.composition.id,
          hit,
          event.shiftKey || event.ctrlKey || event.metaKey,
        );
      } else {
        interactionRef.current = {
          kind: "marquee",
          start: point,
          current: point,
          additive: event.shiftKey || event.ctrlKey || event.metaKey,
          contained: event.altKey,
        };
        if (!interactionRef.current.additive) editorActions.clearSelection();
      }
      drawUi(
        uiCanvasRef.current,
        frameRef.current,
        sessionRef.current.selectedNodeIds,
        gizmoModeRef.current,
        interactionRef.current,
      );
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (penRef.current !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        updatePen(dragHandle(penRef.current, eventPoint(event, container)));
        return;
      }
      const interaction = interactionRef.current;
      if (interaction === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      interaction.current = eventPoint(event, container);
      drawUi(
        uiCanvasRef.current,
        frameRef.current,
        sessionRef.current.selectedNodeIds,
        gizmoModeRef.current,
        interactionRef.current,
      );
    };

    const finishInteraction = (event: PointerEvent): void => {
      if (penRef.current !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (container.hasPointerCapture(event.pointerId)) {
          container.releasePointerCapture(event.pointerId);
        }
        updatePen(endDrag(penRef.current));
        return;
      }
      const interaction = interactionRef.current;
      if (interaction === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      interaction.current = eventPoint(event, container);
      interactionRef.current = null;
      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }

      const frame = frameRef.current;
      if (frame === null) return;
      if (interaction.kind === "marquee") {
        const selected = marqueeLayouts(
          frame.layout.layouts,
          frame.layout.drawOrder,
          rectFromDrag(interaction.start, interaction.current),
          {
            contained: interaction.contained,
            eligible: (nodeId) => {
              const node = frame.composition.nodes[nodeId];
              return (
                node !== undefined &&
                node.id !== frame.composition.root &&
                !node.locked &&
                frame.evaluated.nodes.get(nodeId)?.visible === true
              );
            },
          },
        );
        const next = interaction.additive
          ? [...new Set([...sessionRef.current.selectedNodeIds, ...selected])]
          : selected;
        editorActions.selectNodes(frame.composition.id, next);
      } else {
        const transformed = transformFromDrag({
          mode: interaction.mode,
          start: interaction.start,
          current: interaction.current,
          center: interaction.center,
          initial: interaction.initial,
        });
        const path =
          interaction.mode === "position"
            ? "transform.position"
            : interaction.mode === "rotation"
              ? "transform.rotation"
              : "transform.scale";
        const value =
          interaction.mode === "position"
            ? transformed.position
            : interaction.mode === "rotation"
              ? transformed.rotation
              : transformed.scale;
        editorActions.setPropertyValue(interaction.nodeId, path, value);
      }
      drawUi(
        uiCanvasRef.current,
        frameRef.current,
        sessionRef.current.selectedNodeIds,
        gizmoModeRef.current,
        interactionRef.current,
      );
    };

    /**
     * Duplo clique no vazio do mapa cria um rótulo ancorado ali (7D).
     *
     * Duas guardas antes de criar. A caneta tem prioridade — em modo de desenho
     * um duplo clique fecha o caminho, não nasce texto. E um duplo clique
     * **sobre um objeto** é edição do que já existe, não criação de mais um:
     * criar por cima seria a forma mais rápida de empilhar rótulos invisíveis um
     * sobre o outro.
     *
     * `stopImmediatePropagation` porque o MapLibre trata duplo clique como zoom,
     * e o rótulo nasceria junto com um salto de câmera.
     */
    const onDoubleClick = (event: MouseEvent): void => {
      if (event.button !== 0 || penRef.current !== null) return;
      const frame = frameRef.current;
      if (frame === null) return;
      const point = eventPoint(event, container);
      const hit = hitTestLayouts(frame.layout.layouts, frame.layout.drawOrder, point, (nodeId) =>
        frame.evaluated.nodes.get(nodeId)?.type === "group" ? false : true,
      );
      if (hit !== null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const lngLat = map.unproject([point[0], point[1]]);
      const nodeId = editorActions.addNodeOfType("text.label");
      if (nodeId === null) return;
      editorActions.setNodeAnchor(nodeId, { space: "geo", lngLat: [lngLat.lng, lngLat.lat] });
      // Selecionar já deixa o Inspector com o campo de texto à mão. Resolver o
      // nome pelo gazetteer exigiria busca **reversa** — por coordenada — e o
      // índice atual só busca por nome; fica para quando ela existir.
      editorActions.selectNode(frame.composition.id, nodeId);
    };

    container.addEventListener("pointerdown", onPointerDown, true);
    container.addEventListener("pointermove", onPointerMove, true);
    container.addEventListener("pointerup", finishInteraction, true);
    container.addEventListener("pointercancel", finishInteraction, true);
    container.addEventListener("dblclick", onDoubleClick, true);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("pointermove", onPointerMove, true);
      container.removeEventListener("pointerup", finishInteraction, true);
      container.removeEventListener("pointercancel", finishInteraction, true);
      container.removeEventListener("dblclick", onDoubleClick, true);
    };
  }, [map]);

  useEffect(() => {
    drawUi(
      uiCanvasRef.current,
      frameRef.current,
      session.selectedNodeIds,
      gizmoMode,
      interactionRef.current,
      penRef.current,
    );
  }, [gizmoMode, session.selectedNodeIds]);

  useEffect(() => {
    if (penState === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        commitPen();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        updatePen(null);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        event.stopImmediatePropagation();
        updatePen(removeLastVertex(penRef.current ?? EMPTY_PEN));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [penState, commitPen, updatePen]);

  useEffect(() => {
    // A flag existe para verificar o bundle estático/minificado sem servidor
    // HMR. Builds distribuídos não a definem e continuam sem esta superfície.
    if (!(import.meta.env.DEV || import.meta.env.VITE_THEATRUM_VERIFY === "1")) return;
    const debug: Phase4DebugSurface = Object.freeze({
      getSnapshot: () =>
        serializeDebugFrame(frameRef.current, gizmoModeRef.current, renderCountRef.current),
      captureExport: async () => {
        const lease = leaseRef.current;
        if (lease === null) throw new Error("Renderer ainda não está pronto.");
        const { renderer } = await lease.controller;
        return renderer.capture(EXPORT_SLOT_ORDER);
      },
      setGizmoMode: (mode: GizmoMode) => setGizmoMode(mode),
      /**
       * Export de sequência PNG (Fase 8), dirigido de fora.
       *
       * A sonda que o motor usa vem daqui e não de dentro dele: o overlay é quem
       * sabe qual frame desenhou e quantas vezes repintou, e é dessa contagem que
       * a política de `settle` depende.
       */
      exportPngSequence: (options?: DebugExportOptions) => {
        const liveMap = mapRef.current;
        if (liveMap === null) {
          return Promise.resolve({ ok: false, directory: "", message: "mapa indisponível" });
        }
        return startDebugExport({
          map: liveMap,
          probe: () => ({
            frame: frameRef.current?.screen.frame ?? -1,
            renders: renderCountRef.current,
            // Mesma guarda do bind acima: GLB pendente segura o settle.
            pendingAssets: scene3dLayerPending(liveMap) + activeStudioPendingModels(),
          }),
          ...(options?.range === undefined ? {} : { range: options.range }),
          ...(options?.outputFps === undefined ? {} : { outputFps: options.outputFps }),
          ...(options?.directory === undefined ? {} : { directory: options.directory }),
          ...(options?.format === undefined ? {} : { format: options.format }),
          // A escala atravessa para o verificador poder exportar acima de 2 MP e
          // afirmar `SAMPLES === 0` — o critério que o ADR-023 exige.
          ...(options?.scale === undefined ? {} : { scale: options.scale }),
          ...(options?.supersampling === undefined ? {} : { supersampling: options.supersampling }),
          ...(options?.motionBlur === undefined ? {} : { motionBlur: options.motionBlur }),
        });
      },
    });
    Object.defineProperty(window, "__theatrumPhase4", {
      value: debug,
      configurable: true,
    });
    return () => {
      if (window.__theatrumPhase4 === debug) {
        Reflect.deleteProperty(window, "__theatrumPhase4");
      }
    };
  }, []);

  return (
    <div className="scene-overlay" ref={rootRef} aria-label="Objetos animados da cena">
      <canvas ref={pixiCanvasRef} className="scene-overlay__pixi" aria-hidden="true" />
      <canvas ref={uiCanvasRef} className="scene-overlay__ui" aria-hidden="true" />
      <div className="scene-overlay__gizmos" role="toolbar" aria-label="Transformação">
        <span>{rendererStatus}</span>
        <Button
          size="sm"
          variant={gizmoMode === "position" ? "primary" : "default"}
          aria-label="Mover"
          onClick={() => setGizmoMode("position")}
        >
          W
        </Button>
        <Button
          size="sm"
          variant={gizmoMode === "rotation" ? "primary" : "default"}
          aria-label="Rotacionar"
          onClick={() => setGizmoMode("rotation")}
        >
          E
        </Button>
        <Button
          size="sm"
          variant={gizmoMode === "scale" ? "primary" : "default"}
          aria-label="Escalar"
          onClick={() => setGizmoMode("scale")}
        >
          R
        </Button>
        <Button
          size="sm"
          variant={penState === null ? "default" : "primary"}
          aria-label={penState === null ? "Desenhar caminho" : "Sair da caneta"}
          title="Caneta · clique adiciona vértice, arraste curva, Enter grava, Esc cancela"
          data-pen-active={penState === null ? undefined : true}
          onClick={() => updatePen(penState === null ? EMPTY_PEN : null)}
        >
          P
        </Button>
        {penState !== null && (
          <>
            <output className="scene-overlay__pen-count">{penState.vertices.length} pts</output>
            <Button
              size="sm"
              aria-label="Gravar caminho"
              disabled={!canCommit(penState)}
              onClick={() => commitPen()}
            >
              ✓
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function compositionToViewport(composition: Composition, viewport: Vec2): Mat2D {
  const scale = Math.min(viewport[0] / composition.width, viewport[1] / composition.height);
  // Origem permanece em (0,0), mantendo o root identity e impedindo que um
  // filho geo receba letterbox duas vezes pela matriz do pai.
  return mat2d.scaling(scale, scale);
}

/**
 * Capturar o ponteiro é otimização de arrasto, não requisito. O navegador lança
 * quando o id não corresponde a um ponteiro ativo — ponteiro cancelado, ou evento
 * sintético de teste — e deixar isso escapar mataria a interação inteira por um
 * detalhe opcional.
 */
function capturePointer(container: HTMLElement, pointerId: number): void {
  try {
    container.setPointerCapture(pointerId);
  } catch {
    // Sem captura o arrasto ainda funciona enquanto o ponteiro estiver sobre o mapa.
  }
}

/** Só precisa das coordenadas de cliente, então serve a ponteiro e a mouse. */
function eventPoint(event: MouseEvent, container: HTMLElement): Vec2 {
  const bounds = container.getBoundingClientRect();
  return [event.clientX - bounds.left, event.clientY - bounds.top];
}

/**
 * Amostra cada caminho do projeto e projeta na tela. A amostragem é por
 * `progress`, então bezier e geodésico saem com a mesma densidade de pontos e o
 * desenho mostra a curva real, não a poligonal dos vértices.
 *
 * Caminho já traçado por um nó `route3d` visível é omitido: a rota dele existe
 * no espaço, com altitude e volume, e repetir a mesma trajetória como linha
 * projetada no terreno é justamente o "adesivo" que a camada 3D veio substituir.
 * O que sobra aqui é andaime de autoria — caminho sem rota 3D montada.
 */
function projectPaths(
  paths: Readonly<Record<string, PathData>>,
  projector: ReturnType<typeof createMapLibreProjectorPort>,
  compToScreen: Mat2D,
  drawnIn3d: ReadonlySet<string>,
): readonly ProjectedPath[] {
  const SAMPLES = 64;
  const result: ProjectedPath[] = [];
  for (const path of Object.values(paths)) {
    if (drawnIn3d.has(path.id)) continue;
    const geometry = pathGeometry(path);
    if (geometry.segments.length === 0) continue;
    const toScreen = (point: Vec2): Vec2 =>
      path.space === "geo"
        ? projector.project([point[0], point[1]])
        : mat2d.applyPoint(compToScreen, point);
    const points: Vec2[] = [];
    for (let step = 0; step <= SAMPLES; step += 1) {
      points.push(toScreen(pointAt(geometry, step / SAMPLES)));
    }
    result.push({
      id: path.id,
      name: path.name,
      points: Object.freeze(points),
      vertices: Object.freeze(path.vertices.map((vertex) => toScreen(vertex.point))),
    });
  }
  return Object.freeze(result);
}

function drawUi(
  canvas: HTMLCanvasElement | null,
  frame: OverlayFrame | null,
  selectedNodeIds: readonly string[],
  gizmoMode: GizmoMode,
  interaction: Interaction | null,
  pen: PenState | null = null,
): void {
  if (canvas === null || frame === null) return;
  const dpr = Math.max(1, window.devicePixelRatio);
  const width = frame.screen.size[0];
  const height = frame.screen.size[1];
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  // Antes de tudo: a moldura é fundo de chrome, e gizmo e caminho desenham por
  // cima dela. Ver `composition-frame.ts` para por que ela mora neste canvas.
  drawCompositionFrame(context, frame.composition, [width, height]);

  context.lineWidth = 1;
  context.strokeStyle = "#68b7ff";
  context.fillStyle = "#68b7ff";

  drawPaths(context, frame.paths);
  if (pen !== null) drawPen(context, pen);

  for (const nodeId of selectedNodeIds) {
    const layout = frame.layout.layouts.get(nodeId);
    if (layout === undefined || layout.culled) continue;
    strokeBounds(context, layout.bounds);
    drawHandle(context, layout.bounds, gizmoMode);
  }

  if (interaction?.kind === "marquee") {
    const marquee = rectFromDrag(interaction.start, interaction.current);
    context.fillStyle = "rgb(75 159 232 / 0.12)";
    context.strokeStyle = "#4b9fe8";
    context.setLineDash([4, 3]);
    context.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
    context.strokeRect(marquee.x + 0.5, marquee.y + 0.5, marquee.width, marquee.height);
    context.setLineDash([]);
  } else if (interaction?.kind === "transform") {
    const layout = frame.layout.layouts.get(interaction.nodeId);
    if (layout !== undefined) {
      const transformed = transformFromDrag({
        mode: interaction.mode,
        start: interaction.start,
        current: interaction.current,
        center: interaction.center,
        initial: interaction.initial,
      });
      const preview =
        interaction.mode === "position"
          ? {
              ...layout.bounds,
              x: layout.bounds.x + transformed.position[0] - interaction.initial.position[0],
              y: layout.bounds.y + transformed.position[1] - interaction.initial.position[1],
            }
          : interaction.mode === "scale"
            ? scaleBounds(layout.bounds, transformed.scale[0] / interaction.initial.scale[0])
            : layout.bounds;
      context.setLineDash([5, 3]);
      strokeBounds(context, preview);
      context.setLineDash([]);
    }
  }
}

function strokeBounds(context: CanvasRenderingContext2D, bounds: Rect): void {
  context.strokeRect(bounds.x + 0.5, bounds.y + 0.5, bounds.width, bounds.height);
}

function drawHandle(context: CanvasRenderingContext2D, bounds: Rect, mode: GizmoMode): void {
  const center = rect.center(bounds);
  if (mode === "position") {
    context.beginPath();
    context.moveTo(center[0] - 7, center[1]);
    context.lineTo(center[0] + 7, center[1]);
    context.moveTo(center[0], center[1] - 7);
    context.lineTo(center[0], center[1] + 7);
    context.stroke();
    return;
  }
  const handle: Vec2 =
    mode === "rotation"
      ? [center[0], bounds.y - 18]
      : [bounds.x + bounds.width, bounds.y + bounds.height];
  if (mode === "rotation") {
    context.beginPath();
    context.moveTo(center[0], bounds.y);
    context.lineTo(handle[0], handle[1]);
    context.stroke();
  }
  context.fillRect(handle[0] - 3, handle[1] - 3, 6, 6);
}

/**
 * Guia dos caminhos sem rota 3D montada: tracejado fino mais os vértices.
 * Tracejado de propósito — isto é andaime de autoria, não a rota da animação.
 * A rota da animação é o tubo volumétrico da camada 3D.
 */
function drawPaths(context: CanvasRenderingContext2D, paths: readonly ProjectedPath[]): void {
  if (paths.length === 0) return;
  context.save();
  context.strokeStyle = "rgb(201 150 63 / 0.6)";
  context.fillStyle = "rgb(201 150 63 / 0.75)";
  context.lineWidth = 1;
  context.setLineDash([6, 4]);
  for (const path of paths) {
    const [start, ...rest] = path.points;
    if (start === undefined || rest.length === 0) continue;
    context.beginPath();
    context.moveTo(start[0], start[1]);
    for (const point of rest) context.lineTo(point[0], point[1]);
    context.stroke();
    for (const vertex of path.vertices) {
      context.fillRect(vertex[0] - 2, vertex[1] - 2, 4, 4);
    }
  }
  context.setLineDash([]);
  context.restore();
}

/** Caminho em construção: traço tracejado, handles e o segmento-fantasma. */
function drawPen(context: CanvasRenderingContext2D, pen: PenState): void {
  const line = penPolyline(pen);
  context.save();
  context.strokeStyle = "#f2c94c";
  context.fillStyle = "#f2c94c";
  context.lineWidth = 1.5;

  const [start, ...rest] = line;
  if (start !== undefined && rest.length > 0) {
    context.beginPath();
    context.moveTo(start[0], start[1]);
    for (const point of rest) context.lineTo(point[0], point[1]);
    context.stroke();
  }

  const last = pen.vertices.at(-1);
  if (last !== undefined && pen.hover !== null && pen.dragging === null) {
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(last.point[0], last.point[1]);
    context.lineTo(pen.hover[0], pen.hover[1]);
    context.stroke();
    context.setLineDash([]);
  }

  for (const vertex of pen.vertices) {
    context.fillRect(vertex.point[0] - 3, vertex.point[1] - 3, 6, 6);
    if (vertex.outHandle === null) continue;
    const mirrored: Vec2 = [
      2 * vertex.point[0] - vertex.outHandle[0],
      2 * vertex.point[1] - vertex.outHandle[1],
    ];
    context.beginPath();
    context.moveTo(mirrored[0], mirrored[1]);
    context.lineTo(vertex.outHandle[0], vertex.outHandle[1]);
    context.stroke();
    for (const handle of [vertex.outHandle, mirrored]) {
      context.beginPath();
      context.arc(handle[0], handle[1], 3, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

function scaleBounds(bounds: Rect, ratio: number): Rect {
  const center = rect.center(bounds);
  return {
    x: center[0] - (bounds.width * ratio) / 2,
    y: center[1] - (bounds.height * ratio) / 2,
    width: bounds.width * ratio,
    height: bounds.height * ratio,
  };
}

interface SerializedDebugFrame {
  readonly ready: boolean;
  /** Contador de renders do overlay: distingue frame novo de leitura obsoleta. */
  readonly renders: number;
  /** Actions live expandidas neste documento derivado. */
  readonly actions?: readonly ActionDiagnostic[];
  readonly actionNodes?: number;
  readonly actionKeyframes?: number;
  /** Comportamentos que não puderam contribuir, com motivo. */
  readonly behaviors?: readonly BehaviorDiagnostic[];
  /** Efeitos que não puderam contribuir, e o volume de partículas do frame. */
  readonly effects?: ParticleExpansion["diagnostics"];
  readonly particleNodes?: number;
  readonly particles?: number;
  /** Passes de filtro e recortes ativos no frame. */
  readonly filters?: number;
  readonly mattes?: number;
  /** Territórios desenhados, vértices projetados e nível de simplificação. */
  readonly geo?: Omit<GeoExpansion, "scene">;
  /** Rótulos ancorados e soltos neste frame. */
  readonly callouts?: Omit<CalloutExpansion, "scene">;
  /** Rotas 2D que desenharam, e as que não acharam caminho. */
  readonly routes?: Omit<RouteExpansion, "scene" | "pathIds" | "bounds">;
  /** Caminhos projetados neste frame, resumidos. */
  readonly paths?: readonly {
    readonly id: string;
    readonly name: string;
    readonly points: number;
    readonly vertices: number;
    readonly first: Vec2;
    readonly last: Vec2;
  }[];
  readonly frame?: number;
  readonly compositionId?: string;
  readonly gizmoMode: GizmoMode;
  readonly metrics?: RenderMetrics;
  readonly camera?: EvaluatedScene["camera"];
  readonly nodes?: readonly {
    readonly id: string;
    readonly type: string;
    readonly visible: boolean;
    readonly anchor: unknown;
    readonly size: unknown;
    readonly matrix: Mat2D;
    readonly sizePx: Vec2;
    readonly bounds: Rect;
    /** Opacidade hierárquica e transform avaliados, para provas de animação. */
    readonly opacity: number;
    readonly transform: {
      readonly position: Vec2;
      readonly rotation: number;
      readonly scale: Vec2;
      readonly rotationReference: string;
    };
    /** Ângulo real na tela, extraído da matriz mundial. */
    readonly screenAngle: number;
  }[];
}

function serializeDebugFrame(
  frame: OverlayFrame | null,
  mode: GizmoMode,
  renders: number,
): SerializedDebugFrame {
  if (frame === null) return { ready: false, renders, gizmoMode: mode };
  return {
    ready: true,
    renders,
    actions: frame.actions,
    actionNodes: frame.actionNodes,
    actionKeyframes: frame.actionKeyframes,
    behaviors: frame.behaviors,
    effects: frame.effects,
    particleNodes: frame.particleNodes,
    particles: frame.particles,
    filters: frame.filters,
    mattes: frame.mattes,
    geo: frame.geo,
    callouts: frame.callouts,
    routes: frame.routes,
    paths: frame.paths.map((path) => ({
      id: path.id,
      name: path.name,
      points: path.points.length,
      vertices: path.vertices.length,
      first: path.points[0] ?? [0, 0],
      last: path.points.at(-1) ?? [0, 0],
    })),
    frame: frame.evaluated.frame,
    compositionId: frame.composition.id,
    gizmoMode: mode,
    metrics: frame.metrics,
    camera: frame.evaluated.camera,
    nodes: frame.evaluated.drawOrder.flatMap((nodeId) => {
      const node = frame.evaluated.nodes.get(nodeId);
      const layout = frame.layout.layouts.get(nodeId);
      if (node === undefined || layout === undefined) return [];
      // A matriz da cena de TELA, não a do layout: passes posteriores (rótulo
      // com guia, palco 3D) reposicionam o nó depois do layout genérico, e é a
      // posição final que interessa a quem verifica o que foi desenhado.
      const drawn = frame.screen.nodes.get(nodeId)?.layout.matrix ?? layout.matrix;
      return [
        {
          id: node.id,
          type: node.type,
          visible: node.visible && !layout.culled,
          anchor: node.anchor,
          size: node.size,
          screenPx: [drawn[4], drawn[5]] as Vec2,
          matrix: layout.matrix,
          sizePx: layout.sizePx,
          bounds: layout.bounds,
          opacity: node.opacity,
          transform: {
            position: node.transform.position,
            rotation: node.transform.rotation,
            scale: node.transform.scale,
            rotationReference: node.transform.rotationReference,
          },
          screenAngle: (Math.atan2(layout.matrix[1], layout.matrix[0]) * 180) / Math.PI,
        },
      ];
    }),
  };
}

/** Superfície DEV do palco: é o que o verificador do bloco 7E lê. */
interface Phase4DebugSurface {
  readonly getSnapshot: () => SerializedDebugFrame;
  readonly captureExport: () => Promise<CapturedFrame>;
  readonly setGizmoMode: (mode: GizmoMode) => void;
  readonly exportPngSequence: (options?: DebugExportOptions) => Promise<StartExportResult>;
}

declare global {
  interface Window {
    __theatrumPhase4?: Phase4DebugSurface;
  }
}
