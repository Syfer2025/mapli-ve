import type { NodeTypeDefinition, PropertyDescriptor } from "@theatrum/scene-graph";
import type { AnimatableProperty, Node } from "@theatrum/schema";

export interface ResolvedNodeAnimatableProperty {
  readonly descriptor: PropertyDescriptor;
  readonly property: AnimatableProperty<unknown>;
  /**
   * `true` quando o wrapper não existe no documento e foi hidratado pelo schema
   * do tipo. A sessão usa esse sinal para materializá-lo pelo Command Bus antes
   * da primeira edição.
   */
  readonly initializationRequired: boolean;
}

/**
 * Resolve somente paths declarados pelo tipo como binding animável.
 *
 * Props opcionais antigas não vêm diretamente de `defaultProps`: o schema é a
 * autoridade da compatibilidade. Ele pode hidratar zero para documento antigo,
 * enquanto `defaultProps` mantém outro valor para um nó criado hoje.
 */
export function resolveNodeAnimatableProperty(
  node: Node,
  definition: NodeTypeDefinition | undefined,
  path: string,
): ResolvedNodeAnimatableProperty | undefined {
  if (definition === undefined) return undefined;
  const descriptor = definition.properties.find(
    (candidate) => candidate.path === path && candidate.binding === "animatable",
  );
  if (descriptor === undefined) return undefined;

  const segments = path.split(".");
  const stored = readPath(node, segments);
  const storedProperty = asAnimatableProperty(stored);
  if (storedProperty !== undefined) {
    return Object.freeze({
      descriptor,
      property: storedProperty,
      initializationRequired: false,
    });
  }
  // Valor presente, mas malformado: não o esconda atrás de um default plausível.
  if (stored !== undefined || segments[0] !== "props") return undefined;

  const parsed = definition.propertySchema.safeParse(node.props);
  if (!parsed.success) return undefined;
  const hydrated = readPath(parsed.data, segments.slice(1));
  const hydratedProperty = asAnimatableProperty(hydrated);
  if (hydratedProperty === undefined) return undefined;
  return Object.freeze({
    descriptor,
    property: hydratedProperty,
    initializationRequired: true,
  });
}

function readPath(source: object, segments: readonly string[]): unknown {
  let value: unknown = source;
  for (const segment of segments) {
    if (typeof value !== "object" || value === null) return undefined;
    value = Reflect.get(value, segment);
  }
  return value;
}

function asAnimatableProperty(value: unknown): AnimatableProperty<unknown> | undefined {
  return typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "keyframes" in value &&
    Array.isArray(Reflect.get(value, "keyframes")) &&
    "expression" in value
    ? (value as AnimatableProperty<unknown>)
    : undefined;
}
