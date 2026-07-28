import type { Vec2 } from "@theatrum/core-math";
import { DisposableStore, type Disposable } from "@theatrum/core-utils";
import type {
  CirclePrimitive,
  NonePrimitive,
  ScreenNode,
  SymbolPrimitive,
  TextPrimitive,
  VisualPrimitive,
  VisualEvaluator,
} from "./contracts.js";
import { createDataRenderableFactory } from "./data-renderable.js";
import { RenderableRegistry } from "./registry.js";

type Props = Readonly<Record<string, unknown>>;

const NONE: NonePrimitive = Object.freeze({ kind: "none" });

const noVisual: VisualEvaluator<Props> = () => NONE;

const titleVisual: VisualEvaluator<Props> = (node) => ({
  kind: "text",
  text: stringProp(node.props, "text", node.name ?? "Título"),
  color: stringProp(node.props, "color", "#f4f7fb"),
  fontFamily: stringProp(node.props, "fontFamily", "Open Sans"),
  fontSize: positiveProp(node.props, "fontSize", 48),
  fontWeight: fontWeightProp(node.props, "bold"),
  align: enumProp(node.props, "align", ["left", "center", "right"], "center"),
});

const labelVisual: VisualEvaluator<Props> = (node) => ({
  kind: "text",
  text: stringProp(node.props, "text", node.name ?? "Rótulo"),
  color: stringProp(node.props, "color", "#f4f7fb"),
  fontFamily: stringProp(node.props, "fontFamily", "Open Sans"),
  fontSize: positiveProp(node.props, "fontSize", 18),
  fontWeight: fontWeightProp(node.props, "normal"),
  align: enumProp(node.props, "align", ["left", "center", "right"], "center"),
});

const imageVisual: VisualEvaluator<Props> = (node) => ({
  kind: "image",
  source: stringProp(node.props, "source", stringProp(node.props, "assetId", "")),
  tint: stringProp(node.props, "tint", "#ffffff"),
});

const svgVisual: VisualEvaluator<Props> = (node) => ({
  kind: "image",
  source: stringProp(node.props, "source", stringProp(node.props, "assetId", "")),
  tint: stringProp(node.props, "tint", stringProp(node.props, "fill", "#ffffff")),
});

const lineVisual: VisualEvaluator<Props> = (node) => ({
  kind: "line",
  points: pointsProp(node.props, "points", [
    [-50, 0],
    [50, 0],
  ]),
  color: stringProp(node.props, "color", stringProp(node.props, "stroke", "#f4f7fb")),
  width: positiveProp(node.props, "width", positiveProp(node.props, "strokeWidth", 3)),
});

const polygonVisual: VisualEvaluator<Props> = (node) => {
  const fill = splitHexAlpha(stringProp(node.props, "fill", "#5a8dee4d"));
  return {
    kind: "polygon",
    points: pointsProp(node.props, "points", [
      [-40, 30],
      [0, -40],
      [40, 30],
    ]),
    fill: fill.color,
    fillAlpha: unitProp(node.props, "fillAlpha", fill.alpha),
    stroke: stringProp(node.props, "stroke", "#92b4f4"),
    strokeWidth: nonNegativeProp(node.props, "strokeWidth", 2),
  };
};

/**
 * Anéis vêm em `props.rings`, já projetados em pixels de tela relativos à origem
 * do nó. Quem projeta é o aplicativo, no mesmo passe que expande efeitos: o
 * renderer não conhece geografia nem câmera.
 *
 * Sem `rings` o nó desenha nada em vez de um contorno inventado — região cujo
 * `geoId` não resolveu tem de sumir, não virar um triângulo no meio do mapa.
 */
function ringsProp(props: Props, key: string): readonly (readonly Vec2[])[] {
  const value = rawProp(props, key);
  if (!Array.isArray(value)) return [];
  const rings: (readonly Vec2[])[] = [];
  for (const candidate of value) {
    if (!Array.isArray(candidate)) continue;
    const ring = pointsProp({ ring: candidate } as unknown as Props, "ring", []);
    if (ring.length >= 2) rings.push(ring);
  }
  return Object.freeze(rings);
}

