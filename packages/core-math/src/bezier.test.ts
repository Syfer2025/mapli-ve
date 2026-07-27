import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  arcSegment,
  catmullRomToBezier,
  cubicControlBounds,
  cubicLength,
  cubicTangent,
  lineSegment,
  sampleCubic,
  splitCubic,
  type CubicSegment,
} from "./bezier.js";
import { vec2, type Vec2 } from "./vec.js";
import { approximately } from "./scalar.js";

const arbVec2 = fc.tuple(
  fc.double({ min: -500, max: 500, noNaN: true }),
  fc.double({ min: -500, max: 500, noNaN: true }),
) as fc.Arbitrary<Vec2>;

const arbSegment: fc.Arbitrary<CubicSegment> = fc.record({
  p0: arbVec2,
  c0: arbVec2,
  c1: arbVec2,
  p1: arbVec2,
});

describe("lineSegment", () => {
  it("interpola linearmente entre os pontos", () => {
    const s = lineSegment([0, 0], [30, 0]);
    expect(sampleCubic(s, 0.5)[0]).toBeCloseTo(15, 9);
  });

  it("handles nos terços dão velocidade uniforme numa reta", () => {
    const s = lineSegment([0, 0], [100, 0]);
    for (const t of [0.25, 0.5, 0.75]) {
      expect(sampleCubic(s, t)[0]).toBeCloseTo(t * 100, 6);
    }
  });
});

describe("sampleCubic", () => {
  it("t=0 é p0 e t=1 é p1, exatamente", () => {
    fc.assert(
      fc.property(arbSegment, (s) => {
        return (
          vec2.equals(sampleCubic(s, 0), s.p0, 1e-9) && vec2.equals(sampleCubic(s, 1), s.p1, 1e-9)
        );
      }),
    );
  });

  it("fica dentro da caixa dos pontos de controle (propriedade do casco convexo)", () => {
    fc.assert(
      fc.property(arbSegment, fc.double({ min: 0, max: 1, noNaN: true }), (s, t) => {
        const p = sampleCubic(s, t);
        const { min, max } = cubicControlBounds(s);
        return (
          p[0] >= min[0] - 1e-6 &&
          p[0] <= max[0] + 1e-6 &&
          p[1] >= min[1] - 1e-6 &&
          p[1] <= max[1] + 1e-6
        );
      }),
    );
  });

  it("é determinístico", () => {
    fc.assert(
      fc.property(arbSegment, fc.double({ min: 0, max: 1, noNaN: true }), (s, t) => {
        return vec2.equals(sampleCubic(s, t), sampleCubic(s, t), 0);
      }),
    );
  });
});

describe("cubicTangent", () => {
  it("aponta na direção do movimento", () => {
    const s = lineSegment([0, 0], [10, 0]);
    const tangent = cubicTangent(s, 0.5);
    expect(vec2.normalize(tangent)[0]).toBeCloseTo(1, 9);
    expect(vec2.normalize(tangent)[1]).toBeCloseTo(0, 9);
  });

  it("nunca é nulo, mesmo com handle sobre a âncora", () => {
    // Sem o fallback, auto-orientação apontaria para leste no primeiro frame
    // do path — bug visível como unidade "virando" ao começar a andar.
    const degenerate: CubicSegment = { p0: [0, 0], c0: [0, 0], c1: [10, 10], p1: [20, 20] };
    expect(vec2.lengthSquared(cubicTangent(degenerate, 0))).toBeGreaterThan(0);

    const bothEnds: CubicSegment = { p0: [0, 0], c0: [0, 0], c1: [20, 20], p1: [20, 20] };
    expect(vec2.lengthSquared(cubicTangent(bothEnds, 0))).toBeGreaterThan(0);
    expect(vec2.lengthSquared(cubicTangent(bothEnds, 1))).toBeGreaterThan(0);

    const allSame: CubicSegment = { p0: [5, 5], c0: [5, 5], c1: [5, 5], p1: [5, 5] };
    expect(Number.isFinite(cubicTangent(allSame, 0.5)[0])).toBe(true);
  });

  it("é finito em qualquer t", () => {
    fc.assert(
      fc.property(arbSegment, fc.double({ min: 0, max: 1, noNaN: true }), (s, t) => {
        const d = cubicTangent(s, t);
        return Number.isFinite(d[0]) && Number.isFinite(d[1]);
      }),
    );
  });

  it("aproxima a derivada numérica", () => {
    const s: CubicSegment = { p0: [0, 0], c0: [30, 80], c1: [70, -20], p1: [100, 50] };
    const h = 1e-5;
    for (const t of [0.2, 0.5, 0.8]) {
      const analytic = cubicTangent(s, t);
      const a = sampleCubic(s, t - h);
      const b = sampleCubic(s, t + h);
      const numeric = vec2.scale(vec2.sub(b, a), 1 / (2 * h));
      expect(analytic[0]).toBeCloseTo(numeric[0], 3);
      expect(analytic[1]).toBeCloseTo(numeric[1], 3);
    }
  });
});

