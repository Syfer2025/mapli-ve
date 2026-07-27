import type { Mat2D, Vec2 } from "@theatrum/core-math";

/**
 * Camadas lógicas do compositor. A lista passada pelo chamador é a única fonte
 * de verdade sobre o que entra no frame final.
 */
export const SLOT_IDS = ["below-labels", "scene", "above-all", "ui-overlay"] as const;

export type SlotId = (typeof SLOT_IDS)[number];

export const PREVIEW_SLOT_ORDER: readonly SlotId[] = SLOT_IDS;

/** A UI não está presente nesta constante por construção. */
export const EXPORT_SLOT_ORDER: readonly SlotId[] = ["below-labels", "scene", "above-all"];

export type RendererBackendKind = "webgl2" | "webgpu" | "headless";

export type CaptureEncoding = "rgba8" | "command-buffer";

export interface RenderSurface {
  /**
   * Superfície nativa opcional. No adaptador Pixi é um canvas; no backend
   * headless ela não é necessária. O tipo concreto não vaza pelo contrato.
   */
  readonly native?: unknown;
}

export interface SurfaceSet {
  readonly overlay: RenderSurface;
}

export interface CapturedFrame {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly encoding: CaptureEncoding;
  readonly data: Uint8Array;
}

/**
 * Passe de imagem sobre o nó já desenhado.
 *
 * O renderer não conhece o catálogo de efeitos: recebe um tipo, uniforms já
 * resolvidos em número e uma cor. Um tipo desconhecido é ignorado em silêncio —
 * o diagnóstico é responsabilidade de quem monta a cena, e um filtro novo não
 * pode quebrar o frame de quem tem um backend antigo.
 */
export interface ScreenFilter {
  readonly type: string;
  readonly params: Readonly<Record<string, number>>;
  /** `#rrggbb`. Filtros sem cor mandam preto. */
  readonly color: string;
}

/**
 * Recorte pelo alfa ou pelo brilho de outro nó.
 *
 * O nó de origem para de ser desenhado por conta própria — só serve de máscara.
 * Quem monta a cena não precisa retirá-lo da ordem de desenho: o backend cuida
 * disso, porque a origem ainda precisa ser rasterizada para virar a máscara.
 */
export interface NodeMatte {
  /** Id na cena de tela, já com o prefixo de pré-composição se houver. */
  readonly source: string;
  readonly mode: "alpha" | "alpha-inverted" | "luma" | "luma-inverted";
}

export interface NodeLayout {
  /** Matriz local→tela, já resolvida pelo estágio de layout. */
  readonly matrix: Mat2D;
  /** Tamanho da geometria em pixels antes da matriz. */
  readonly size: Vec2;
  readonly opacity: number;
  readonly visible: boolean;
  readonly blendMode: string;
  /** Aplicados na ordem da lista, cada um sobre a saída do anterior. */
  readonly filters?: readonly ScreenFilter[];
  /** Recorte por outro nó da mesma cena. */
  readonly matte?: NodeMatte;
}

export interface ScreenNode<P = Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
  readonly slot: SlotId;
  readonly props: P;
  readonly layout: NodeLayout;
}

/**
 * Cena já projetada. O renderer não conhece documento, câmera, geografia nem
 * keyframes; recebe somente pixels e uma ordem explícita.
 */
export interface ScreenScene {
  readonly frame: number;
  readonly size: Vec2;
  readonly pixelRatio: number;
  readonly nodes: ReadonlyMap<string, ScreenNode>;
  readonly drawOrder: readonly string[];
}

export interface NonePrimitive {
  readonly kind: "none";
}

export interface TextPrimitive {
  readonly kind: "text";
  readonly text: string;
  readonly color: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: "normal" | "bold";
  readonly align: "left" | "center" | "right";
}

export interface ImagePrimitive {
  readonly kind: "image";
  readonly source: string;
  readonly tint: string;
}

export interface LinePrimitive {
  readonly kind: "line";
  readonly points: readonly Vec2[];
  readonly color: string;
  readonly width: number;
}

export interface PolygonPrimitive {
  readonly kind: "polygon";
  readonly points: readonly Vec2[];
  readonly fill: string;
  readonly fillAlpha: number;
  readonly stroke: string;
  readonly strokeWidth: number;
}

