import { clamp01, type Vec2 } from "@theatrum/core-math";
import { topologicalOrder, type EvaluatedNodeLike } from "@theatrum/scene-graph";
import type {
  Anchor,
  BlendMode,
  Composition,
  EffectInstanceData,
  Node,
  ProjectDocument,
  SizeSpec,
  TrackMatte,
} from "@theatrum/schema";
import { evaluateProperty } from "./property.js";

export interface EvaluatedCamera {
  readonly center: Vec2;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
  readonly roll: number;
  readonly fov: number;
}

export interface EvaluatedEffect {
  readonly id: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface EvaluatedNode<
  P extends Record<string, unknown> = Record<string, unknown>,
> extends EvaluatedNodeLike<P> {
  readonly name: string;
  readonly synthetic: false;
  readonly locked: boolean;
  readonly blendMode: BlendMode;
  /** Recorte por outro nó, se houver. A validade da origem é do documento. */
  readonly trackMatte: TrackMatte | null;
  readonly effects: readonly EvaluatedEffect[];
}

export interface EvaluatedScene {
  readonly compositionId: string;
  readonly frame: number;
  readonly camera: EvaluatedCamera;
  readonly nodes: ReadonlyMap<string, EvaluatedNode>;
  readonly drawOrder: readonly string[];
}

export interface EvaluateOptions {
  /**
   * Mantém o playhead dentro da composição. Ativo por padrão; exportadores que
   * precisam de amostragem fora do intervalo podem desativá-lo explicitamente.
   */
  readonly clampFrame?: boolean;
}

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}

/**
 * Avaliador puro do documento persistido. Não consulta DOM, relógio, mapa ou
 * GPU e, portanto, devolve o mesmo resultado independentemente da ordem em que
 * os frames são pedidos.
 */
export function evaluate(
  document: ProjectDocument,
  compositionId: string,
  requestedFrame: number,
  options: EvaluateOptions = {},
): EvaluatedScene {
  const composition = document.compositions.find((candidate) => candidate.id === compositionId);
  if (composition === undefined) {
    throw new EvaluationError(`Composição não encontrada: "${compositionId}".`);
  }
  if (!Number.isFinite(requestedFrame)) {
    throw new EvaluationError("O frame deve ser um número finito.");
  }

  const frame =
    options.clampFrame === false
      ? requestedFrame
      : Math.max(0, Math.min(composition.duration, requestedFrame));
  const evaluated = new Map<string, EvaluatedNode>();
  const drawOrder = expandComposition(document, composition, frame, evaluated, {
    prefix: "",
    parentId: null,
    stack: [composition.id],
  });

  return Object.freeze({
    compositionId: composition.id,
    frame,
    camera: evaluateCamera(composition, frame),
    nodes: evaluated,
    drawOrder: Object.freeze(drawOrder),
  });
}

interface ExpansionContext {
  /** Prefixo de id para nós vindos de pré-composição aninhada. */
  readonly prefix: string;
  /** Nó que passa a ser pai da raiz aninhada. */
  readonly parentId: string | null;
  /** Composições no caminho, para barrar aninhamento cíclico. */
  readonly stack: readonly string[];
}

/** Profundidade prática de aninhamento; acima disso o documento é ilegível. */
const MAX_PRECOMP_DEPTH = 8;

/**
 * Avalia uma composição para dentro de `evaluated` e devolve a ordem de desenho.
 *
 * Pré-composição é expandida aqui, e não no renderer, porque aninhar é uma
 * operação de **tempo e hierarquia**: o `timeRemap` do nó decide qual frame da
 * composição interna entra, e o transform dele passa a ser o pai da raiz interna.
 * Os ids ganham prefixo `nó/` para que a mesma composição possa ser aninhada duas
 * vezes sem colidir.
 */
