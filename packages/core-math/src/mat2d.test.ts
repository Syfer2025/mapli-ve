import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { IDENTITY_TRANSFORM, MAT2D_IDENTITY, mat2d, type Mat2D } from "./mat2d.js";
import { vec2, type Vec2 } from "./vec.js";
import { approximately } from "./scalar.js";

const arbPoint = fc.tuple(
  fc.double({ min: -1e3, max: 1e3, noNaN: true }),
  fc.double({ min: -1e3, max: 1e3, noNaN: true }),
) as fc.Arbitrary<Vec2>;

/** Matriz não singular: escalas longe de zero. */
const arbMatrix = fc
  .record({
    position: arbPoint,
    rotation: fc.double({ min: -360, max: 360, noNaN: true }),
    sx: fc.double({ min: 0.1, max: 10, noNaN: true }),
    sy: fc.double({ min: 0.1, max: 10, noNaN: true }),
  })
  .map(({ position, rotation, sx, sy }) =>
    mat2d.compose({ ...IDENTITY_TRANSFORM, position, rotation, scale: [sx, sy] }),
  );

describe("compose", () => {
  it("transform identidade produz matriz identidade", () => {
    expect(mat2d.compose(IDENTITY_TRANSFORM)).toEqual(MAT2D_IDENTITY);
  });

  it("translação move o ponto", () => {
    const m = mat2d.compose({ ...IDENTITY_TRANSFORM, position: [10, 20] });
    expect(mat2d.applyPoint(m, [0, 0])).toEqual([10, 20]);
    expect(mat2d.applyPoint(m, [1, 1])).toEqual([11, 21]);
  });

  it("escala multiplica a partir da origem", () => {
    const m = mat2d.compose({ ...IDENTITY_TRANSFORM, scale: [2, 3] });
    expect(mat2d.applyPoint(m, [1, 1])).toEqual([2, 3]);
  });

  it("rotação de 90° leva +X para +Y", () => {
    const m = mat2d.compose({ ...IDENTITY_TRANSFORM, rotation: 90 });
    const p = mat2d.applyPoint(m, [1, 0]);
    expect(p[0]).toBeCloseTo(0, 12);
    expect(p[1]).toBeCloseTo(1, 12);
  });

  it("anchor é o pivô de rotação e escala", () => {
    // Ponto no anchor não se move sob rotação.
    const m = mat2d.compose({
      ...IDENTITY_TRANSFORM,
      position: [50, 50],
      anchor: [10, 10],
      rotation: 45,
    });
    const p = mat2d.applyPoint(m, [10, 10]);
    expect(p[0]).toBeCloseTo(50, 10);
    expect(p[1]).toBeCloseTo(50, 10);
  });

  it("escala não uniforme com rotação não introduz cisalhamento inesperado", () => {
    // A ordem rotate · scale (não scale · rotate) é o que garante isso.
    // Um retângulo rotacionado 90° com escala [2,1] deve ter largura 1 e
    // altura 2 na tela — se a ordem estivesse trocada, sairia [2,1].
    const m = mat2d.compose({ ...IDENTITY_TRANSFORM, rotation: 90, scale: [2, 1] });
    const right = mat2d.applyVector(m, [1, 0]);
    const down = mat2d.applyVector(m, [0, 1]);
    expect(vec2.length(right)).toBeCloseTo(2, 10);
    expect(vec2.length(down)).toBeCloseTo(1, 10);
  });
});

describe("multiply", () => {
  it("identidade é neutra dos dois lados", () => {
    fc.assert(
      fc.property(arbMatrix, (m) => {
        return (
          mat2d.equals(mat2d.multiply(m, MAT2D_IDENTITY), m) &&
          mat2d.equals(mat2d.multiply(MAT2D_IDENTITY, m), m)
        );
      }),
    );
  });

  it("aplica m2 primeiro, depois m1", () => {
    const scale = mat2d.scaling(2, 2);
    const translate = mat2d.translate(10, 0);

    // translate ∘ scale: escala, então translada → (1,0) → (2,0) → (12,0)
    expect(mat2d.applyPoint(mat2d.multiply(translate, scale), [1, 0])).toEqual([12, 0]);
    // scale ∘ translate: translada, então escala → (1,0) → (11,0) → (22,0)
    expect(mat2d.applyPoint(mat2d.multiply(scale, translate), [1, 0])).toEqual([22, 0]);
  });

  it("é associativa", () => {
    fc.assert(
      fc.property(arbMatrix, arbMatrix, arbMatrix, (a, b, c) => {
        const left = mat2d.multiply(mat2d.multiply(a, b), c);
        const right = mat2d.multiply(a, mat2d.multiply(b, c));
        return mat2d.equals(left, right, 1e-6);
      }),
      { numRuns: 200 },
    );
  });

  it("compor matrizes equivale a aplicar em sequência", () => {
    fc.assert(
      fc.property(arbMatrix, arbMatrix, arbPoint, (a, b, p) => {
        const combined = mat2d.applyPoint(mat2d.multiply(a, b), p);
        const sequential = mat2d.applyPoint(a, mat2d.applyPoint(b, p));
        return vec2.equals(combined, sequential, 1e-6);
      }),
      { numRuns: 300 },
    );
  });
});