export interface CirclePrimitive {
  readonly kind: "circle";
  readonly radius: number;
  readonly fill: string;
  readonly fillAlpha: number;
  readonly stroke: string;
  readonly strokeWidth: number;
}

export interface SymbolPrimitive {
  readonly kind: "symbol";
  readonly shape: "square" | "diamond" | "triangle" | "circle";
  readonly size: number;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly label: string;
  readonly labelColor: string;
}

/**
 * Nuvem de partículas resolvida no vertex shader.
 *
 * O buffer é **estático**: nasce uma vez por `bufferId` e nunca muda. O que muda
 * entre frames é o uniform `frame`. É isso que permite 5.000 partículas com um
 * draw call e custo de CPU praticamente zero — e é também o que faz scrub para
 * trás funcionar, porque não existe estado acumulado para rebobinar.
 *
 * O renderer não conhece emissores nem sementes: recebe o buffer pronto e a
 * ordem dos campos, definida em `@theatrum/effects`.
 */
export interface ParticlesPrimitive {
  readonly kind: "particles";
  /** Identidade do buffer. Igual → o backend reaproveita o que já subiu. */
  readonly bufferId: string;
  readonly count: number;
  readonly stride: number;
  /** `count * stride` floats, structure of arrays achatado. */
  readonly data: Float32Array;
  /** Índice de cor por partícula. */
  readonly colors: Uint8Array;
  /** Paleta em `#rrggbb`, indexada por `colors`. */
  readonly palette: readonly string[];
  /** Frame relativo ao início do efeito. Vai como uniform. */
  readonly frame: number;
  readonly fade: "out" | "in-out" | "flash" | "hold";
  readonly blend: "normal" | "add" | "screen";
  readonly opacity: number;
  /** Amplitude e frequência do wobble; 0 desliga. */
  readonly wobble: number;
  readonly wobbleHz: number;
  readonly fps: number;
  readonly drift: boolean;
}

/**
 * Vocabulário gráfico backend-neutro. Renderables avaliam dados para uma destas
 * descrições; Pixi e o backend headless apenas materializam a descrição.
 */
export type VisualPrimitive =
  | NonePrimitive
  | TextPrimitive
  | ImagePrimitive
  | LinePrimitive
  | PolygonPrimitive
  | CirclePrimitive
  | SymbolPrimitive
  | ParticlesPrimitive;

export interface RenderContext {
  readonly nodeId: string;
  submit(visual: VisualPrimitive, layout: NodeLayout): void;
}

export interface Renderable<P = unknown> {
  mount(context: RenderContext): void;
  update(node: ScreenNode<P>, layout: NodeLayout): void;
  unmount(): void;
}

export type RenderableFactory<P = unknown> = () => Renderable<P>;

export type VisualEvaluator<P = unknown> = (
  node: Readonly<ScreenNode<P>>,
) => Readonly<VisualPrimitive>;

export interface RenderTarget {
  readonly id: SlotId;
}

export interface Compositor {
  slot(id: SlotId): RenderTarget;
  composite(order: readonly SlotId[]): void;
  captureComposite(order: readonly SlotId[]): Promise<CapturedFrame>;
}

/**
 * Porta retida usada pelo lifecycle. Implementações guardam recursos por
 * `nodeId`, portanto nenhum handle de Pixi ou WebGL precisa atravessar a API.
 */
export interface RenderBackend {
  readonly kind: RendererBackendKind;
  init(surfaces: SurfaceSet): Promise<void>;
  resize(size: Vec2, pixelRatio: number): void;
  mount(nodeId: string, slot: SlotId): void;
  move(nodeId: string, slot: SlotId): void;
  update(nodeId: string, visual: VisualPrimitive, layout: NodeLayout): void;
  unmount(nodeId: string): void;
  setOrder(slot: SlotId, nodeIds: readonly string[]): void;
  composite(order: readonly SlotId[]): void;
  capture(): Promise<CapturedFrame>;
  dispose(): void;
}

export interface Renderer {
  readonly backend: RendererBackendKind;
  init(surfaces: SurfaceSet): Promise<void>;
  resize(size: Vec2, pixelRatio: number): void;
  render(scene: ScreenScene, slots: readonly SlotId[]): void;
  capture(slots: readonly SlotId[]): Promise<CapturedFrame>;
  invalidate(nodeIds: readonly string[] | "all"): void;
  dispose(): void;
}
