/**
 * Bezier cúbica **espacial** — controla *onde*, não *quando*.
 *
 * É a forma da trajetória no plano (ou em lng/lat, para paths geográficos).
 * Independente do easing temporal de easing.ts.
 */

import { lerp } from "./scalar.js";
import { vec2, type Vec2 } from "./vec.js";

export interface CubicSegment {
  readonly p0: Vec2;
  readonly c0: Vec2;
  readonly c1: Vec2;
  readonly p1: Vec2;
}

/** Segmento reto entre dois pontos, com handles nos terços. */
export function lineSegment(from: Vec2, to: Vec2): CubicSegment {
  return {
    p0: from,
    c0: vec2.lerp(from, to, 1 / 3),
    c1: vec2.lerp(from, to, 2 / 3),
    p1: to,
  };
}

export function sampleCubic(s: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [
    w0 * s.p0[0] + w1 * s.c0[0] + w2 * s.c1[0] + w3 * s.p1[0],
    w0 * s.p0[1] + w1 * s.c0[1] + w2 * s.c1[1] + w3 * s.p1[1],
  ];
}

/**
 * Derivada em t — direção de movimento, não normalizada.
 *
 * Nos extremos, quando o handle coincide com o ponto de âncora, a derivada é
 * nula e a direção fica indefinida. Nesse caso caímos para a diferença entre
 * os pontos de controle seguintes: sem isso, auto-orientação faria o objeto
 * apontar para leste no primeiro frame do path.
 */
export function cubicTangent(s: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const d: Vec2 = [
    3 * u * u * (s.c0[0] - s.p0[0]) +
      6 * u * t * (s.c1[0] - s.c0[0]) +
      3 * t * t * (s.p1[0] - s.c1[0]),
    3 * u * u * (s.c0[1] - s.p0[1]) +
      6 * u * t * (s.c1[1] - s.c0[1]) +
      3 * t * t * (s.p1[1] - s.c1[1]),
  ];

  if (vec2.lengthSquared(d) > 1e-18) return d;

  // Degenerado: handle sobre a âncora.
  if (t < 0.5) {
    const fallback = vec2.sub(s.c1, s.p0);
    return vec2.lengthSquared(fallback) > 1e-18 ? fallback : vec2.sub(s.p1, s.p0);
  }
  const fallback = vec2.sub(s.p1, s.c0);
  return vec2.lengthSquared(fallback) > 1e-18 ? fallback : vec2.sub(s.p1, s.p0);
}

/** Comprimento aproximado por soma de cordas. Erro O(1/samples²). */
export function cubicLength(s: CubicSegment, samples = 64): number {
  let total = 0;
  let previous = s.p0;
  for (let i = 1; i <= samples; i++) {
    const current = sampleCubic(s, i / samples);
    total += vec2.distance(previous, current);
    previous = current;
  }
  return total;
}

/** Divide em t (De Casteljau). A soma das partes reproduz o original. */
export function splitCubic(s: CubicSegment, t: number): readonly [CubicSegment, CubicSegment] {
  const a = vec2.lerp(s.p0, s.c0, t);
  const b = vec2.lerp(s.c0, s.c1, t);
  const c = vec2.lerp(s.c1, s.p1, t);
  const d = vec2.lerp(a, b, t);
  const e = vec2.lerp(b, c, t);
  const mid = vec2.lerp(d, e, t);

  return [
    { p0: s.p0, c0: a, c1: d, p1: mid },
    { p0: mid, c0: e, c1: c, p1: s.p1 },
  ];
}

/** Caixa envolvente dos pontos de controle — conservadora, mas barata. */
export function cubicControlBounds(s: CubicSegment): {
  readonly min: Vec2;
  readonly max: Vec2;
} {
  const xs = [s.p0[0], s.c0[0], s.c1[0], s.p1[0]];
  const ys = [s.p0[1], s.c0[1], s.c1[1], s.p1[1]];
  return {
    min: [Math.min(...xs), Math.min(...ys)],
    max: [Math.max(...xs), Math.max(...ys)],
  };
}

/**
 * Converte uma polilinha em segmentos bezier com continuidade C1
 * (Catmull-Rom → bezier).
 *
 * É o que `"smooth": true` faz num path de Scene Script: o modelo escreve
 * `"through": ["varsovia", "kaunas", "riga"]` e sai uma curva suave, sem
 * precisar emitir handle nenhum.
 *
 * `tension` 0 = poligonal, 1 = suavidade padrão Catmull-Rom.
 */
export function catmullRomToBezier(
  points: readonly Vec2[],
  options?: { closed?: boolean; tension?: number },
): readonly CubicSegment[] {
  const closed = options?.closed ?? false;
  const tension = options?.tension ?? 1;

  if (points.length < 2) return [];
  if (points.length === 2 && !closed) {
    return [lineSegment(points[0] as Vec2, points[1] as Vec2)];
  }

  const n = points.length;
  const at = (i: number): Vec2 => {
    if (closed) return points[((i % n) + n) % n] as Vec2;
    return points[Math.max(0, Math.min(n - 1, i)) as number] as Vec2;
  };

  const segments: CubicSegment[] = [];
  const last = closed ? n : n - 1;
  const k = tension / 6;

  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    segments.push({
      p0: p1,
      c0: [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k],
      c1: [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k],
      p1: p2,
    });
  }

  return segments;
}

/**
 * Curva o segmento lateralmente — o arco de mapa de rota aérea.
 *
 * Uma linha reta entre duas cidades é visualmente pobre; um arco suave é a
 * convenção em infográfico geopolítico. `amount` é a flecha do arco como
 * fração da distância entre os pontos; o sinal escolhe o lado.
 */
export function arcSegment(from: Vec2, to: Vec2, amount: number): CubicSegment {
  if (amount === 0) return lineSegment(from, to);

  const delta = vec2.sub(to, from);
  const normal = vec2.scale(vec2.perpendicular(vec2.normalize(delta)), vec2.length(delta) * amount);

  return {
    p0: from,
    c0: vec2.add(vec2.lerp(from, to, 1 / 3), normal),
    c1: vec2.add(vec2.lerp(from, to, 2 / 3), normal),
    p1: to,
  };
}

export { lerp };
