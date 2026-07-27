/**
 * Vetores como tuplas readonly.
 *
 * Tupla em vez de classe: serializa direto para JSON (`[1, 2]`), é comparável
 * com `toEqual` em teste, e não carrega protótipo para dentro do documento.
 * O custo é alocação por operação — aceitável fora do caminho quente, e o
 * caminho quente (partículas) vive na GPU.
 */

import { lerp, toRadians, TAU } from "./scalar.js";

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export const VEC2_ZERO: Vec2 = [0, 0];
export const VEC2_ONE: Vec2 = [1, 1];

export const vec2 = {
  of(x: number, y: number): Vec2 {
    return [x, y];
  },

  add(a: Vec2, b: Vec2): Vec2 {
    return [a[0] + b[0], a[1] + b[1]];
  },

  sub(a: Vec2, b: Vec2): Vec2 {
    return [a[0] - b[0], a[1] - b[1]];
  },

  mul(a: Vec2, b: Vec2): Vec2 {
    return [a[0] * b[0], a[1] * b[1]];
  },

  scale(v: Vec2, s: number): Vec2 {
    return [v[0] * s, v[1] * s];
  },

  negate(v: Vec2): Vec2 {
    return [-v[0], -v[1]];
  },

  dot(a: Vec2, b: Vec2): number {
    return a[0] * b[0] + a[1] * b[1];
  },

  /** Produto vetorial 2D (escalar). Sinal indica o lado da curva. */
  cross(a: Vec2, b: Vec2): number {
    return a[0] * b[1] - a[1] * b[0];
  },

  length(v: Vec2): number {
    return Math.hypot(v[0], v[1]);
  },

  lengthSquared(v: Vec2): number {
    return v[0] * v[0] + v[1] * v[1];
  },

  distance(a: Vec2, b: Vec2): number {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  },

  distanceSquared(a: Vec2, b: Vec2): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return dx * dx + dy * dy;
  },

  /** Devolve [0, 0] para vetor nulo, em vez de NaN. */
  normalize(v: Vec2): Vec2 {
    const len = Math.hypot(v[0], v[1]);
    return len === 0 ? VEC2_ZERO : [v[0] / len, v[1] / len];
  },

  lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  },

  /** Rotação em torno da origem. Ângulo em **graus**. */
  rotate(v: Vec2, degrees: number): Vec2 {
    const rad = toRadians(degrees);
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
  },

  /** Rotação em torno de um pivô. Ângulo em **graus**. */
  rotateAround(v: Vec2, pivot: Vec2, degrees: number): Vec2 {
    const rad = toRadians(degrees);
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const dx = v[0] - pivot[0];
    const dy = v[1] - pivot[1];
    return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
  },

  /** Perpendicular no sentido anti-horário. */
  perpendicular(v: Vec2): Vec2 {
    return [-v[1], v[0]];
  },

  /**
   * Ângulo do vetor em **graus**, 0 = eixo +X, crescendo no sentido do +Y.
   * Para converter tangente de path em rotação de tela.
   */
  angle(v: Vec2): number {
    return (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  },

  /**
   * Bearing em **graus**, 0 = norte (+Y), crescendo no sentido horário.
   * Convenção cartográfica — é o que `rotationReference: "geo-bearing"` usa.
   */
  bearing(v: Vec2): number {
    const deg = (Math.atan2(v[0], v[1]) * 180) / Math.PI;
    if (deg >= 0) return deg;
    // Mesmo cuidado de normalizeDegrees: para deg negativo minúsculo,
    // deg + 360 arredonda para exatamente 360 e sai da faixa [0, 360).
    const shifted = deg + 360;
    return shifted >= 360 ? 0 : shifted;
  },

  fromAngle(degrees: number, length = 1): Vec2 {
    const rad = toRadians(degrees);
    return [Math.cos(rad) * length, Math.sin(rad) * length];
  },

  fromRadians(radians: number, length = 1): Vec2 {
    return [Math.cos(radians) * length, Math.sin(radians) * length];
  },

  equals(a: Vec2, b: Vec2, epsilon = 1e-6): boolean {
    return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
  },

  min(a: Vec2, b: Vec2): Vec2 {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
  },

  max(a: Vec2, b: Vec2): Vec2 {
    return [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  },
} as const;

export const vec3 = {
  of(x: number, y: number, z: number): Vec3 {
    return [x, y, z];
  },

  add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },

  sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },

  scale(v: Vec3, s: number): Vec3 {
    return [v[0] * s, v[1] * s, v[2] * s];
  },

  length(v: Vec3): number {
    return Math.hypot(v[0], v[1], v[2]);
  },

  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  },

  equals(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
    return (
      Math.abs(a[0] - b[0]) <= epsilon &&
      Math.abs(a[1] - b[1]) <= epsilon &&
      Math.abs(a[2] - b[2]) <= epsilon
    );
  },
} as const;

/** Retângulo eixo-alinhado. Usado para culling e hit-testing. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Extensão que garante `min + span >= max` apesar do arredondamento.
 *
 * `Rect` guarda origem e tamanho (convenção do DOM e do Canvas), então
 * `contains` recalcula a borda como `x + width`. Com coordenadas de sinais
 * opostos, `(max - min) + min` pode cair abaixo de `max` por 1 ULP — e uma
 * bounds que não contém os próprios pontos faz o culling descartar objeto
 * visível e o hit-test perder o clique na borda. Alargar por alguns ULP erra
 * na direção segura para os dois usos.
 */
function inclusiveSpan(min: number, max: number): number {
  let span = max - min;
  for (let i = 0; i < 4 && min + span < max; i++) {
    span += Math.max(Math.abs(span), Number.MIN_VALUE) * Number.EPSILON;
  }
  return span;
}

export const rect = {
  /** A bounds resultante contém todos os pontos de entrada, inclusive na borda. */
  fromPoints(points: readonly Vec2[]): Rect {
    if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    return {
      x: minX,
      y: minY,
      width: inclusiveSpan(minX, maxX),
      height: inclusiveSpan(minY, maxY),
    };
  },

  contains(r: Rect, p: Vec2): boolean {
    return p[0] >= r.x && p[0] <= r.x + r.width && p[1] >= r.y && p[1] <= r.y + r.height;
  },

  intersects(a: Rect, b: Rect): boolean {
    return (
      a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
    );
  },

  expand(r: Rect, margin: number): Rect {
    return {
      x: r.x - margin,
      y: r.y - margin,
      width: r.width + margin * 2,
      height: r.height + margin * 2,
    };
  },

  center(r: Rect): Vec2 {
    return [r.x + r.width / 2, r.y + r.height / 2];
  },
} as const;

export { TAU };