const geoShapeVisual: VisualEvaluator<Props> = (node) => {
  const fill = splitHexAlpha(stringProp(node.props, "fill", "#38bdf83d"));
  const stroke = splitHexAlpha(stringProp(node.props, "stroke", "#7dd3fcff"));
  return {
    kind: "geo-shape",
    rings: ringsProp(node.props, "rings"),
    // Rio manda `closed: false` explicitamente; região omite e fecha.
    closed: rawProp(node.props, "closed") !== false,
    fill: fill.color,
    fillAlpha: unitProp(node.props, "fillAlpha", fill.alpha),
    stroke: stroke.color,
    strokeWidth: nonNegativeProp(node.props, "strokeWidth", 2),
    strokeAlpha: unitProp(node.props, "strokeAlpha", stroke.alpha),
  };
};

const calloutVisual: VisualEvaluator<Props> = (node) => {
  const background = splitHexAlpha(stringProp(node.props, "background", "#0b1118e0"));
  const leaderRaw = rawProp(node.props, "leader");
  const leader = pointsProp({ p: [leaderRaw] } as unknown as Props, "p", []);
  return {
    kind: "callout",
    text: stringProp(node.props, "text", node.name ?? "Rótulo"),
    color: stringProp(node.props, "color", "#f4f7fb"),
    fontFamily: stringProp(node.props, "fontFamily", "Open Sans"),
    fontSize: positiveProp(node.props, "fontSize", 16),
    fontWeight: fontWeightProp(node.props, "bold"),
    background: background.color,
    backgroundAlpha: unitProp(node.props, "backgroundAlpha", background.alpha),
    borderColor: stringProp(node.props, "borderColor", "#7dd3fcff"),
    borderWidth: nonNegativeProp(node.props, "borderWidth", 1),
    cornerRadius: nonNegativeProp(node.props, "cornerRadius", 4),
    paddingX: nonNegativeProp(node.props, "paddingX", 10),
    paddingY: nonNegativeProp(node.props, "paddingY", 5),
    // O aplicativo põe o vetor aqui; ausência esconde a linha.
    leader: leader[0] ?? null,
    leaderColor: stringProp(node.props, "leaderColor", "#7dd3fcff"),
    leaderWidth: nonNegativeProp(node.props, "leaderWidth", 1.5),
  };
};

const iconVisual: VisualEvaluator<Props> = (node) => ({
  kind: "symbol",
  shape: enumProp(node.props, "shape", ["square", "diamond", "triangle", "circle"], "diamond"),
  size: positiveProp(node.props, "size", 28),
  fill: stringProp(node.props, "fill", stringProp(node.props, "color", "#0f1720")),
  stroke: stringProp(node.props, "stroke", stringProp(node.props, "outline", "#f4f7fb")),
  strokeWidth: nonNegativeProp(
    node.props,
    "strokeWidth",
    nonNegativeProp(node.props, "outlineWidth", 2),
  ),
  label: stringProp(node.props, "label", stringProp(node.props, "iconId", "")),
  labelColor: stringProp(node.props, "labelColor", "#f4f7fb"),
});

const armorVisual: VisualEvaluator<Props> = (node) =>
  unitVisual(
    node,
    "square",
    stringProp(node.props, "label", stringProp(node.props, "callsign", "ARM")),
  );

const infantryVisual: VisualEvaluator<Props> = (node) =>
  unitVisual(
    node,
    "diamond",
    stringProp(node.props, "label", stringProp(node.props, "callsign", "INF")),
  );

