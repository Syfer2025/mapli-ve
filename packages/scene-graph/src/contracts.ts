import type { Mat2D, Rect, Vec2 } from "@theatrum/core-math";
import type { Anchor, Node, SizeSpec } from "@theatrum/schema";
import type { z } from "zod";

export type AnchorSpace = Anchor["space"];
export type SizeMode = SizeSpec["mode"];
export type RotationReference = Node["transform"]["rotationReference"];

export type NodeCategory =
  "structure" | "text" | "media" | "shape" | "geo" | "unit" | "symbol" | "effect-emitter";

export type PropertyKind =
  | "number"
  | "vec2"
  | "text"
  | "multiline-text"
  | "color"
  | "boolean"
  | "enum"
  | "asset"
  | "anchor"
  | "size"
  | "points";

export type PropertyGroup = "transform" | "layout" | "appearance" | "content";
export type PropertyUnit = "px" | "degrees" | "ratio" | "percent" | "meters";
export type PropertyBinding = "animatable" | "anchor" | "size" | "geometry";

export interface PropertyOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Metadado único consumido pelo Inspector e pela Timeline.
 *
 * `path` usa a mesma notação pontuada aceita por `document.select.property`.
 * Quando `binding === "animatable"`, o caminho sempre termina num
 * `AnimatableProperty`; `animatable` apenas decide se keyframes são permitidos.
 */
export interface PropertyDescriptor {
  readonly path: string;
  readonly label: string;
  readonly kind: PropertyKind;
  readonly group: PropertyGroup;
  readonly binding: PropertyBinding;
  readonly animatable: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: PropertyUnit;
  readonly options?: readonly PropertyOption[];
}

/**
 * Definição de domínio de um tipo de nó. A fábrica gráfica vive no `renderer`,
 * chaveada pelo mesmo `type`, para não criar um ciclo scene-graph → renderer.
 */
export interface NodeTypeDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  readonly category: NodeCategory;
  readonly label: string;
  readonly icon: string;
  readonly defaultProps: Readonly<P>;
  readonly propertySchema: z.ZodType<P>;
  /** Todas as propriedades apresentadas no Inspector. */
  readonly properties: readonly PropertyDescriptor[];
  /** Subconjunto derivado de `properties`, apresentado como trilhas na Timeline. */
  readonly animatable: readonly PropertyDescriptor[];
  readonly supportsChildren: boolean;
  readonly defaultAnchorSpace: AnchorSpace;
  readonly defaultSizeMode: SizeMode;
}

export interface ResolvedTransform {
  readonly position: Vec2;
  readonly rotation: number;
  readonly scale: Vec2;
  readonly opacity: number;
  readonly anchorPoint: Vec2;
  readonly skew: Vec2;
  readonly rotationReference: RotationReference;
}

/**
 * Shape mínimo produzido por `animation` e consumido pelo layout.
 * O parentesco é mantido aqui porque a matriz mundial não deve voltar a ler o
 * documento persistido.
 */
export interface EvaluatedNodeLike<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly type: string;
  readonly parent: string | null;
  readonly anchor: Anchor;
  readonly size: SizeSpec;
  readonly transform: ResolvedTransform;
  readonly props: Readonly<P>;
  readonly opacity: number;
  readonly visible: boolean;
}

export interface EvaluatedSceneLike {
  readonly frame: number;
  readonly nodes: ReadonlyMap<string, EvaluatedNodeLike>;
  readonly drawOrder: readonly string[];
}

/**
 * Porta estrutural para não criar uma aresta lateral scene-graph → gis.
 * A implementação concreta continua sendo `gis.ProjectorPort`.
 */
export interface ProjectorPortLike<S = unknown> {
  project(lngLat: Vec2, altitude?: number): Vec2;
  unproject(point: Vec2): Vec2;
  metersPerPixel(atLat: number): number;
  bearingToScreenAngle(bearing: number): number;
  elevationAt(lngLat: Vec2): number | null;
  snapshot(): S;
}

export interface LayoutContext {
  /**
   * Transformação opcional de pixels da composição para o viewport. Geo já é
   * devolvido em pixels do viewport pelo projector e não passa por esta matriz.
   */
  readonly compToScreen?: Mat2D;
  /** Retângulo de culling em pixels de tela. Ausente significa sem culling. */
  readonly viewport?: Rect;
  /**
   * Referência geográfica para tamanho ground de anchors não geográficos.
   * Quando ausente, o ponto final é convertido por `projector.unproject`.
   */
  readonly groundReference?: Vec2;
}

export interface NodeLayout {
  /** Matriz local → tela, já acumulada pela hierarquia. */
  readonly matrix: Mat2D;
  /** Matriz local antes do parentesco; útil para gizmos e depuração. */
  readonly localMatrix: Mat2D;
  /** Anchor resolvido em tela, depois do parentesco. */
  readonly anchorPx: Vec2;
  readonly sizePx: Vec2;
  readonly bounds: Rect;
  readonly culled: boolean;
}

export interface ScreenScene<S = unknown> {
  readonly frame: number;
  readonly projector: S;
  readonly layouts: ReadonlyMap<string, NodeLayout>;
  readonly drawOrder: readonly string[];
}
