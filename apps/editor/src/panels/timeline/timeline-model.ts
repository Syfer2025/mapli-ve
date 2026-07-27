import type { AnimatableProperty, Composition, Keyframe, Node } from "@theatrum/schema";

export const TIMELINE_RULER_HEIGHT = 24;
export const TIMELINE_ROW_HEIGHT = 22;

export interface TimelinePropertyDescriptor {
  readonly path: string;
  readonly label: string;
  readonly group: string;
  readonly animatable: boolean;
}

export interface TimelineNodeTypeDefinition {
  readonly properties: readonly TimelinePropertyDescriptor[];
}

export interface TimelineNodeTypeRegistry {
  get(type: string): TimelineNodeTypeDefinition | undefined;
}

export interface TimelineKeyframe {
  readonly id: string;
  readonly nodeId: string;
  readonly propertyPath: string;
  readonly frame: number;
  readonly easing: "hold" | "linear" | "bezier";
}

export interface TimelineTrack {
  readonly id: string;
  readonly kind: "node" | "property";
  readonly nodeId: string;
  readonly propertyPath: string | null;
  readonly label: string;
  readonly depth: number;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly selected: boolean;
  readonly labelColor: string;
  readonly timeRange: readonly [number, number];
  readonly keyframes: readonly TimelineKeyframe[];
}

export interface TimelineMarker {
  readonly frame: number;
  readonly label: string;
  readonly color: string;
}

export interface TimelineModel {
  readonly duration: number;
  readonly fps: number;
  readonly workArea: readonly [number, number];
  readonly tracks: readonly TimelineTrack[];
  readonly markers: readonly TimelineMarker[];
}

export interface BuildTimelineOptions {
  readonly expandedNodeIds?: ReadonlySet<string>;
  readonly selectedNodeIds?: ReadonlySet<string>;
  readonly hideShy?: boolean;
  /** Mantém propriedades sem keyframes visíveis quando o nó está expandido. */
  readonly includeEmptyProperties?: boolean;
  /** Rótulo por tipo de comportamento, vindo do registry de quem chama. */
  readonly behaviorLabels?: Readonly<Record<string, string>>;
}

/**
 * Constrói a representação imutável que alimenta tanto o canvas quanto a camada
 * DOM acessível. O registry é a única fonte das trilhas de propriedade.
 */
export function buildTimelineModel(
  composition: Composition,
  registry: TimelineNodeTypeRegistry,
  options: BuildTimelineOptions = {},
): TimelineModel {
  const expandedNodeIds = options.expandedNodeIds ?? EMPTY_IDS;
  const selectedNodeIds = options.selectedNodeIds ?? EMPTY_IDS;
  const includeEmptyProperties = options.includeEmptyProperties ?? true;
  const tracks: TimelineTrack[] = [];
  const visited = new Set<string>();

  const appendNode = (nodeId: string, depth: number): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = composition.nodes[nodeId];
    if (node === undefined) return;

    if (!(options.hideShy === true && node.shy)) {
      tracks.push(nodeTrack(node, depth, selectedNodeIds.has(node.id)));

      if (expandedNodeIds.has(node.id)) {
        const definition = registry.get(node.type);
        for (const descriptor of definition?.properties ?? []) {
          if (!descriptor.animatable) continue;
          const property = readAnimatableProperty(node, descriptor.path);
          if (property === undefined) continue;
          if (!includeEmptyProperties && property.keyframes.length === 0) continue;
          tracks.push(propertyTrack(node, descriptor, property, depth + 1));
        }
        for (const descriptor of behaviorDescriptors(node, options.behaviorLabels)) {
          const property = readAnimatableProperty(node, descriptor.path);
          if (property === undefined) continue;
          if (!includeEmptyProperties && property.keyframes.length === 0) continue;
          tracks.push(propertyTrack(node, descriptor, property, depth + 1));
        }
      }
    }

    for (const childId of node.children) appendNode(childId, depth + 1);
  };

  appendNode(composition.root, 0);

  // Documentos parcialmente recuperados podem conter nós ainda não ligados à
  // raiz. Eles continuam editáveis e aparecem em ordem estável no fim.
  for (const nodeId of Object.keys(composition.nodes).sort()) {
    appendNode(nodeId, 0);
  }

  return Object.freeze({
    duration: composition.duration,
    fps: composition.fps,
    workArea: frozenRange(composition.workArea[0], composition.workArea[1]),
    tracks: Object.freeze(tracks),
    markers: Object.freeze(
      composition.markers.map((marker) =>
        Object.freeze({
          frame: marker.frame,
          label: marker.label,
          color: marker.color,
        }),
      ),
    ),
  });
}

