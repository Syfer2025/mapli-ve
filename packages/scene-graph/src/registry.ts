import { toDisposable, type Disposable } from "@theatrum/core-utils";
import type { Node } from "@theatrum/schema";
import type { z } from "zod";
import type { NodeCategory, NodeTypeDefinition, PropertyDescriptor } from "./contracts.js";
import { NodeTypeRegistrationError } from "./errors.js";

export type NodeTypeResolution =
  | {
      readonly status: "resolved";
      readonly definition: NodeTypeDefinition;
      readonly props: Record<string, unknown>;
    }
  | {
      readonly status: "unresolved";
      readonly type: string;
      readonly props: Record<string, unknown>;
    }
  | {
      readonly status: "invalid-props";
      readonly definition: NodeTypeDefinition;
      readonly error: z.ZodError;
      readonly props: Record<string, unknown>;
    }
  | {
      readonly status: "children-not-supported";
      readonly definition: NodeTypeDefinition;
      readonly nodeId: string;
      readonly children: readonly string[];
    };

export interface NodeTypeRegistry {
  readonly size: number;
  register<P extends Record<string, unknown>>(definition: NodeTypeDefinition<P>): Disposable;
  get(type: string): NodeTypeDefinition | undefined;
  has(type: string): boolean;
  list(category?: NodeCategory): readonly NodeTypeDefinition[];
  resolve(node: Node): NodeTypeResolution;
  createDefaultProps(type: string): Record<string, unknown>;
}

const NODE_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const PROPERTY_PATH_PATTERN = /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/;
const RESERVED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

class DefaultNodeTypeRegistry implements NodeTypeRegistry {
  readonly #definitions = new Map<string, NodeTypeDefinition>();

  get size(): number {
    return this.#definitions.size;
  }

  register<P extends Record<string, unknown>>(definition: NodeTypeDefinition<P>): Disposable {
    const normalized = normalizeDefinition(definition);
    if (this.#definitions.has(normalized.type)) {
      throw new NodeTypeRegistrationError(
        "duplicate-type",
        normalized.type,
        `O tipo de nó "${normalized.type}" já está registrado.`,
      );
    }

    this.#definitions.set(normalized.type, normalized);
    return toDisposable(() => {
      if (this.#definitions.get(normalized.type) === normalized) {
        this.#definitions.delete(normalized.type);
      }
    });
  }

  get(type: string): NodeTypeDefinition | undefined {
    return this.#definitions.get(type);
  }

  has(type: string): boolean {
    return this.#definitions.has(type);
  }

  list(category?: NodeCategory): readonly NodeTypeDefinition[] {
    const result =
      category === undefined
        ? [...this.#definitions.values()]
        : [...this.#definitions.values()].filter((definition) => definition.category === category);
    return Object.freeze(result);
  }

  resolve(node: Node): NodeTypeResolution {
    const definition = this.#definitions.get(node.type);
    if (definition === undefined) {
      return Object.freeze({
        status: "unresolved" as const,
        type: node.type,
        props: node.props,
      });
    }

    if (!definition.supportsChildren && node.children.length > 0) {
      return Object.freeze({
        status: "children-not-supported" as const,
        definition,
        nodeId: node.id,
        children: Object.freeze([...node.children]),
      });
    }

    const parsed = definition.propertySchema.safeParse(node.props);
    if (!parsed.success) {
      return Object.freeze({
        status: "invalid-props" as const,
        definition,
        error: parsed.error,
        props: node.props,
      });
    }

    return Object.freeze({
      status: "resolved" as const,
      definition,
      props: parsed.data,
    });
  }

  createDefaultProps(type: string): Record<string, unknown> {
    const definition = this.#definitions.get(type);
    if (definition === undefined) {
      throw new NodeTypeRegistrationError(
        "invalid-type",
        type,
        `O tipo de nó "${type}" não está registrado.`,
      );
    }
    // Zod devolve um clone, impedindo que a criação de um nó altere defaults
    // compartilhados pelo registry.
    return definition.propertySchema.parse(definition.defaultProps);
  }
}

export function createNodeTypeRegistry(
  definitions: readonly NodeTypeDefinition[] = [],
): NodeTypeRegistry {
  const registry = new DefaultNodeTypeRegistry();
  for (const definition of definitions) registry.register(definition);
  return registry;
}

function normalizeDefinition<P extends Record<string, unknown>>(
  definition: NodeTypeDefinition<P>,
): NodeTypeDefinition<P> {
  validateType(definition.type);
  const paths = new Set<string>();
  const properties = definition.properties.map((descriptor) => {
    validateDescriptor(definition.type, descriptor, paths);
    return freezeDescriptor(descriptor);
  });
  const expectedAnimatable = properties
    .filter((descriptor) => descriptor.animatable)
    .map((descriptor) => descriptor.path);
  const receivedAnimatable = definition.animatable.map((descriptor) => descriptor.path);
  if (
    expectedAnimatable.length !== receivedAnimatable.length ||
    expectedAnimatable.some((path, index) => receivedAnimatable[index] !== path)
  ) {
    throw new NodeTypeRegistrationError(
      "invalid-animatable-list",
      definition.type,
      `A lista animatable de "${definition.type}" deve ser o subconjunto ordenado de properties.`,
    );
  }

  const parsedDefaults = definition.propertySchema.safeParse(definition.defaultProps);
  if (!parsedDefaults.success) {
    throw new NodeTypeRegistrationError(
      "invalid-type",
      definition.type,
      `defaultProps inválido para "${definition.type}": ${parsedDefaults.error.message}`,
    );
  }

  const normalizedProperties = Object.freeze(properties);
  const normalizedAnimatable = Object.freeze(
    properties.filter((descriptor) => descriptor.animatable),
  );
  const normalized: NodeTypeDefinition<P> = {
    type: definition.type,
    category: definition.category,
    label: definition.label,
    icon: definition.icon,
    defaultProps: deepFreeze(parsedDefaults.data),
    propertySchema: definition.propertySchema,
    properties: normalizedProperties,
    animatable: normalizedAnimatable,
    supportsChildren: definition.supportsChildren,
    defaultAnchorSpace: definition.defaultAnchorSpace,
    defaultSizeMode: definition.defaultSizeMode,
  };
  return Object.freeze(normalized);
}

function validateType(type: string): void {
  if (!NODE_TYPE_PATTERN.test(type)) {
    throw new NodeTypeRegistrationError(
      "invalid-type",
      type,
      `Tipo de nó inválido: "${type}". Use segmentos minúsculos separados por ponto.`,
    );
  }
}

function validateDescriptor(
  type: string,
  descriptor: PropertyDescriptor,
  paths: Set<string>,
): void {
  const segments = descriptor.path.split(".");
  if (
    !PROPERTY_PATH_PATTERN.test(descriptor.path) ||
    segments.some((segment) => RESERVED_PATH_SEGMENTS.has(segment))
  ) {
    throw new NodeTypeRegistrationError(
      "invalid-property-path",
      type,
      `Caminho de propriedade inválido em "${type}": "${descriptor.path}".`,
    );
  }
  if (paths.has(descriptor.path)) {
    throw new NodeTypeRegistrationError(
      "duplicate-property",
      type,
      `A propriedade "${descriptor.path}" está duplicada em "${type}".`,
    );
  }
  paths.add(descriptor.path);
}

function freezeDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  const options =
    descriptor.options === undefined
      ? undefined
      : Object.freeze(
          descriptor.options.map((option) =>
            Object.freeze({ value: option.value, label: option.label }),
          ),
        );
  return Object.freeze({
    ...descriptor,
    ...(options === undefined ? {} : { options }),
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
