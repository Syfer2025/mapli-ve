/**
 * Easing bezier **temporal** — controla *quando*, não *onde*.
 *
 * O eixo X é tempo normalizado [0,1] e o eixo Y é progresso do valor [0,1].
 * Os pontos extremos são fixos em (0,0) e (1,1); só os dois pontos de controle
 * variam. É exatamente o modelo de `cubic-bezier()` em CSS e das curvas de
 * velocidade do After Effects.
 *
 * Não confundir com bezier **espacial** (bezier.ts), que controla a forma da
 * trajetória no plano. Um avião pode fazer curva ampla (espacial) com
 * velocidade constante (temporal linear). Ver docs/03-DATA-MODEL.md § 5.
 */

import { clamp01 } from "./scalar.js";
import type { Vec2 } from "./vec.js";

const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_EPSILON = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 32;

/** Coeficientes da forma polinomial, pré-calculados por eixo. */
function coefficients(c1: number, c2: number): readonly [number, number, number] {
  const c = 3 * c1;
  const b = 3 * (c2 - c1) - c;
  const a = 1 - c - b;
  return [a, b, c];
}

function evalPoly(t: number, [a, b, c]: readonly [number, number, number]): number {
  return ((a * t + b) * t + c) * t;
}

function evalPolySlope(t: number, [a, b, c]: readonly [number, number, number]): number {
  return (3 * a * t + 2 * b) * t + c;
}

/**
 * Resolve `t` tal que `x(t) = x`.
 *
 * A curva é parametrizada por t, mas precisamos avaliá-la em função do tempo.
 * Newton-Raphson converge em poucas iterações onde a derivada é saudável;
 * onde ela é quase nula (ease extremo), cai para bisseção — que é lenta mas
 * não diverge. Usar só Newton produziria salto visível em curvas agressivas.
 */
export function solveBezierX(p1x: number, p2x: number, x: number): number {
  if (p1x === 1 / 3 && p2x === 2 / 3) return x; // linear: atalho exato

  const cx = coefficients(p1x, p2x);
  let t = x;

  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const slope = evalPolySlope(t, cx);
    if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;
    const error = evalPoly(t, cx) - x;
    if (Math.abs(error) < SUBDIVISION_EPSILON) return t;
    t -= error / slope;
  }

  let low = 0;
  let high = 1;
  t = x;

  for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i++) {
    const current = evalPoly(t, cx);
    if (Math.abs(current - x) < SUBDIVISION_EPSILON) return t;
    if (current < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }

  return t;
}

/**
 * Constrói a função de easing de dois pontos de controle.
 *
 * `p1` é o handle de saída do keyframe anterior; `p2`, o de entrada do
 * próximo. Devolve uma função pronta para uso no caminho quente — os
 * coeficientes são calculados uma vez, no fechamento.
 */
export function cubicBezierEase(p1: Vec2, p2: Vec2): (x: number) => number {
  const [p1x, p1y] = p1;
  const [p2x, p2y] = p2;

  if (p1x === p1y && p2x === p2y) return (x) => clamp01(x); // diagonal = linear

  const cy = coefficients(p1y, p2y);
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return evalPoly(solveBezierX(p1x, p2x, x), cy);
  };
}

/** Avalia sem construir closure. Use quando os handles mudam a cada chamada. */
export function evaluateBezierEase(p1: Vec2, p2: Vec2, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const t = solveBezierX(p1[0], p2[0], x);
  return evalPoly(t, coefficients(p1[1], p2[1]));
}

/**
 * Presets. Os dois últimos são específicos deste domínio, e pedem curvas
 * diferentes porque os vocabulários visuais são diferentes:
 *
 * `cinematic` — aceleração rápida e desaceleração longa, para movimento de
 * câmera. É o que faz um push-in parecer conduzido em vez de mecânico.
 *
 * `snap` — partida quase instantânea, para impacto de explosão e tremor.
 *
 * INVARIANT: as coordenadas x dos dois handles ficam em [0, 1]. É a condição
 * que garante x(t) monotônico e, portanto, uma função de easing válida — a
 * mesma restrição que o CSS impõe a `cubic-bezier()`. Handle em y pode
 * exceder [0,1] de propósito, para overshoot.
 */
export const EASE_PRESETS = {
  linear: { out: [1 / 3, 1 / 3] as Vec2, in: [2 / 3, 2 / 3] as Vec2 },
  ease: { out: [0.25, 0.1] as Vec2, in: [0.25, 1] as Vec2 },
  easeIn: { out: [0.42, 0] as Vec2, in: [1, 1] as Vec2 },
  easeOut: { out: [0, 0] as Vec2, in: [0.58, 1] as Vec2 },
  easeInOut: { out: [0.42, 0] as Vec2, in: [0.58, 1] as Vec2 },
  cinematic: { out: [0.16, 1] as Vec2, in: [0.3, 1] as Vec2 },
  snap: { out: [0.05, 0.9] as Vec2, in: [0.2, 1] as Vec2 },
} as const;

export type EasePresetName = keyof typeof EASE_PRESETS;