function expandComposition(
  document: ProjectDocument,
  composition: Composition,
  frame: number,
  evaluated: Map<string, EvaluatedNode>,
  context: ExpansionContext,
): string[] {
  const order = topologicalOrder(composition);
  const soloSet = soloVisibilitySet(composition, order);
  const drawOrder: string[] = [];

  for (const nodeId of order) {
    const source = composition.nodes[nodeId];
    if (source === undefined) continue;
    const id = `${context.prefix}${source.id}`;
    const parentId =
      source.parent === null ? context.parentId : `${context.prefix}${source.parent}`;
    const parent = parentId === null ? undefined : evaluated.get(parentId);
    const localFrame =
      source.timeRemap === null ? frame : evaluateProperty(source.timeRemap, frame);
    const localOpacity = clamp01(evaluateProperty(source.transform.opacity, localFrame));
    const opacity = localOpacity * (parent?.opacity ?? 1);
    const inTimeRange = frame >= source.timeRange.in && frame <= source.timeRange.out;
    const selectedBySolo = soloSet === null || soloSet.has(source.id);
    const visible =
      source.enabled && inTimeRange && selectedBySolo && (parent?.visible ?? true) && opacity > 0;

    evaluated.set(
      id,
      Object.freeze({
        id,
        type: source.type,
        name: source.name,
        parent: parentId,
        synthetic: false as const,
        anchor: cloneValue(source.anchor),
        size: cloneValue(source.size),
        transform: Object.freeze({
          position: tuple2(evaluateProperty(source.transform.position, localFrame)),
          rotation: evaluateProperty(source.transform.rotation, localFrame),
          scale: tuple2(evaluateProperty(source.transform.scale, localFrame)),
          opacity: localOpacity,
          anchorPoint: tuple2(evaluateProperty(source.transform.anchorPoint, localFrame)),
          skew: tuple2(evaluateProperty(source.transform.skew, localFrame)),
          rotationReference: source.transform.rotationReference,
        }),
        props: evaluateValue(source.props, localFrame),
        effects: Object.freeze(source.effects.map((effect) => evaluateEffect(effect, localFrame))),
        opacity,
        visible,
        locked: source.locked,
        blendMode: source.blendMode,
        // A origem do recorte mora na mesma composição, então leva o mesmo
        // prefixo — sem isso o recorte se perderia dentro de pré-composição.
        trackMatte:
          source.trackMatte === null
            ? null
            : { ...source.trackMatte, source: `${context.prefix}${source.trackMatte.source}` },
      }),
    );
    drawOrder.push(id);

    const nested = nestedComposition(document, source, context);
    if (nested !== undefined) {
      // O frame que entra na composição interna é o já remapeado: é isso que
      // permite congelar, inverter ou acelerar o conteúdo aninhado.
      drawOrder.push(
        ...expandComposition(document, nested, localFrame, evaluated, {
          prefix: `${id}/`,
          parentId: id,
          stack: [...context.stack, nested.id],
        }),
      );
    }
  }

  return drawOrder;
}

/**
 * Composição referenciada por um nó `precomp`, quando ela existe e não fecha
 * ciclo. Ciclo e profundidade excessiva não derrubam a avaliação: o nó continua
 * na cena, apenas sem conteúdo interno — derrubar o preview inteiro por causa de
 * uma referência circular seria pior que mostrar um nó vazio.
 */
function nestedComposition(
  document: ProjectDocument,
  source: Node,
  context: ExpansionContext,
): Composition | undefined {
  if (source.type !== "precomp") return undefined;
  const reference = source.props["compositionId"];
  const compositionId =
    typeof reference === "string"
      ? reference
      : isAnimatableProperty(reference) && typeof reference.value === "string"
        ? reference.value
        : null;
  if (compositionId === null || compositionId.length === 0) return undefined;
  if (context.stack.includes(compositionId)) return undefined;
  if (context.stack.length >= MAX_PRECOMP_DEPTH) return undefined;
  return document.compositions.find((candidate) => candidate.id === compositionId);
}

function evaluateCamera(composition: Composition, frame: number): EvaluatedCamera {
  return Object.freeze({
    center: tuple2(evaluateProperty(composition.camera.center, frame)),
    zoom: evaluateProperty(composition.camera.zoom, frame),
    bearing: evaluateProperty(composition.camera.bearing, frame),
    pitch: evaluateProperty(composition.camera.pitch, frame),
    roll: evaluateProperty(composition.camera.roll, frame),
    fov: evaluateProperty(composition.camera.fov, frame),
  });
}

function evaluateEffect(effect: EffectInstanceData, frame: number): EvaluatedEffect {
  return Object.freeze({
    id: effect.id,
    type: effect.type,
    enabled: effect.enabled,
    params: evaluateValue(effect.params, frame),
  });
}

/**
 * Resolve wrappers animáveis em qualquer profundidade. Isso permite que tipos
 * adicionados ao registry tenham novas propriedades sem alterar o avaliador.
 */
export function evaluateValue<T>(value: T, frame: number): T {
  if (isAnimatableProperty(value)) {
    return evaluateValue(evaluateProperty(value, frame), frame) as T;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => evaluateValue(entry, frame))) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, evaluateValue(entry, frame)]),
      ),
    ) as T;
  }
  return value;
}

function isAnimatableProperty(value: unknown): value is {
  readonly value: unknown;
  readonly keyframes: Node["transform"]["opacity"]["keyframes"];
  readonly expression: string | null;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "keyframes" in value &&
    Array.isArray(value.keyframes) &&
    "expression" in value &&
    (typeof value.expression === "string" || value.expression === null)
  );
}

function soloVisibilitySet(
  composition: Composition,
  order: readonly string[],
): ReadonlySet<string> | null {
  const soloIds = order.filter((id) => composition.nodes[id]?.solo === true);
  if (soloIds.length === 0) return null;

  const included = new Set<string>();
  for (const soloId of soloIds) {
    let ancestor: string | null = soloId;
    while (ancestor !== null) {
      included.add(ancestor);
      ancestor = composition.nodes[ancestor]?.parent ?? null;
    }
    const pending = [...(composition.nodes[soloId]?.children ?? [])];
    while (pending.length > 0) {
      const descendantId = pending.pop();
      if (descendantId === undefined || included.has(descendantId)) continue;
      included.add(descendantId);
      pending.push(...(composition.nodes[descendantId]?.children ?? []));
    }
  }
  return included;
}

function tuple2(value: readonly [number, number]): Vec2 {
  return Object.freeze([value[0], value[1]]) as Vec2;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneValue(entry))) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])),
    ) as T;
  }
  return value;
}

export type { Anchor, SizeSpec };