describe("cubicLength", () => {
  it("segmento reto tem o comprimento da reta", () => {
    expect(cubicLength(lineSegment([0, 0], [100, 0]))).toBeCloseTo(100, 6);
    expect(cubicLength(lineSegment([0, 0], [30, 40]))).toBeCloseTo(50, 6);
  });

  it("é zero para segmento degenerado", () => {
    expect(cubicLength({ p0: [5, 5], c0: [5, 5], c1: [5, 5], p1: [5, 5] })).toBe(0);
  });

  it("é ao menos a distância em linha reta entre as pontas", () => {
    fc.assert(fc.property(arbSegment, (s) => cubicLength(s) >= vec2.distance(s.p0, s.p1) - 1e-6));
  });

  it("converge ao aumentar a amostragem", () => {
    const s: CubicSegment = { p0: [0, 0], c0: [0, 100], c1: [100, 100], p1: [100, 0] };
    const coarse = cubicLength(s, 16);
    const fine = cubicLength(s, 512);
    expect(fine).toBeGreaterThanOrEqual(coarse - 1e-9);
    expect(Math.abs(fine - coarse) / fine).toBeLessThan(0.01);
  });
});

describe("splitCubic", () => {
  it("as duas metades emendam no ponto de corte", () => {
    fc.assert(
      fc.property(arbSegment, fc.double({ min: 0.01, max: 0.99, noNaN: true }), (s, t) => {
        const [left, right] = splitCubic(s, t);
        return (
          vec2.equals(left.p1, right.p0, 1e-9) &&
          vec2.equals(left.p0, s.p0, 1e-9) &&
          vec2.equals(right.p1, s.p1, 1e-9)
        );
      }),
    );
  });

  it("o ponto de corte é o ponto da curva original", () => {
    fc.assert(
      fc.property(arbSegment, fc.double({ min: 0.01, max: 0.99, noNaN: true }), (s, t) => {
        const [left] = splitCubic(s, t);
        return vec2.equals(left.p1, sampleCubic(s, t), 1e-6);
      }),
    );
  });

  it("a soma dos comprimentos preserva o comprimento total", () => {
    fc.assert(
      fc.property(arbSegment, fc.double({ min: 0.1, max: 0.9, noNaN: true }), (s, t) => {
        const [left, right] = splitCubic(s, t);
        const total = cubicLength(s, 512);
        const parts = cubicLength(left, 256) + cubicLength(right, 256);
        return total === 0 || Math.abs(parts - total) / total < 0.01;
      }),
      { numRuns: 100 },
    );
  });

  it("as metades reproduzem a curva original ao serem reamostradas", () => {
    const s: CubicSegment = { p0: [0, 0], c0: [20, 90], c1: [80, -30], p1: [100, 40] };
    const [left, right] = splitCubic(s, 0.4);
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      expect(vec2.equals(sampleCubic(left, u), sampleCubic(s, u * 0.4), 1e-6)).toBe(true);
      expect(vec2.equals(sampleCubic(right, u), sampleCubic(s, 0.4 + u * 0.6), 1e-6)).toBe(true);
    }
  });
});

