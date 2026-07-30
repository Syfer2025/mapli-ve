import { EASE_PRESETS, evaluateBezierEase, lerp, lerpOklabHex } from "@theatrum/core-math";
import type { AnimatableProperty, EasingHandle, Keyframe } from "@theatrum/schema";
import {
  evaluateExpressionSource,
  type ExpressionDiagnostic,
  type ExpressionValue,
} from "./expression.js";
import { hasSpatialCurvature, interpolateSpatial, isVec2Value } from "./spatial.js";

export interface KeyframeSegment<T> {
  readonly left: Keyframe<T>;
  readonly right: Keyframe<T>;
  readonly progress: number;
}

/**
 * Localiza o segmento temporal que contém `frame`.
 *
 * Antes/depois da trilha não há segmento: o avaliador usa o primeiro/último
 * keyframe diretamente. A busca binária mantém a avaliação em O(log n).
 */
export function keyframeSegment<T>(
  property: AnimatableProperty<T>,
  frame: number,
): KeyframeSegment<T> | null {
  const keyframes = property.keyframes;
  if (keyframes.length < 2) return null;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (first === undefined || last === undefined || frame < first.frame || frame >= last.frame) {
    return null;
  }

  let low = 0;
  let high = keyframes.length - 2;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const left = keyframes[middle];
    const right = keyframes[middle + 1];
    if (left === undefined || right === undefined) return null;
    if (frame < left.frame) high = middle - 1;
    else if (frame >= right.frame) low = middle + 1;
    else {
      return {
        left,
        right,
        progress: (frame - left.frame) / (right.frame - left.frame),
      };
    }
  }
  return null;
}

export interface PropertyExpressionDiagnostic extends ExpressionDiagnostic {
  /** Caminho estável no documento, quando a avaliação veio de uma cena. */
  readonly propertyPath: string | null;
}

export interface EvaluatedPropertyResult<T> {
  readonly value: T;
  readonly diagnostics: readonly PropertyExpressionDiagnostic[];
}

const EMPTY_EXPRESSION_DIAGNOSTICS = Object.freeze([]) as readonly PropertyExpressionDiagnostic[];

/**
 * Avalia uma propriedade sem depender da ordem em que os frames são pedidos.
 *
 * A expressão, quando existe, recebe como `value` o resultado desta interpolação.
 * `expression: null` percorre exatamente o caminho histórico, sem parser.
 */
export function evaluateProperty<T>(property: AnimatableProperty<T>, frame: number): T {
  const baseValue = evaluateKeyframedProperty(property, frame);
  if (property.expression === null) return baseValue;
  return applyPropertyExpression(property.expression, baseValue, frame, null).value;
}

/**
 * Variante que também devolve diagnósticos estruturados. Uma expressão inválida
 * nunca torna o frame inválido: o valor base é devolvido junto do diagnóstico.
 */
export function evaluatePropertyResult<T>(
  property: AnimatableProperty<T>,
  frame: number,
  propertyPath: string | null = null,
): EvaluatedPropertyResult<T> {
  const baseValue = evaluateKeyframedProperty(property, frame);
  if (property.expression === null) {
    return Object.freeze({ value: baseValue, diagnostics: EMPTY_EXPRESSION_DIAGNOSTICS });
  }
  return applyPropertyExpression(property.expression, baseValue, frame, propertyPath);
}

function evaluateKeyframedProperty<T>(property: AnimatableProperty<T>, frame: number): T {
  const keyframes = property.keyframes;
  const first = keyframes[0];
  if (first === undefined) return evaluatedValue(property, property.value);
  if (frame <= first.frame) return evaluatedValue(first, first.value);

  const last = keyframes[keyframes.length - 1];
  if (last === undefined || frame >= last.frame) {
    return last === undefined
      ? evaluatedValue(property, property.value)
      : evaluatedValue(last, last.value);
  }

  const segment = keyframeSegment(property, frame);
  if (segment === null) return cloneValue(property.value);
  const progress = easedProgress(segment.left.out, segment.right.in, segment.progress);
  return interpolateKeyframes(segment.left, segment.right, progress);
}

