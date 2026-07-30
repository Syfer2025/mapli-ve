import { clamp01, type Vec2 } from "@theatrum/core-math";
import { topologicalOrder, type EvaluatedNodeLike } from "@theatrum/scene-graph";
import type {
  Anchor,
  AnimatableProperty,
  BlendMode,
  Composition,
  EffectInstanceData,
  Node,
  ProjectDocument,
  SizeSpec,
  TrackMatte,
} from "@theatrum/schema";
import {
  evaluateProperty,
  evaluatePropertyResult,
  type PropertyExpressionDiagnostic,
} from "./property.js";

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
  /**
   * Falhas de expressão recuperáveis; o frame usa o valor base nesses casos.
   * `evaluate()` sempre preenche o campo; ele é opcional para cenas sintéticas
   * criadas por adapters e fixtures anteriores à Fase 11.
   */
  readonly diagnostics?: readonly PropertyExpressionDiagnostic[];
}

export interface EvaluatedValueResult<T> {
  readonly value: T;
  readonly diagnostics: readonly PropertyExpressionDiagnostic[];
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
  const diagnostics: PropertyExpressionDiagnostic[] = [];
  const drawOrder = expandComposition(document, composition, frame, evaluated, {
    prefix: "",
    parentId: null,
    stack: [composition.id],
    diagnostics,
  });

  return Object.freeze({
    compositionId: composition.id,
    frame,
    camera: evaluateCamera(composition, frame, diagnostics),
    nodes: evaluated,
    drawOrder: Object.freeze(drawOrder),
    diagnostics: Object.freeze(diagnostics),
  });
}

interface ExpansionContext {
  /** Prefixo de id para nós vindos de pré-composição aninhada. */
  readonly prefix: string;
  /** Nó que passa a ser pai da raiz aninhada. */
  readonly parentId: string | null;
  /** Composições no caminho, para barrar aninhamento cíclico. */
  readonly stack: readonly string[];
  /** Diagnósticos recuperáveis produzidos pelas propriedades desta avaliação. */
  readonly diagnostics: PropertyExpressionDiagnostic[];
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
    const propertyRoot = `compositions.${composition.id}.nodes.${source.id}`;
    const localFrame =
      source.timeRemap === null
        ? frame
        : evaluateTrackedProperty(
            source.timeRemap,
            frame,
            `${propertyRoot}.timeRemap`,
            context.diagnostics,
          );
    const localOpacity = clamp01(
      evaluateTrackedProperty(
        source.transform.opacity,
        localFrame,
        `${propertyRoot}.transform.opacity`,
        context.diagnostics,
      ),
    );
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
          position: tuple2(
            evaluateTrackedProperty(
              source.transform.position,
              localFrame,
              `${propertyRoot}.transform.position`,
              context.diagnostics,
            ),
          ),
          rotation: evaluateTrackedProperty(
            source.transform.rotation,
            localFrame,
            `${propertyRoot}.transform.rotation`,
            context.diagnostics,
          ),
          scale: tuple2(
            evaluateTrackedProperty(
              source.transform.scale,
              localFrame,
              `${propertyRoot}.transform.scale`,
              context.diagnostics,
            ),
          ),
          opacity: localOpacity,
          anchorPoint: tuple2(
            evaluateTrackedProperty(
              source.transform.anchorPoint,
              localFrame,
              `${propertyRoot}.transform.anchorPoint`,
              context.diagnostics,
            ),
          ),
          skew: tuple2(
            evaluateTrackedProperty(
              source.transform.skew,
              localFrame,
              `${propertyRoot}.transform.skew`,
              context.diagnostics,
            ),
          ),
          rotationReference: source.transform.rotationReference,
        }),
        props: evaluateValueTracked(
          source.props,
          localFrame,
          `${propertyRoot}.props`,
          context.diagnostics,
        ),
        effects: Object.freeze(
          source.effects.map((effect) =>
            evaluateEffect(
              effect,
              localFrame,
              `${propertyRoot}.effects.${effect.id}`,
              context.diagnostics,
            ),
          ),
        ),
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
          diagnostics: context.diagnostics,
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

