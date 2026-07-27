/**
 * Modelo do editor de curvas.
 *
 * Duas curvas por propriedade, e elas respondem perguntas diferentes:
 *
 * - **valor** mostra onde a propriedade está em cada frame;
 * - **velocidade** mostra o tranco. Uma curva de valor pode parecer suave e
 *   ainda ter degrau na derivada — é exatamente o que o critério 2 da Fase 5
 *   cobra ("parte e freia suavemente, sem tranco nas curvas").
 *
 * Tudo aqui é puro: recebe propriedade e viewport, devolve pontos em espaço de
 * tela. O canvas só desenha o que este módulo calcula, e por isso dá para testar
 * a matemática sem DOM.
 */

import { sampleSpeedCurve, evaluateProperty } from "@theatrum/animation";
import type { AnimatableProperty, EasingHandle, Keyframe } from "@theatrum/schema";

export interface GraphViewport {
  readonly width: number;
  readonly height: number;
  readonly startFrame: number;
  readonly endFrame: number;
  /** Margem vertical em pixels, para a curva não encostar na borda. */
  readonly padding: number;
}

export interface GraphRange {
  readonly min: number;
  readonly max: number;
}

export interface GraphPoint {
  readonly frame: number;
  readonly value: number;
  readonly x: number;
  readonly y: number;
}

export interface GraphHandle {
  readonly keyframeId: string;
  readonly side: "in" | "out";
  readonly x: number;
  readonly y: number;
  /** Coordenadas normalizadas do handle bezier, como estão no documento. */
  readonly handle: readonly [number, number];
}

export interface GraphCurve {
  readonly kind: "value" | "speed";
  readonly points: readonly GraphPoint[];
  readonly range: GraphRange;
}

export interface GraphKeyframePoint {
  readonly id: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly easing: EasingHandle["kind"];
}

export interface GraphModel {
  readonly value: GraphCurve;
  readonly speed: GraphCurve;
  readonly keyframes: readonly GraphKeyframePoint[];
  readonly handles: readonly GraphHandle[];
}

/** Distância em pixels para o clique pegar um handle. */
export const HANDLE_HIT_RADIUS = 7;

export function buildGraphModel(
  property: AnimatableProperty<unknown>,
  viewport: GraphViewport,
  fps: number,
): GraphModel {
  const frames = frameRange(viewport);
  const valueSamples = frames.map((frame) => ({
    frame,
    value: numericValue(evaluateProperty(property, frame)),
  }));
  const speedSamples = sampleSpeedCurve(property, viewport.startFrame, viewport.endFrame, fps);

  const valueRange = paddedRange(valueSamples.map((sample) => sample.value));
  const speedRange = paddedRange(speedSamples.map((sample) => sample.speed));

  const value: GraphCurve = Object.freeze({
    kind: "value",
    range: valueRange,
    points: Object.freeze(
      valueSamples.map((sample) =>
        Object.freeze({
          ...sample,
          x: frameToX(sample.frame, viewport),
          y: valueToY(sample.value, valueRange, viewport),
        }),
      ),
    ),
  });

  const speed: GraphCurve = Object.freeze({
    kind: "speed",
    range: speedRange,
    points: Object.freeze(
      speedSamples.map((sample) =>
        Object.freeze({
          frame: sample.frame,
          value: sample.speed,
          x: frameToX(sample.frame, viewport),
          y: valueToY(sample.speed, speedRange, viewport),
        }),
      ),
    ),
  });

  const keyframes: GraphKeyframePoint[] = [];
  const handles: GraphHandle[] = [];
  for (const keyframe of property.keyframes) {
    const numeric = numericValue(keyframe.value);
    const point = Object.freeze({
      id: keyframe.id,
      frame: keyframe.frame,
      x: frameToX(keyframe.frame, viewport),
      y: valueToY(numeric, valueRange, viewport),
      easing: keyframe.out.kind,
    });
    keyframes.push(point);
    handles.push(...keyframeHandles(property, keyframe, viewport, valueRange));
  }

  return Object.freeze({
    value,
    speed,
    keyframes: Object.freeze(keyframes),
    handles: Object.freeze(handles),
  });
}

/**
 * Handles bezier em espaço de tela. O handle é normalizado em [0,1] no tempo e
 * no valor **do segmento** — por isso precisa do keyframe vizinho para virar
 * pixel. Sem vizinho não há segmento, e o handle não é desenhado.
 */
function keyframeHandles(
  property: AnimatableProperty<unknown>,
  keyframe: Keyframe<unknown>,
  viewport: GraphViewport,
  range: GraphRange,
): readonly GraphHandle[] {
  const index = property.keyframes.findIndex((candidate) => candidate.id === keyframe.id);
  const previous = index > 0 ? property.keyframes[index - 1] : undefined;
  const next = property.keyframes[index + 1];
  const result: GraphHandle[] = [];

  if (next !== undefined && keyframe.out.kind === "bezier") {
    result.push(
      handlePoint(keyframe, next, keyframe.out.handle, "out", keyframe.id, viewport, range),
    );
  }
  if (previous !== undefined && keyframe.in.kind === "bezier") {
    // O handle de entrada é medido do keyframe anterior para este, então o
    // ponto sai da mesma parametrização do segmento à esquerda.
    result.push(
      handlePoint(previous, keyframe, keyframe.in.handle, "in", keyframe.id, viewport, range),
    );
  }
  return result;
}

