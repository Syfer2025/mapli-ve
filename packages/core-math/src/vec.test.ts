import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { rect, vec2, vec3, VEC2_ZERO, type Vec2 } from "./vec.js";
import { approximately, normalizeDegrees } from "./scalar.js";

/**
 * Coordenada realista: pixel de tela ou grau de lng/lat.
 *
 * Denormais (5e-324) são achatados para 0. Não é para esconder falha: em
 * magnitude denormal, `(max - min) + min` deixa de round-trip em ponto
 * flutuante, e nenhuma coordenada de pixel ou geográfica chega perto disso.
 * Testar ali mediria o IEEE 754, não o nosso código.
 */
const arbCoord = fc
  .double({ min: -1e3, max: 1e3, noNaN: true })
  .map((v) => (Math.abs(v) < 1e-9 ? 0 : v));

const arbVec2 = fc.tuple(arbCoord, arbCoord) as fc.Arbitrary<Vec2>;

const arbNonZeroVec2 = arbVec2.filter((v) => vec2.lengthSquared(v) > 1e-6);

describe("vec2 aritmética", () => {
  it("add e sub são inversas", () => {
    fc.assert(
      fc.property(arbVec2, arbVec2, (a, b) => vec2.equals(vec2.sub(vec2.add(a, b), b), a, 1e-9)),
    );
  });

  it("scale por 1 é identidade; por 0 é zero", () => {
    fc.assert(
      fc.property(arbVec2, (v) => {
        return vec2.equals(vec2.scale(v, 1), v) && vec2.equals(vec2.scale(v, 0), VEC2_ZERO);
      }),
    );
  });

  it("negate duas vezes volta ao original", () => {
    fc.assert(fc.property(arbVec2, (v) => vec2.equals(vec2.negate(vec2.negate(v)), v)));
  });

  it("dot é comutativo", () => {
    fc.assert(
      fc.property(arbVec2, arbVec2, (a, b) => approximately(vec2.dot(a, b), vec2.dot(b, a), 1e-9)),
    );
  });

  it("cross é antissimétrico", () => {
    fc.assert(
      fc.property(arbVec2, arbVec2, (a, b) =>
        approximately(vec2.cross(a, b), -vec2.cross(b, a), 1e-9),
      ),
    );
  });
});

describe("vec2 comprimento e distância", () => {
  it("length é a raiz de lengthSquared", () => {
    fc.assert(
      fc.property(arbVec2, (v) =>
        approximately(vec2.length(v), Math.sqrt(vec2.lengthSquared(v)), 1e-6),
      ),
    );
  });

  it("distance é simétrico", () => {
    fc.assert(
      fc.property(arbVec2, arbVec2, (a, b) =>
        approximately(vec2.distance(a, b), vec2.distance(b, a), 1e-9),
      ),
    );
  });

  it("distanceSquared concorda com distance", () => {
    fc.assert(
      fc.property(arbVec2, arbVec2, (a, b) =>
        approximately(vec2.distanceSquared(a, b), vec2.distance(a, b) ** 2, 1e-3),
      ),
    );
  });

  it("desigualdade triangular", () => {
    fc.assert(
      fc.property(arbVec2, arbVec2, (a, b) => {
        return vec2.length(vec2.add(a, b)) <= vec2.length(a) + vec2.length(b) + 1e-6;
      }),
    );
  });
});

describe("vec2.normalize", () => {
  it("resulta em comprimento 1", () => {
    fc.assert(
      fc.property(arbNonZeroVec2, (v) => approximately(vec2.length(vec2.normalize(v)), 1, 1e-9)),
    );
  });

  it("devolve zero para vetor nulo, não NaN", () => {
    // Um NaN aqui propagaria silenciosamente para a matriz e o objeto
    // desapareceria da tela sem erro.
    const n = vec2.normalize(VEC2_ZERO);
    expect(n).toEqual([0, 0]);
    expect(Number.isNaN(n[0])).toBe(false);
  });

  it("preserva a direção", () => {
    fc.assert(
      fc.property(arbNonZeroVec2, (v) => {
        const n = vec2.normalize(v);
        return vec2.cross(v, n) < 1e-6 && vec2.dot(v, n) > 0;
      }),
    );
  });
});