function evaluateCamera(
  composition: Composition,
  frame: number,
  diagnostics: PropertyExpressionDiagnostic[],
): EvaluatedCamera {
  const propertyRoot = `compositions.${composition.id}.camera`;
  return Object.freeze({
    center: tuple2(
      evaluateTrackedProperty(
        composition.camera.center,
        frame,
        `${propertyRoot}.center`,
        diagnostics,
      ),
    ),
    zoom: evaluateTrackedProperty(
      composition.camera.zoom,
      frame,
      `${propertyRoot}.zoom`,
      diagnostics,
    ),
    bearing: evaluateTrackedProperty(
      composition.camera.bearing,
      frame,
      `${propertyRoot}.bearing`,
      diagnostics,
    ),
    pitch: evaluateTrackedProperty(
      composition.camera.pitch,
      frame,
      `${propertyRoot}.pitch`,
      diagnostics,
    ),
    roll: evaluateTrackedProperty(
      composition.camera.roll,
      frame,
      `${propertyRoot}.roll`,
      diagnostics,
    ),
    fov: evaluateTrackedProperty(composition.camera.fov, frame, `${propertyRoot}.fov`, diagnostics),
  });
}

function evaluateEffect(
  effect: EffectInstanceData,
  frame: number,
  propertyRoot: string,
  diagnostics: PropertyExpressionDiagnostic[],
): EvaluatedEffect {
  return Object.freeze({
    id: effect.id,
    type: effect.type,
    enabled: effect.enabled,
    params: evaluateValueTracked(effect.params, frame, `${propertyRoot}.params`, diagnostics),
  });
}

/**
 * Resolve wrappers animáveis em qualquer profundidade. Isso permite que tipos
 * adicionados ao registry tenham novas propriedades sem alterar o avaliador.
 */
export function evaluateValue<T>(value: T, frame: number): T {
  return evaluateValueTracked(value, frame, null, []);
}

/** Avalia wrappers recursivos e expõe as falhas recuperadas no percurso. */
export function evaluateValueResult<T>(
  value: T,
  frame: number,
  propertyPath: string | null = null,
): EvaluatedValueResult<T> {
  const diagnostics: PropertyExpressionDiagnostic[] = [];
  return Object.freeze({
    value: evaluateValueTracked(value, frame, propertyPath, diagnostics),
    diagnostics: Object.freeze(diagnostics),
  });
}

function evaluateValueTracked<T>(
  value: T,
  frame: number,
  propertyPath: string | null,
  diagnostics: PropertyExpressionDiagnostic[],
): T {
  if (isAnimatableProperty(value)) {
    const evaluated = evaluateTrackedProperty(value, frame, propertyPath, diagnostics);
    return evaluateValueTracked(evaluated, frame, propertyPath, diagnostics) as T;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry, index) =>
        evaluateValueTracked(
          entry,
          frame,
          childPropertyPath(propertyPath, `[${index}]`),
          diagnostics,
        ),
      ),
    ) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          evaluateValueTracked(entry, frame, childPropertyPath(propertyPath, key), diagnostics),
        ]),
      ),
    ) as T;
  }
  return value;
}

function evaluateTrackedProperty<T>(
  property: AnimatableProperty<T>,
  frame: number,
  propertyPath: string | null,
  diagnostics: PropertyExpressionDiagnostic[],
): T {
  // O caso comum preserva o caminho antigo sem alocar o envelope de diagnóstico.
  if (property.expression === null) return evaluateProperty(property, frame);
  const result = evaluatePropertyResult(property, frame, propertyPath);
  diagnostics.push(...result.diagnostics);
  return result.value;
}

function childPropertyPath(parent: string | null, child: string): string | null {
  if (parent === null) return null;
  return child.startsWith("[") ? `${parent}${child}` : `${parent}.${child}`;
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
  return (Object.isFrozen(value) ? value : Object.freeze(value)) as Vec2;
}

function cloneValue<T>(value: T): T {
  if (typeof value === "object" && value !== null && Object.isFrozen(value)) return value;
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
