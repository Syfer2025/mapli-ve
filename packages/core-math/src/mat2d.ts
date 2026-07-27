/**
 * Matriz afim 2D como tupla de 6 elementos, convenção do Canvas 2D e do DOM:
 *
 *     | a  c  e |
 *     | b  d  f |
 *     | 0  0  1 |
 *
 * A mesma ordem que `setTransform(a, b, c, d, e, f)` e que `matrix()` em CSS,
 * então passar uma matriz nossa para o canvas ou para o Pixi não exige
 * conversão nem transposição.
 */

import { toDegrees, toRadians } from "./scalar.js";
import type { Vec2 } from "./vec.js";

export type Mat2D = readonly [number, number, number, number, number, number];

export const MAT2D_IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

/**
 * Transformação decomposta. Ângulos em **graus**, `anchor` em pixels
 * (o chamador multiplica o anchorPoint normalizado pelo tamanho).
 */
export interface Transform2D {
  readonly position: Vec2;
  readonly rotation: number;
  readonly scale: Vec2;
  readonly skew: Vec2;
  readonly anchor: Vec2;
}

export const IDENTITY_TRANSFORM: Transform2D = {
  position: [0, 0],
  rotation: 0,
  scale: [1, 1],
  skew: [0, 0],
  anchor: [0, 0],
};

export const mat2d = {
  identity(): Mat2D {
    return MAT2D_IDENTITY;
  },

  /**
   * Compõe na ordem: translate(position) · rotate · skew · scale · translate(-anchor).
   *
   * INVARIANT: esta ordem é a mesma do After Effects e a documentada em
   * docs/03-DATA-MODEL.md § 3. Trocar rotate e scale de lugar produz
   * cisalhamento visível quando a escala é não uniforme — parece bug de
   * renderer e é bug de ordem de multiplicação.
   */
  compose(t: Transform2D): Mat2D {
    const rot = toRadians(t.rotation);
    const skewX = toRadians(t.skew[0]);
    const skewY = toRadians(t.skew[1]);

    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const tanX = Math.tan(skewX);
    const tanY = Math.tan(skewY);

    // rotate · skew
    const ra = cos + sin * tanY;
    const rb = sin - cos * tanY;
    const rc = cos * tanX - sin;
    const rd = sin * tanX + cos;

    // … · scale
    const a = ra * t.scale[0];
    const b = rb * t.scale[0];
    const c = rc * t.scale[1];
    const d = rd * t.scale[1];

    // … · translate(-anchor), depois translate(+position)
    const e = t.position[0] - (a * t.anchor[0] + c * t.anchor[1]);
    const f = t.position[1] - (b * t.anchor[0] + d * t.anchor[1]);

    return [a, b, c, d, e, f];
  },

  /** `m1 ∘ m2`: aplica m2 primeiro, depois m1. Ordem de matriz, não de leitura. */
  multiply(m1: Mat2D, m2: Mat2D): Mat2D {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1,
    ];
  },

  /** Devolve `null` quando a matriz é singular (escala zero em algum eixo). */
  invert(m: Mat2D): Mat2D | null {
    const [a, b, c, d, e, f] = m;
    const det = a * d - b * c;
    if (det === 0 || !Number.isFinite(det)) return null;

    const inv = 1 / det;
    return [d * inv, -b * inv, -c * inv, a * inv, (c * f - d * e) * inv, (b * e - a * f) * inv];
  },

  applyPoint(m: Mat2D, p: Vec2): Vec2 {
    return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  },

  /** Aplica só a parte linear — para direções e tangentes, que não transladam. */
  applyVector(m: Mat2D, v: Vec2): Vec2 {
    return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
  },

  translate(tx: number, ty: number): Mat2D {
    return [1, 0, 0, 1, tx, ty];
  },

  scaling(sx: number, sy: number): Mat2D {
    return [sx, 0, 0, sy, 0, 0];
  },

  /** Ângulo em **graus**. */
  rotation(degrees: number): Mat2D {
    const rad = toRadians(degrees);
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [c, s, -s, c, 0, 0];
  },

  /**
   * Decompõe em translação, rotação, escala e skew.
   *
   * A decomposição não é única quando há skew: assume-se rotação seguida de
   * skew em X, o que é a inversa exata de `compose` para skewY = 0. Com skewY
   * != 0 o resultado é equivalente visualmente, não idêntico nos campos.
   */
  decompose(m: Mat2D): Transform2D {
    const [a, b, c, d, e, f] = m;

    const scaleX = Math.hypot(a, b);
    const rotation = scaleX === 0 ? 0 : Math.atan2(b, a);

    // Remove a rotação para isolar escala em Y e skew em X.
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const shear = c * cos + d * sin;
    const scaleY = -c * sin + d * cos;

    return {
      position: [e, f],
      rotation: toDegrees(rotation),
      scale: [scaleX, scaleY],
      skew: [scaleY === 0 ? 0 : toDegrees(Math.atan2(shear, scaleY)), 0],
      anchor: [0, 0],
    };
  },

  /** Escala média — para converter tamanho em metros para pixels na tela. */
  averageScale(m: Mat2D): number {
    return (Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3])) / 2;
  },

  equals(m1: Mat2D, m2: Mat2D, epsilon = 1e-6): boolean {
    for (let i = 0; i < 6; i++) {
      if (Math.abs((m1[i] as number) - (m2[i] as number)) > epsilon) return false;
    }
    return true;
  },

  isIdentity(m: Mat2D, epsilon = 1e-6): boolean {
    return mat2d.equals(m, MAT2D_IDENTITY, epsilon);
  },
} as const;