function unitVisual(
  node: Readonly<ScreenNode<Props>>,
  fallbackShape: SymbolPrimitive["shape"],
  label: string,
): SymbolPrimitive {
  return {
    kind: "symbol",
    shape: enumProp(
      node.props,
      "shape",
      ["square", "diamond", "triangle", "circle"],
      fallbackShape,
    ),
    size: positiveProp(node.props, "size", 32),
    fill: stringProp(node.props, "fill", stringProp(node.props, "tint", "#141c26")),
    stroke: stringProp(node.props, "stroke", "#f2c94c"),
    strokeWidth: nonNegativeProp(node.props, "strokeWidth", 2),
    label,
    labelColor: stringProp(node.props, "labelColor", "#f4f7fb"),
  };
}

/**
 * Renderable de partículas. O nó sintético carrega o buffer em `props`, montado
 * por `@theatrum/effects`; aqui só empacotamos para o backend. Não há avaliação
 * por partícula na CPU: quem resolve posição é o vertex shader.
 */
const particlesVisual: VisualEvaluator<Props> = (node) => {
  const data = rawProp(node.props, "data");
  const colors = rawProp(node.props, "colors");
  const palette = rawProp(node.props, "palette");
  if (!(data instanceof Float32Array) || !(colors instanceof Uint8Array)) return NONE;
  return {
    kind: "particles",
    bufferId: stringProp(node.props, "bufferId", node.id),
    count: Math.max(0, Math.floor(numberProp(node.props, "count", 0))),
    stride: Math.max(1, Math.floor(numberProp(node.props, "stride", 1))),
    data,
    colors,
    palette: Array.isArray(palette)
      ? palette.filter((entry): entry is string => typeof entry === "string")
      : ["#ffffff"],
    frame: numberProp(node.props, "frame", 0),
    fade: enumProp(node.props, "fade", ["out", "in-out", "flash", "hold"], "out"),
    blend: enumProp(node.props, "blend", ["normal", "add", "screen"], "normal"),
    opacity: unitProp(node.props, "opacity", 1),
    wobble: nonNegativeProp(node.props, "wobble", 0),
    wobbleHz: nonNegativeProp(node.props, "wobbleHz", 0),
    fps: positiveProp(node.props, "fps", 60),
    drift: rawProp(node.props, "drift") === true,
  };
};

export const BUILTIN_RENDERABLE_TYPES = [
  "group",
  "null",
  "precomp",
  "effect.particles",
  "text.title",
  "text.label",
  "image",
  "svg",
  "shape.line",
  "shape.polygon",
  "shape.circle",
  "geo.region",
  "geo.rivers",
  "label.callout",
  "geo.roads",
  "symbol.icon",
  "unit.armor",
  "unit.infantry",
  "model3d",
  "route3d",
] as const;

const BUILTIN_EVALUATORS: Readonly<
  Record<(typeof BUILTIN_RENDERABLE_TYPES)[number], VisualEvaluator<Props>>
> = {
  group: noVisual,
  null: noVisual,
  // Pré-composição não tem visual próprio: o conteúdo dela são os nós
  // expandidos pelo avaliador, cada um com o próprio renderable.
  precomp: noVisual,
  "effect.particles": particlesVisual,
  "text.title": titleVisual,
  "text.label": labelVisual,
  image: imageVisual,
  svg: svgVisual,
  "shape.line": lineVisual,
  "shape.polygon": polygonVisual,
  "shape.circle": circleVisual,
  // Região, rio e estradas compartilham a primitiva: o que muda é `closed` nas props.
  "geo.region": geoShapeVisual,
  "geo.rivers": geoShapeVisual,
  "label.callout": calloutVisual,
  "geo.roads": geoShapeVisual,
  "symbol.icon": iconVisual,
  "unit.armor": armorVisual,
  "unit.infantry": infantryVisual,
  // Modelo 3D e rota 3D não têm primitiva Pixi: quem desenha é a camada
  // Three.js do viewport, direto no canvas do MapLibre. Uma rota tem altitude e
  // volume, então não cabe no overlay 2D — o lugar dela é o depth buffer da
  // cena 3D, junto do modelo que a percorre.
  model3d: noVisual,
  route3d: noVisual,
};

/**
 * Registro explícito dos tipos da F4. Um tipo novo entra aqui e no registro de
 * `scene-graph`; lifecycle, compositor e backends não mudam. O teste de
 * extensibilidade prova o mesmo caminho para tipos de fora deste pacote.
 */