export function parsePropertyPath(path: string): readonly string[] {
  if (path.length === 0) return EMPTY_PATH;
  if (!path.startsWith("/")) return Object.freeze(path.split(".").filter(Boolean));
  return Object.freeze(
    path
      .slice(1)
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~")),
  );
}

export function readAnimatableProperty(
  source: object,
  path: string,
): AnimatableProperty<unknown> | undefined {
  let value: unknown = source;
  for (const segment of parsePropertyPath(path)) {
    if (typeof value !== "object" || value === null) return undefined;
    value = Reflect.get(value, segment);
  }
  return isAnimatableProperty(value) ? value : undefined;
}

function nodeTrack(node: Node, depth: number, selected: boolean): TimelineTrack {
  return Object.freeze({
    id: `node:${node.id}`,
    kind: "node",
    nodeId: node.id,
    propertyPath: null,
    label: node.name,
    depth,
    enabled: node.enabled,
    locked: node.locked,
    selected,
    labelColor: node.label,
    timeRange: frozenRange(node.timeRange.in, node.timeRange.out),
    keyframes: EMPTY_KEYFRAMES,
  });
}

function propertyTrack(
  node: Node,
  descriptor: TimelinePropertyDescriptor,
  property: AnimatableProperty<unknown>,
  depth: number,
): TimelineTrack {
  return Object.freeze({
    id: `property:${node.id}:${descriptor.path}`,
    kind: "property",
    nodeId: node.id,
    propertyPath: descriptor.path,
    label: descriptor.label,
    depth,
    enabled: node.enabled,
    locked: node.locked,
    selected: false,
    labelColor: node.label,
    timeRange: frozenRange(node.timeRange.in, node.timeRange.out),
    keyframes: Object.freeze(
      property.keyframes.map((keyframe) => timelineKeyframe(node.id, descriptor.path, keyframe)),
    ),
  });
}

/**
 * Params animáveis de comportamento viram trilha sem registry nenhum: a busca é
 * **estrutural**, procurando wrappers `{ value, keyframes, expression }` dentro
 * de `behaviors[i].params`. Assim um comportamento novo — inclusive de plugin —
 * ganha trilha editável sem tocar na timeline.
 *
 * O caminho usa o índice do comportamento porque `behaviors` é um array; ele é
 * recalculado a cada build, então reordenar não deixa caminho velho para trás.
 */
function behaviorDescriptors(
  node: Node,
  labels: Readonly<Record<string, string>> = {},
): readonly TimelinePropertyDescriptor[] {
  const descriptors: TimelinePropertyDescriptor[] = [];
  node.behaviors.forEach((behavior, index) => {
    const prefix = labels[behavior.type] ?? behavior.type;
    for (const [key, value] of Object.entries(behavior.params)) {
      if (!isAnimatableProperty(value)) continue;
      descriptors.push({
        path: `behaviors.${index}.params.${key}`,
        label: `${prefix} · ${key}`,
        group: "behavior",
        animatable: true,
      });
    }
  });
  return Object.freeze(descriptors);
}

function timelineKeyframe(
  nodeId: string,
  propertyPath: string,
  keyframe: Keyframe<unknown>,
): TimelineKeyframe {
  return Object.freeze({
    id: keyframe.id,
    nodeId,
    propertyPath,
    frame: keyframe.frame,
    easing: keyframe.out.kind,
  });
}

function isAnimatableProperty(value: unknown): value is AnimatableProperty<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "keyframes" in value &&
    Array.isArray(Reflect.get(value, "keyframes")) &&
    "expression" in value
  );
}

function frozenRange(start: number, end: number): readonly [number, number] {
  return Object.freeze([start, end] as [number, number]);
}

const EMPTY_IDS: ReadonlySet<string> = Object.freeze(new Set<string>());
const EMPTY_PATH: readonly string[] = Object.freeze([]);
const EMPTY_KEYFRAMES: readonly TimelineKeyframe[] = Object.freeze([]);