describe("vec2 rotação", () => {
  it("rotação preserva o comprimento", () => {
    fc.assert(
      fc.property(arbVec2, fc.double({ min: -720, max: 720, noNaN: true }), (v, deg) =>
        approximately(vec2.length(vec2.rotate(v, deg)), vec2.length(v), 1e-6),
      ),
    );
  });

  it("rotação de 360° é identidade", () => {
    fc.assert(fc.property(arbVec2, (v) => vec2.equals(vec2.rotate(v, 360), v, 1e-6)));
  });

  it("rotar por d e por -d volta ao original", () => {
    fc.assert(
      fc.property(arbVec2, fc.double({ min: -360, max: 360, noNaN: true }), (v, deg) =>
        vec2.equals(vec2.rotate(vec2.rotate(v, deg), -deg), v, 1e-6),
      ),
    );
  });

  it("rotateAround deixa o pivô parado", () => {
    fc.assert(
      fc.property(arbVec2, fc.double({ min: -360, max: 360, noNaN: true }), (pivot, deg) =>
        vec2.equals(vec2.rotateAround(pivot, pivot, deg), pivot, 1e-9),
      ),
    );
  });

  it("rotateAround com pivô na origem é igual a rotate", () => {
    fc.assert(
      fc.property(arbVec2, fc.double({ min: -360, max: 360, noNaN: true }), (v, deg) =>
        vec2.equals(vec2.rotateAround(v, VEC2_ZERO, deg), vec2.rotate(v, deg), 1e-9),
      ),
    );
  });

  it("perpendicular é ortogonal e mantém o comprimento", () => {
    fc.assert(
      fc.property(arbVec2, (v) => {
        const p = vec2.perpendicular(v);
        return (
          approximately(vec2.dot(v, p), 0, 1e-6) &&
          approximately(vec2.length(p), vec2.length(v), 1e-9)
        );
      }),
    );
  });
});

describe("vec2 ângulo e bearing", () => {
  it("angle: +X é 0°, +Y é 90°", () => {
    expect(vec2.angle([1, 0])).toBeCloseTo(0, 12);
    expect(vec2.angle([0, 1])).toBeCloseTo(90, 12);
    expect(vec2.angle([-1, 0])).toBeCloseTo(180, 12);
  });

  it("bearing: +Y (norte) é 0°, +X (leste) é 90°", () => {
    // Convenção cartográfica — é o que geo-bearing usa para orientar unidades.
    expect(vec2.bearing([0, 1])).toBeCloseTo(0, 12);
    expect(vec2.bearing([1, 0])).toBeCloseTo(90, 12);
    expect(vec2.bearing([0, -1])).toBeCloseTo(180, 12);
    expect(vec2.bearing([-1, 0])).toBeCloseTo(270, 12);
  });

  it("bearing fica sempre em [0, 360)", () => {
    fc.assert(
      fc.property(arbNonZeroVec2, (v) => {
        const b = vec2.bearing(v);
        return b >= 0 && b < 360;
      }),
    );
  });

  it("fromAngle e angle são inversas", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -179, max: 179, noNaN: true }).filter((d) => Math.abs(d) > 1e-9),
        (deg) => {
          const back = normalizeDegrees(vec2.angle(vec2.fromAngle(deg)));
          const expected = normalizeDegrees(deg);
          // Comparação circular: 0 e ~360 são o mesmo ângulo.
          const delta = Math.abs(back - expected);
          return Math.min(delta, 360 - delta) < 1e-6;
        },
      ),
    );
  });

  it("fromAngle respeita o comprimento pedido", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -360, max: 360, noNaN: true }),
        fc.double({ min: 0.001, max: 1e3, noNaN: true }),
        (deg, len) => approximately(vec2.length(vec2.fromAngle(deg, len)), len, 1e-6),
      ),
    );
  });
});