function applyPropertyExpression<T>(
  source: string,
  baseValue: T,
  frame: number,
  propertyPath: string | null,
): EvaluatedPropertyResult<T> {
  if (!isExpressionValue(baseValue)) {
    return expressionFallback(
      baseValue,
      {
        code: "expression.type",
        message:
          "Expressões aceitam propriedades escalares ou vetores; o valor base tem outro formato.",
        start: 0,
        end: source.length,
      },
      propertyPath,
    );
  }

  const evaluated = evaluateExpressionSource(source, { frame, value: baseValue });
  if (!evaluated.ok) {
    return Object.freeze({
      value: baseValue,
      diagnostics: Object.freeze(
        evaluated.diagnostics.map((entry) => Object.freeze({ ...entry, propertyPath })),
      ),
    });
  }

  if (!hasCompatibleExpressionShape(baseValue, evaluated.value)) {
    return expressionFallback(
      baseValue,
      {
        code: "expression.type",
        message: "O resultado da expressão não tem o tipo e o formato da propriedade.",
        start: 0,
        end: source.length,
      },
      propertyPath,
    );
  }

  return Object.freeze({
    value: evaluated.value as T,
    diagnostics: EMPTY_EXPRESSION_DIAGNOSTICS,
  });
}

function expressionFallback<T>(
  value: T,
  issue: ExpressionDiagnostic,
  propertyPath: string | null,
): EvaluatedPropertyResult<T> {
  return Object.freeze({
    value,
    diagnostics: Object.freeze([Object.freeze({ ...issue, propertyPath })]),
  });
}

function isExpressionValue(value: unknown): value is ExpressionValue {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return typeof value !== "number" || Number.isFinite(value);
  }
  return Array.isArray(value) && value.every(isExpressionValue);
}

function hasCompatibleExpressionShape(
  baseValue: ExpressionValue,
  expressionValue: ExpressionValue,
): boolean {
  if (Array.isArray(baseValue)) {
    return (
      Array.isArray(expressionValue) &&
      baseValue.length === expressionValue.length &&
      baseValue.every((entry, index) => {
        const expressionEntry = expressionValue[index];
        return (
          expressionEntry !== undefined && hasCompatibleExpressionShape(entry, expressionEntry)
        );
      })
    );
  }
  return !Array.isArray(expressionValue) && typeof baseValue === typeof expressionValue;
}

/**
 * O DocumentStore congela profundamente o documento. Valores que vêm dele já
 * são imutáveis e podem ser compartilhados pelo frame avaliado sem alocação.
 * Entradas mutáveis de testes/chamadores continuam recebendo uma cópia.
 */
function evaluatedValue<T>(owner: object, value: T): T {
  return Object.isFrozen(owner) ? value : cloneValue(value);
}

/**
 * Interpolação entre dois keyframes. Só difere de `interpolateValue` quando o
 * trecho tem handles espaciais: aí o valor sai do caminho cúbico, não da reta.
 */
export function interpolateKeyframes<T>(
  left: Keyframe<T>,
  right: Keyframe<T>,
  progress: number,
): T {
  if (hasSpatialCurvature(left, right) && isVec2Value(left.value) && isVec2Value(right.value)) {
    return interpolateSpatial(
      left.value,
      right.value,
      left.spatial?.out,
      right.spatial?.in,
      progress,
    ) as T;
  }
  return interpolateValue(left.value, right.value, progress);
}

/**
 * Interpolação mínima comum da Fase 4: números e vetores numéricos.
 * Cores hex interpolam em OkLab (7B); as demais strings e valores discretos
 * permanecem no valor esquerdo até a fronteira.
 */
export function interpolateValue<T>(left: T, right: T, progress: number): T {
  if (typeof left === "number" && typeof right === "number") {
    return lerp(left, right, progress) as T;
  }
  if (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value) => typeof value === "number") &&
    right.every((value) => typeof value === "number")
  ) {
    return left.map((value, index) => lerp(value, right[index] as number, progress)) as T;
  }
  if (typeof left === "string" && typeof right === "string") {
    const color = lerpOklabHex(left, right, progress);
    if (color !== null) return color as T;
  }
  return cloneValue(progress >= 1 ? right : left);
}