export function registerBuiltinRenderables(registry: RenderableRegistry): Disposable {
  const registrations = new DisposableStore();
  for (const type of BUILTIN_RENDERABLE_TYPES) {
    registrations.add(
      registry.register(type, createDataRenderableFactory(BUILTIN_EVALUATORS[type])),
    );
  }
  return registrations;
}

export function createBuiltinRenderableRegistry(): RenderableRegistry {
  const registry = new RenderableRegistry();
  registerBuiltinRenderables(registry);
  return registry;
}

export function evaluateBuiltinVisual(
  type: (typeof BUILTIN_RENDERABLE_TYPES)[number],
  node: Readonly<ScreenNode<Props>>,
): Readonly<VisualPrimitive> {
  return BUILTIN_EVALUATORS[type](node);
}

/**
 * Renderable de `shape.circle`, também exposto para plugins. O alfa embutido no
 * hex é separado como no polígono, para que `#3b82f680` não aplique alfa duas
 * vezes no Pixi.
 */
export function circleVisual(node: Readonly<ScreenNode<Props>>): CirclePrimitive {
  const fill = splitHexAlpha(stringProp(node.props, "fill", "#5a8dee59"));
  return {
    kind: "circle",
    radius: positiveProp(node.props, "radius", node.layout.size[0] / 2),
    fill: fill.color,
    fillAlpha: unitProp(node.props, "fillAlpha", fill.alpha),
    stroke: stringProp(node.props, "stroke", "#dbeafe"),
    strokeWidth: nonNegativeProp(node.props, "strokeWidth", 2),
  };
}

function stringProp(props: Props, key: string, fallback: string): string {
  const value = rawProp(props, key);
  return typeof value === "string" ? value : fallback;
}

function numberProp(props: Props, key: string, fallback: number): number {
  const value = rawProp(props, key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveProp(props: Props, key: string, fallback: number): number {
  const value = numberProp(props, key, fallback);
  return value > 0 ? value : fallback;
}

function nonNegativeProp(props: Props, key: string, fallback: number): number {
  const value = numberProp(props, key, fallback);
  return value >= 0 ? value : fallback;
}

function unitProp(props: Props, key: string, fallback: number): number {
  const value = numberProp(props, key, fallback);
  return Math.max(0, Math.min(1, value));
}

function enumProp<const T extends string>(
  props: Props,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = rawProp(props, key);
  return typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;
}

function pointsProp(props: Props, key: string, fallback: readonly Vec2[]): readonly Vec2[] {
  const value = rawProp(props, key);
  if (!Array.isArray(value)) return fallback;

  const points: Vec2[] = [];
  for (const candidate of value) {
    if (
      !Array.isArray(candidate) ||
      candidate.length !== 2 ||
      typeof candidate[0] !== "number" ||
      !Number.isFinite(candidate[0]) ||
      typeof candidate[1] !== "number" ||
      !Number.isFinite(candidate[1])
    ) {
      return fallback;
    }
    points.push([candidate[0], candidate[1]]);
  }
  return points.length >= 2 ? points : fallback;
}

function fontWeightProp(
  props: Props,
  fallback: TextPrimitive["fontWeight"],
): TextPrimitive["fontWeight"] {
  const value = rawProp(props, "fontWeight");
  if (value === "bold" || value === "normal") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value >= 600 ? "bold" : "normal";
  return fallback;
}

function rawProp(props: Props, key: string): unknown {
  const value = props[key];
  if (typeof value === "object" && value !== null && "value" in value) {
    return value.value;
  }
  return value;
}

function splitHexAlpha(color: string): { readonly color: string; readonly alpha: number } {
  if (/^#[0-9a-fA-F]{8}$/.test(color)) {
    return {
      color: color.slice(0, 7),
      alpha: Number.parseInt(color.slice(7, 9), 16) / 255,
    };
  }
  return { color, alpha: 1 };
}
