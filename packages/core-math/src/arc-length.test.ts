import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  arcLengthToT,
  buildArcLengthTable,
  pathTangent,
  progressToT,
  samplePath,
} from "./arc-length.js";
import { catmullRomToBezier, cubicLength, lineSegment, type CubicSegment } from "./bezier.js";
import { vec2, type Vec2 } from "./vec.js";

const arbVec2 = fc.tuple(
  fc.double({ min: -500, max: 500, noNaN: true }),
  fc.double({ min: -500, max: 500, noNaN: true }),
) as fc.Arbitrary<Vec2>;

/** Caminho suave a partir de pontos distintos — o caso real de um path de mapa. */
const arbPath: fc.Arbitrary<readonly CubicSegment[]> = fc
  .array(arbVec2, { minLength: 2, maxLength: 8 })
  .filter((points) =>
    points.every((p, i) => i === 0 || vec2.distance(p, points[i - 1] as Vec2) > 1),
  )
  .map((points) => catmullRomToBezier(points));

describe("buildArcLengthTable", () => {
  it("caminho vazio produz tabela nula", () => {
    const table = buildArcLengthTable([]);
    expect(table.total).toBe(0);
    expect(table.segmentCount).toBe(0);
    expect(arcLengthToT(table, 5)).toBe(0);
  });

  it("total bate com a soma dos comprimentos dos segmentos", () => {
    const segments = [lineSegment([0, 0], [100, 0]), lineSegment([100, 0], [100, 50])];
    const table = buildArcLengthTable(segments, 64);
    expect(table.total).toBeCloseTo(150, 4);
  });

  it("distâncias acumuladas são monotonicamente não decrescentes", () => {
    fc.assert(
      fc.property(arbPath, (segments) => {
        const table = buildArcLengthTable(segments);
        for (let i = 1; i < table.distances.length; i++) {
          if ((table.distances[i] as number) < (table.distances[i - 1] as number)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("primeira amostra é zero e última é o total", () => {
    fc.assert(
      fc.property(arbPath, (segments) => {
        const table = buildArcLengthTable(segments);
        const last = table.distances[table.distances.length - 1] as number;
        return table.distances[0] === 0 && Math.abs(last - table.total) < 1e-9;
      }),
    );
  });

  it("aumentar a resolução aproxima do comprimento real", () => {
    const segments = catmullRomToBezier([
      [0, 0],
      [50, 100],
      [150, -50],
      [200, 60],
    ]);
    const reference = segments.reduce((sum, s) => sum + cubicLength(s, 2048), 0);
    const coarse = buildArcLengthTable(segments, 8).total;
    const fine = buildArcLengthTable(segments, 128).total;
    expect(Math.abs(fine - reference)).toBeLessThan(Math.abs(coarse - reference) + 1e-9);
    expect(Math.abs(fine - reference) / reference).toBeLessThan(0.001);
  });
});

describe("arcLengthToT", () => {
  it("É MONOTÔNICA — a propriedade que impede o objeto de andar para trás", () => {
    fc.assert(
      fc.property(
        arbPath,
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 2, maxLength: 40 }),
        (segments, fractions) => {
          const table = buildArcLengthTable(segments);
          const sorted = [...fractions].sort((a, b) => a - b);
          const ts = sorted.map((f) => arcLengthToT(table, f * table.total));
          for (let i = 1; i < ts.length; i++) {
            if ((ts[i] as number) < (ts[i - 1] as number) - 1e-9) return false;
          }
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("satura nos extremos", () => {
    const segments = [lineSegment([0, 0], [100, 0]), lineSegment([100, 0], [200, 0])];
    const table = buildArcLengthTable(segments);
    expect(arcLengthToT(table, -50)).toBe(0);
    expect(arcLengthToT(table, 0)).toBe(0);
    expect(arcLengthToT(table, table.total)).toBe(2);
    expect(arcLengthToT(table, table.total * 2)).toBe(2);
  });

  it("t resultante fica em [0, segmentCount]", () => {
    fc.assert(
      fc.property(arbPath, fc.double({ min: -1, max: 2, noNaN: true }), (segments, f) => {
        const table = buildArcLengthTable(segments);
        const t = arcLengthToT(table, f * table.total);
        return t >= 0 && t <= table.segmentCount;
      }),
    );
  });

  it("dá VELOCIDADE UNIFORME — o motivo de a tabela existir", () => {
    // Caminho com curva acentuada seguida de trecho longo: é exatamente onde a
    // parametrização ingênua falha. Pontos bem espaçados de propósito — em
    // curvatura extrema (cúspide) a corda entre amostras deixa de aproximar o
    // arco, e a medição abaixo mediria isso em vez da uniformidade.
    const segments = catmullRomToBezier([
      [0, 0],
      [100, 200],
      [280, 170],
      [600, 190],
    ]);
    const table = buildArcLengthTable(segments, 128);
    const steps = 40;

    const stepDistances = (toT: (progress: number) => number): number[] => {
      const distances: number[] = [];
      let previous = samplePath(segments, toT(0));
      for (let i = 1; i <= steps; i++) {
        const point = samplePath(segments, toT(i / steps));
        distances.push(vec2.distance(previous, point));
        previous = point;
      }
      return distances;
    };

    const deviation = (distances: number[]): number => {
      const mean = distances.reduce((s, d) => s + d, 0) / distances.length;
      return Math.max(...distances.map((d) => Math.abs(d - mean) / mean));
    };

    const reparametrized = deviation(stepDistances((p) => progressToT(table, p)));
    const naive = deviation(stepDistances((p) => p * segments.length));

    expect(reparametrized).toBeLessThan(0.1);
    // Prova a premissa: sem a tabela, o objeto acelera e desacelera de forma
    // visível. Se este assert deixar de valer, o teste acima perdeu o sentido.
    expect(naive).toBeGreaterThan(0.5);
    expect(reparametrized).toBeLessThan(naive / 4);
  });

  it("tolera pontos repetidos sem dividir por zero", () => {
    const degenerate: CubicSegment[] = [
      { p0: [0, 0], c0: [0, 0], c1: [0, 0], p1: [0, 0] },
      lineSegment([0, 0], [100, 0]),
    ];
    const table = buildArcLengthTable(degenerate);
    for (const f of [0, 0.25, 0.5, 1]) {
      const t = arcLengthToT(table, f * table.total);
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });

  it("caminho de comprimento zero não gera NaN", () => {
    const zero: CubicSegment[] = [{ p0: [5, 5], c0: [5, 5], c1: [5, 5], p1: [5, 5] }];
    const table = buildArcLengthTable(zero);
    expect(table.total).toBe(0);
    expect(Number.isFinite(arcLengthToT(table, 0))).toBe(true);
    expect(Number.isFinite(progressToT(table, 0.5))).toBe(true);
  });
});

describe("samplePath", () => {
  it("t=0 é o início e t=segmentCount é o fim", () => {
    const segments = [lineSegment([0, 0], [50, 0]), lineSegment([50, 0], [100, 0])];
    expect(samplePath(segments, 0)).toEqual([0, 0]);
    expect(samplePath(segments, 2)).toEqual([100, 0]);
  });

  it("satura fora da faixa", () => {
    const segments = [lineSegment([0, 0], [50, 0])];
    expect(samplePath(segments, -1)).toEqual([0, 0]);
    expect(samplePath(segments, 99)).toEqual([50, 0]);
  });

  it("caminho vazio devolve a origem em vez de lançar", () => {
    expect(samplePath([], 0.5)).toEqual([0, 0]);
  });

  it("a parte inteira seleciona o segmento", () => {
    const segments = [lineSegment([0, 0], [10, 0]), lineSegment([100, 0], [110, 0])];
    expect(samplePath(segments, 0.5)[0]).toBeCloseTo(5, 6);
    expect(samplePath(segments, 1.5)[0]).toBeCloseTo(105, 6);
  });

  it("é contínuo nas junções de segmento", () => {
    fc.assert(
      fc.property(arbPath, (segments) => {
        if (segments.length < 2) return true;
        for (let i = 1; i < segments.length; i++) {
          const before = samplePath(segments, i - 1e-9);
          const after = samplePath(segments, i + 1e-9);
          if (vec2.distance(before, after) > 1e-3) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

describe("pathTangent", () => {
  it("aponta na direção do percurso", () => {
    const segments = [lineSegment([0, 0], [100, 0])];
    const t = vec2.normalize(pathTangent(segments, 0.5));
    expect(t[0]).toBeCloseTo(1, 6);
    expect(t[1]).toBeCloseTo(0, 6);
  });

  it("nunca é nulo nem NaN", () => {
    fc.assert(
      fc.property(arbPath, fc.double({ min: 0, max: 1, noNaN: true }), (segments, f) => {
        const t = pathTangent(segments, f * segments.length);
        return Number.isFinite(t[0]) && Number.isFinite(t[1]) && vec2.lengthSquared(t) > 0;
      }),
    );
  });

  it("caminho vazio devolve direção padrão em vez de lançar", () => {
    expect(pathTangent([], 0)).toEqual([1, 0]);
  });

  it("bearing da tangente orienta a unidade — norte quando o path sobe", () => {
    const segments = [lineSegment([0, 0], [0, 100])];
    expect(vec2.bearing(pathTangent(segments, 0.5))).toBeCloseTo(0, 6);
  });
});