describe("catmullRomToBezier", () => {
  it("menos de dois pontos não produz segmento", () => {
    expect(catmullRomToBezier([])).toEqual([]);
    expect(catmullRomToBezier([[0, 0]])).toEqual([]);
  });

  it("dois pontos abertos dão um segmento reto", () => {
    const segs = catmullRomToBezier([
      [0, 0],
      [10, 0],
    ]);
    expect(segs).toHaveLength(1);
    expect(sampleCubic(segs[0] as CubicSegment, 0.5)[0]).toBeCloseTo(5, 6);
  });

  it("n pontos abertos dão n-1 segmentos", () => {
    fc.assert(
      fc.property(fc.array(arbVec2, { minLength: 3, maxLength: 12 }), (points) => {
        return catmullRomToBezier(points).length === points.length - 1;
      }),
    );
  });

  it("n pontos fechados dão n segmentos", () => {
    fc.assert(
      fc.property(fc.array(arbVec2, { minLength: 3, maxLength: 12 }), (points) => {
        return catmullRomToBezier(points, { closed: true }).length === points.length;
      }),
    );
  });

  it("a curva passa exatamente pelos pontos de entrada", () => {
    // É o que distingue Catmull-Rom de uma B-spline: interpola, não aproxima.
    // Requisito para "through": ["varsovia","kaunas","riga"] no Scene Script.
    const points: Vec2[] = [
      [0, 0],
      [30, 40],
      [70, 10],
      [100, 60],
    ];
    const segs = catmullRomToBezier(points);
    for (let i = 0; i < segs.length; i++) {
      expect(vec2.equals(sampleCubic(segs[i] as CubicSegment, 0), points[i] as Vec2, 1e-9)).toBe(
        true,
      );
    }
    const last = segs[segs.length - 1] as CubicSegment;
    expect(vec2.equals(sampleCubic(last, 1), points[points.length - 1] as Vec2, 1e-9)).toBe(true);
  });

  it("tem continuidade C1 nas junções — sem quina", () => {
    const points: Vec2[] = [
      [0, 0],
      [30, 40],
      [70, 10],
      [100, 60],
      [140, 30],
    ];
    const segs = catmullRomToBezier(points);
    for (let i = 0; i < segs.length - 1; i++) {
      const outgoing = vec2.normalize(cubicTangent(segs[i] as CubicSegment, 1));
      const incoming = vec2.normalize(cubicTangent(segs[i + 1] as CubicSegment, 0));
      expect(vec2.dot(outgoing, incoming)).toBeGreaterThan(0.999);
    }
  });

  it("tension 0 produz polilinha (handles nos terços)", () => {
    const points: Vec2[] = [
      [0, 0],
      [50, 0],
      [100, 0],
    ];
    const segs = catmullRomToBezier(points, { tension: 0 });
    const s = segs[0] as CubicSegment;
    expect(vec2.equals(s.c0, s.p0, 1e-9)).toBe(true);
    expect(vec2.equals(s.c1, s.p1, 1e-9)).toBe(true);
  });

  it("caminho fechado emenda o último no primeiro", () => {
    const points: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const segs = catmullRomToBezier(points, { closed: true });
    const last = segs[segs.length - 1] as CubicSegment;
    expect(vec2.equals(last.p1, points[0] as Vec2, 1e-9)).toBe(true);
  });
});

describe("arcSegment", () => {
  it("amount 0 é uma reta", () => {
    const straight = arcSegment([0, 0], [100, 0], 0);
    expect(sampleCubic(straight, 0.5)[1]).toBeCloseTo(0, 9);
  });

  it("curva lateralmente sem mover as pontas", () => {
    const arc = arcSegment([0, 0], [100, 0], 0.3);
    expect(vec2.equals(sampleCubic(arc, 0), [0, 0], 1e-9)).toBe(true);
    expect(vec2.equals(sampleCubic(arc, 1), [100, 0], 1e-9)).toBe(true);
    expect(Math.abs(sampleCubic(arc, 0.5)[1])).toBeGreaterThan(10);
  });

  it("o sinal escolhe o lado", () => {
    const up = sampleCubic(arcSegment([0, 0], [100, 0], 0.3), 0.5);
    const down = sampleCubic(arcSegment([0, 0], [100, 0], -0.3), 0.5);
    expect(Math.sign(up[1])).toBe(-Math.sign(down[1]));
    expect(approximately(up[1], -down[1], 1e-9)).toBe(true);
  });

  it("é mais comprido que a reta", () => {
    const straightLength = cubicLength(arcSegment([0, 0], [100, 0], 0));
    const arcLength = cubicLength(arcSegment([0, 0], [100, 0], 0.4));
    expect(arcLength).toBeGreaterThan(straightLength);
  });
});