function handlePoint(
  left: Keyframe<unknown>,
  right: Keyframe<unknown>,
  handle: readonly [number, number],
  side: "in" | "out",
  keyframeId: string,
  viewport: GraphViewport,
  range: GraphRange,
): GraphHandle {
  const leftValue = numericValue(left.value);
  const rightValue = numericValue(right.value);
  const frame = left.frame + (right.frame - left.frame) * handle[0];
  const value = leftValue + (rightValue - leftValue) * handle[1];
  return Object.freeze({
    keyframeId,
    side,
    x: frameToX(frame, viewport),
    y: valueToY(value, range, viewport),
    handle: [handle[0], handle[1]] as readonly [number, number],
  });
}

/**
 * Converte um ponto de tela de volta para as coordenadas normalizadas do
 * handle. `x` fica preso a [0,1] porque handle fora dessa faixa quebra a
 * monotonicidade do easing; `y` é livre, que é o que permite overshoot.
 */
export function handleFromScreen(
  point: { readonly x: number; readonly y: number },
  left: Keyframe<unknown>,
  right: Keyframe<unknown>,
  viewport: GraphViewport,
  range: GraphRange,
): readonly [number, number] {
  const frame = xToFrame(point.x, viewport);
  const span = right.frame - left.frame;
  const normalizedX = span === 0 ? 0 : (frame - left.frame) / span;
  const leftValue = numericValue(left.value);
  const rightValue = numericValue(right.value);
  const valueSpan = rightValue - leftValue;
  const value = yToValue(point.y, range, viewport);
  const normalizedY = valueSpan === 0 ? 0 : (value - leftValue) / valueSpan;
  return [Math.max(0, Math.min(1, normalizedX)), normalizedY];
}

export function findHandleAt(
  model: GraphModel,
  x: number,
  y: number,
  radius = HANDLE_HIT_RADIUS,
): GraphHandle | null {
  let best: GraphHandle | null = null;
  let bestDistance = radius;
  for (const handle of model.handles) {
    const distance = Math.hypot(handle.x - x, handle.y - y);
    if (distance <= bestDistance) {
      best = handle;
      bestDistance = distance;
    }
  }
  return best;
}

export function frameToX(frame: number, viewport: GraphViewport): number {
  const span = viewport.endFrame - viewport.startFrame;
  if (span <= 0) return 0;
  return ((frame - viewport.startFrame) / span) * viewport.width;
}

export function xToFrame(x: number, viewport: GraphViewport): number {
  const span = viewport.endFrame - viewport.startFrame;
  if (viewport.width <= 0) return viewport.startFrame;
  return viewport.startFrame + (x / viewport.width) * span;
}

export function valueToY(value: number, range: GraphRange, viewport: GraphViewport): number {
  const span = range.max - range.min;
  const usable = Math.max(1, viewport.height - viewport.padding * 2);
  if (span <= 0) return viewport.height / 2;
  // y cresce para baixo no canvas: valor maior fica mais alto na tela.
  return viewport.padding + (1 - (value - range.min) / span) * usable;
}

export function yToValue(y: number, range: GraphRange, viewport: GraphViewport): number {
  const span = range.max - range.min;
  const usable = Math.max(1, viewport.height - viewport.padding * 2);
  if (span <= 0) return range.min;
  return range.min + (1 - (y - viewport.padding) / usable) * span;
}

function frameRange(viewport: GraphViewport): readonly number[] {
  const frames: number[] = [];
  const span = Math.max(1, Math.round(viewport.endFrame - viewport.startFrame));
  // Uma amostra por pixel no máximo: mais que isso não muda o desenho.
  const step = Math.max(1, Math.ceil(span / Math.max(1, viewport.width)));
  for (let frame = viewport.startFrame; frame <= viewport.endFrame; frame += step) {
    frames.push(frame);
  }
  if (frames.at(-1) !== viewport.endFrame) frames.push(viewport.endFrame);
  return frames;
}

/** Faixa com 10% de folga; faixa degenerada vira uma unidade em torno do valor. */
function paddedRange(values: readonly number[]): GraphRange {
  if (values.length === 0) return Object.freeze({ min: 0, max: 1 });
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return Object.freeze({ min: 0, max: 1 });
  if (max - min < 1e-9) {
    min -= 0.5;
    max += 0.5;
  } else {
    const margin = (max - min) * 0.1;
    min -= margin;
    max += margin;
  }
  return Object.freeze({ min, max });
}

/** Vetores entram na curva pela magnitude — é o que dá sentido a uma linha só. */
function numericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return Math.hypot(value[0], value[1]);
  }
  return 0;
}
