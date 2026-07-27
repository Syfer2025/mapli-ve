/**
 * Escalares e ângulos.
 *
 * Ângulos públicos estão em **graus**, para casar com o formato de projeto
 * (docs/03-DATA-MODEL.md). Conversão para radianos é sempre explícita — a
 * mistura silenciosa dos dois é uma das fontes de bug mais chatas em
 * geometria 2D.
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

export function toRadians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

export function toDegrees(radians: number): number {
  return radians * RAD_TO_DEG;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Inverso de lerp: onde `value` está entre a e b. Devolve 0 se a === b. */
export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, value));
}

export function remapClamped(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return lerp(outMin, outMax, clamp01(inverseLerp(inMin, inMax, value)));
}

/** Comparação com tolerância. Para geometria em pixels, 1e-6 é generoso. */
export function approximately(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Normaliza para [0, 360) — intervalo **semiaberto**, sempre.
 *
 * O `>= 360` no fim não é paranoia: para um negativo minúsculo, `x + 360`
 * arredonda para exatamente 360 em ponto flutuante. Devolver 360 de uma função
 * documentada como [0, 360) quebra qualquer código que faça bucketing ou
 * comparação de igualdade sobre o resultado.
 */
export function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  if (wrapped >= 0) return wrapped;
  const shifted = wrapped + 360;
  return shifted >= 360 ? 0 : shifted;
}

/**
 * Menor rotação de `from` para `to`, em (-180, 180].
 *
 * É o que impede um objeto a 350° indo para 10° de girar 340° no sentido
 * errado. Ver `rotationUnwrap` em docs/03-DATA-MODEL.md § 5 — quando a
 * animação *deve* dar a volta longa, o keyframe pede explicitamente.
 */
export function shortestAngleDelta(from: number, to: number): number {
  const delta = normalizeDegrees(to - from);
  return delta > 180 ? delta - 360 : delta;
}

/** Interpola ângulos pelo caminho curto. */
export function lerpAngle(from: number, to: number, t: number): number {
  return from + shortestAngleDelta(from, to) * t;
}

/**
 * Pesos gaussianos normalizados para média de janela — a base da suavização
 * **determinística** de câmera.
 *
 * DETERMINISM: suavização acumulativa (`pos += (alvo − pos) × k`) depende do
 * frame anterior e violaria a pureza de `evaluate()`. Em vez disso, o valor no
 * frame f é a média ponderada de uma janela fixa de frames em torno de f,
 * recalculada do zero. Custa mais CPU e mantém a avaliação pura.
 * Ver docs/adr/ADR-003-determinism.md.
 */
export function gaussianWeights(count: number, sigma?: number): Float64Array {
  if (count <= 1) return Float64Array.of(1);

  const s = sigma ?? count / 6;
  const center = (count - 1) / 2;
  const weights = new Float64Array(count);
  let sum = 0;

  for (let i = 0; i < count; i++) {
    const d = (i - center) / s;
    const w = Math.exp(-0.5 * d * d);
    weights[i] = w;
    sum += w;
  }

  for (let i = 0; i < count; i++) {
    weights[i] = (weights[i] as number) / sum;
  }

  return weights;
}

/**
 * Converte um fator de damping em [0, 1] no tamanho ímpar de janela.
 *
 * 0 → 1 frame (rígido, sem suavização). 1 → `maxWindow` frames (muito frouxo).
 * Janela ímpar mantém a simetria em torno do frame atual, sem deslocar a
 * animação no tempo.
 */
export function dampingToWindow(damping: number, maxWindow = 61): number {
  const clamped = clamp01(damping);
  const raw = 1 + Math.round(clamped * (maxWindow - 1));
  return raw % 2 === 0 ? raw + 1 : raw;
}

/** Média ponderada. `values` e `weights` precisam ter o mesmo tamanho. */
export function weightedAverage(
  values: readonly number[] | Float64Array,
  weights: Float64Array,
): number {
  let sum = 0;
  const n = Math.min(values.length, weights.length);
  for (let i = 0; i < n; i++) {
    sum += (values[i] as number) * (weights[i] as number);
  }
  return sum;
}
