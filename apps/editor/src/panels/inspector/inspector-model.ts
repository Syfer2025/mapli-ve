import type { NodeTypeDefinition, PropertyDescriptor, PropertyGroup } from "@theatrum/scene-graph";
import type { Node } from "@theatrum/schema";
import { resolveNodeAnimatableProperty } from "../../document/optional-animatable-property.js";
import { parsePropertyPath } from "../timeline/timeline-model.js";

export interface InspectorProperty {
  readonly descriptor: PropertyDescriptor;
  readonly path: readonly string[];
  readonly value: unknown;
  readonly keyframeCount: number;
  readonly animated: boolean;
  readonly available: boolean;
}

export interface InspectorGroup {
  readonly id: PropertyGroup;
  readonly label: string;
  readonly properties: readonly InspectorProperty[];
}

export interface InspectorModel {
  readonly typeLabel: string;
  readonly groups: readonly InspectorGroup[];
}

/** O modelo depende apenas de descriptors; não há ramificação por `node.type`. */
export function buildInspectorModel(
  node: Node,
  definition: NodeTypeDefinition | undefined,
): InspectorModel {
  if (definition === undefined) {
    return Object.freeze({
      typeLabel: node.type,
      groups: Object.freeze([]),
    });
  }

  const grouped = new Map<PropertyGroup, InspectorProperty[]>();
  for (const descriptor of definition.properties) {
    const property = inspectorProperty(node, definition, descriptor);
    const properties = grouped.get(descriptor.group);
    if (properties === undefined) grouped.set(descriptor.group, [property]);
    else properties.push(property);
  }

  return Object.freeze({
    typeLabel: definition.label,
    groups: Object.freeze(
      GROUP_ORDER.flatMap((group) => {
        const properties = grouped.get(group);
        return properties === undefined || properties.length === 0
          ? []
          : [
              Object.freeze({
                id: group,
                label: GROUP_LABELS[group],
                properties: Object.freeze(properties),
              }),
            ];
      }),
    ),
  });
}

export function controlNumberToStoredValue(value: number, descriptor: PropertyDescriptor): number {
  const normalized = descriptor.unit === "percent" ? value / 100 : value;
  const minimum = descriptor.min ?? Number.NEGATIVE_INFINITY;
  const maximum = descriptor.max ?? Number.POSITIVE_INFINITY;
  return Math.min(maximum, Math.max(minimum, normalized));
}

export function storedNumberToControlValue(value: number, descriptor: PropertyDescriptor): number {
  return descriptor.unit === "percent" ? value * 100 : value;
}

export function unitLabel(descriptor: PropertyDescriptor): string | undefined {
  switch (descriptor.unit) {
    case "degrees":
      return "°";
    case "meters":
      return "m";
    case "percent":
      return "%";
    case "px":
      return "px";
    case "ratio":
      return "×";
    case "km/h":
      return "km/h";
    case undefined:
      return undefined;
  }
  return undefined;
}

export function readPath(source: object, path: string): unknown {
  let value: unknown = source;
  for (const segment of parsePropertyPath(path)) {
    if (typeof value !== "object" || value === null) return undefined;
    value = Reflect.get(value, segment);
  }
  return value;
}

function inspectorProperty(
  node: Node,
  definition: NodeTypeDefinition,
  descriptor: PropertyDescriptor,
): InspectorProperty {
  if (descriptor.binding === "animatable") {
    const property = resolveNodeAnimatableProperty(node, definition, descriptor.path)?.property;
    return Object.freeze({
      descriptor,
      path: parsePropertyPath(descriptor.path),
      value: property?.value,
      keyframeCount: property?.keyframes.length ?? 0,
      animated: (property?.keyframes.length ?? 0) > 0,
      available: property !== undefined,
    });
  }

  const value = readPath(node, descriptor.path);
  return Object.freeze({
    descriptor,
    path: parsePropertyPath(descriptor.path),
    value,
    keyframeCount: 0,
    animated: false,
    available: value !== undefined,
  });
}

const GROUP_ORDER: readonly PropertyGroup[] = Object.freeze([
  "layout",
  "transform",
  "appearance",
  "content",
]);

const GROUP_LABELS: Readonly<Record<PropertyGroup, string>> = Object.freeze({
  layout: "Layout",
  transform: "Transformação",
  appearance: "Aparência",
  content: "Conteúdo",
});