/** Insere ou substitui pelo frame, preservando ordenação e imutabilidade. */
export function upsertKeyframe<T>(
  property: AnimatableProperty<T>,
  keyframe: Keyframe<T>,
): AnimatableProperty<T> {
  const keyframes = property.keyframes
    .filter((candidate) => candidate.id !== keyframe.id && candidate.frame !== keyframe.frame)
    .map(cloneKeyframe);
  keyframes.push(cloneKeyframe(keyframe));
  keyframes.sort(compareKeyframes);
  return { ...property, keyframes };
}

export function removeKeyframe<T>(
  property: AnimatableProperty<T>,
  keyframeId: string,
): AnimatableProperty<T> {
  return {
    ...property,
    keyframes: property.keyframes
      .filter((keyframe) => keyframe.id !== keyframeId)
      .map(cloneKeyframe),
  };
}

export function moveKeyframe<T>(
  property: AnimatableProperty<T>,
  keyframeId: string,
  frame: number,
): AnimatableProperty<T> {
  const target = property.keyframes.find((keyframe) => keyframe.id === keyframeId);
  if (target === undefined) return cloneProperty(property);
  return upsertKeyframe(property, { ...target, frame });
}

export function setKeyframeEasing<T>(
  property: AnimatableProperty<T>,
  keyframeId: string,
  easing: { readonly in?: EasingHandle; readonly out?: EasingHandle },
): AnimatableProperty<T> {
  return {
    ...property,
    keyframes: property.keyframes.map((keyframe) =>
      keyframe.id === keyframeId
        ? {
            ...cloneKeyframe(keyframe),
            ...(easing.in === undefined ? {} : { in: cloneHandle(easing.in) }),
            ...(easing.out === undefined ? {} : { out: cloneHandle(easing.out) }),
          }
        : cloneKeyframe(keyframe),
    ),
  };
}

export function applyEasingPreset<T>(
  property: AnimatableProperty<T>,
  keyframeId: string,
  preset: keyof typeof EASE_PRESETS,
): AnimatableProperty<T> {
  const handles = EASE_PRESETS[preset];
  return setKeyframeEasing(property, keyframeId, {
    out: { kind: "bezier", handle: [...handles.out] },
    in: { kind: "bezier", handle: [...handles.in] },
  });
}

function easedProgress(outgoing: EasingHandle, incoming: EasingHandle, progress: number): number {
  if (outgoing.kind === "hold" || incoming.kind === "hold") return 0;
  if (outgoing.kind === "linear" && incoming.kind === "linear") return progress;
  const outHandle = outgoing.kind === "bezier" ? outgoing.handle : ([1 / 3, 1 / 3] as const);
  const inHandle = incoming.kind === "bezier" ? incoming.handle : ([2 / 3, 2 / 3] as const);
  return evaluateBezierEase(outHandle, inHandle, progress);
}

function compareKeyframes<T>(left: Keyframe<T>, right: Keyframe<T>): number {
  if (left.frame !== right.frame) return left.frame - right.frame;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function cloneProperty<T>(property: AnimatableProperty<T>): AnimatableProperty<T> {
  return {
    ...property,
    value: cloneValue(property.value),
    keyframes: property.keyframes.map(cloneKeyframe),
  };
}

function cloneKeyframe<T>(keyframe: Keyframe<T>): Keyframe<T> {
  return {
    ...keyframe,
    value: cloneValue(keyframe.value),
    in: cloneHandle(keyframe.in),
    out: cloneHandle(keyframe.out),
    ...(keyframe.spatial === undefined
      ? {}
      : {
          spatial: {
            in: keyframe.spatial.in === null ? null : [...keyframe.spatial.in],
            out: keyframe.spatial.out === null ? null : [...keyframe.spatial.out],
          },
        }),
  };
}

function cloneHandle(handle: EasingHandle): EasingHandle {
  return handle.kind === "bezier" ? { ...handle, handle: [...handle.handle] } : { ...handle };
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    ) as T;
  }
  return value;
}