describe("vec2.lerp", () => {
  it("atinge os extremos", () => {
    fc.assert(
      fc.property(arbVec2, arbVec2, (a, b) => {
        return vec2.equals(vec2.lerp(a, b, 0), a) && vec2.equals(vec2.lerp(a, b, 1), b);
      }),
    );
  });

  it("o ponto médio equidista das pontas", () => {
    fc.assert(
      fc.property(arbVec2, arbVec2, (a, b) => {
        const mid = vec2.lerp(a, b, 0.5);
        return approximately(vec2.distance(a, mid), vec2.distance(mid, b), 1e-6);
      }),
    );
  });
});

describe("vec2 min/max", () => {
  it("min e max por componente", () => {
    expect(vec2.min([1, 5], [3, 2])).toEqual([1, 2]);
    expect(vec2.max([1, 5], [3, 2])).toEqual([3, 5]);
  });
});

describe("vec3", () => {
  it("add e sub são inversas", () => {
    expect(vec3.sub(vec3.add([1, 2, 3], [4, 5, 6]), [4, 5, 6])).toEqual([1, 2, 3]);
  });

  it("length usa três componentes", () => {
    expect(vec3.length([3, 4, 0])).toBeCloseTo(5, 12);
    expect(vec3.length([1, 2, 2])).toBeCloseTo(3, 12);
  });

  it("lerp e scale funcionam por componente", () => {
    expect(vec3.lerp([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
    expect(vec3.scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it("equals respeita epsilon", () => {
    expect(vec3.equals([1, 1, 1], [1, 1, 1 + 1e-9])).toBe(true);
    expect(vec3.equals([1, 1, 1], [1, 1, 2])).toBe(false);
  });
});

describe("rect", () => {
  it("fromPoints envolve todos os pontos", () => {
    const r = rect.fromPoints([
      [0, 0],
      [10, 5],
      [-3, 8],
    ]);
    expect(r).toEqual({ x: -3, y: 0, width: 13, height: 8 });
  });

  it("fromPoints de lista vazia é retângulo nulo", () => {
    expect(rect.fromPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("fromPoints contém todos os pontos de entrada", () => {
    fc.assert(
      fc.property(fc.array(arbVec2, { minLength: 1, maxLength: 30 }), (points) => {
        const r = rect.fromPoints(points);
        return points.every((p) => rect.contains(r, p));
      }),
    );
  });

  it("contains inclui a borda", () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    expect(rect.contains(r, [0, 0])).toBe(true);
    expect(rect.contains(r, [10, 10])).toBe(true);
    expect(rect.contains(r, [5, 5])).toBe(true);
    expect(rect.contains(r, [11, 5])).toBe(false);
    expect(rect.contains(r, [-1, 5])).toBe(false);
  });

  it("intersects é simétrico", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    const c = { x: 100, y: 100, width: 1, height: 1 };
    expect(rect.intersects(a, b)).toBe(rect.intersects(b, a));
    expect(rect.intersects(a, b)).toBe(true);
    expect(rect.intersects(a, c)).toBe(false);
  });

  it("expand cresce nos quatro lados", () => {
    expect(rect.expand({ x: 5, y: 5, width: 10, height: 10 }, 2)).toEqual({
      x: 3,
      y: 3,
      width: 14,
      height: 14,
    });
  });

  it("expand só amplia a intersecção — base do culling com margem", () => {
    const viewport = { x: 0, y: 0, width: 100, height: 100 };
    const justOutside = { x: 101, y: 50, width: 5, height: 5 };
    expect(rect.intersects(viewport, justOutside)).toBe(false);
    expect(rect.intersects(rect.expand(viewport, 10), justOutside)).toBe(true);
  });

  it("center é o meio", () => {
    expect(rect.center({ x: 0, y: 0, width: 10, height: 20 })).toEqual([5, 10]);
  });
});