describe("invert", () => {
  it("matriz vezes sua inversa é a identidade", () => {
    fc.assert(
      fc.property(arbMatrix, (m) => {
        const inv = mat2d.invert(m);
        if (inv === null) return false;
        return mat2d.isIdentity(mat2d.multiply(m, inv), 1e-6);
      }),
      { numRuns: 300 },
    );
  });

  it("inversa desfaz a transformação de um ponto", () => {
    fc.assert(
      fc.property(arbMatrix, arbPoint, (m, p) => {
        const inv = mat2d.invert(m);
        if (inv === null) return false;
        const back = mat2d.applyPoint(inv, mat2d.applyPoint(m, p));
        return vec2.equals(back, p, 1e-4);
      }),
      { numRuns: 300 },
    );
  });

  it("devolve null em matriz singular, em vez de NaN", () => {
    expect(mat2d.invert([0, 0, 0, 0, 0, 0])).toBeNull();
    expect(mat2d.invert(mat2d.scaling(0, 1))).toBeNull();
    expect(mat2d.invert(mat2d.scaling(1, 0))).toBeNull();
  });
});

describe("applyVector", () => {
  it("ignora a translação — direções não transladam", () => {
    const m = mat2d.compose({ ...IDENTITY_TRANSFORM, position: [100, 200], rotation: 90 });
    const v = mat2d.applyVector(m, [1, 0]);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(1, 12);
  });
});

describe("decompose", () => {
  it("recupera posição, rotação e escala de uma composição sem skew", () => {
    fc.assert(
      fc.property(
        arbPoint,
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        (position, rotation, sx, sy) => {
          const m = mat2d.compose({
            ...IDENTITY_TRANSFORM,
            position,
            rotation,
            scale: [sx, sy],
          });
          const d = mat2d.decompose(m);
          return (
            vec2.equals(d.position, position, 1e-6) &&
            approximately(d.rotation, rotation, 1e-6) &&
            approximately(d.scale[0], sx, 1e-6) &&
            approximately(d.scale[1], sy, 1e-6)
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("recompor a decomposição reproduz a matriz", () => {
    fc.assert(
      fc.property(arbMatrix, (m) => {
        const recomposed = mat2d.compose(mat2d.decompose(m));
        return mat2d.equals(recomposed, m, 1e-5);
      }),
      { numRuns: 300 },
    );
  });
});

describe("averageScale", () => {
  it("é 1 para a identidade", () => {
    expect(mat2d.averageScale(MAT2D_IDENTITY)).toBe(1);
  });

  it("acompanha escala uniforme", () => {
    expect(mat2d.averageScale(mat2d.scaling(3, 3))).toBeCloseTo(3, 12);
  });

  it("é a média em escala não uniforme", () => {
    expect(mat2d.averageScale(mat2d.scaling(2, 4))).toBeCloseTo(3, 12);
  });

  it("é invariante à rotação", () => {
    const rotated = mat2d.multiply(mat2d.rotation(37), mat2d.scaling(2, 2));
    expect(mat2d.averageScale(rotated)).toBeCloseTo(2, 10);
  });
});

describe("compatibilidade de convenção", () => {
  it("a ordem é [a,b,c,d,e,f] do Canvas 2D", () => {
    // Passar direto para setTransform() precisa funcionar sem conversão.
    const m: Mat2D = mat2d.compose({
      ...IDENTITY_TRANSFORM,
      position: [5, 6],
      scale: [2, 3],
    });
    expect(m).toEqual([2, 0, 0, 3, 5, 6]);
  });
});
