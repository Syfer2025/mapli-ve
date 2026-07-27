import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createRng } from "./prng.js";
import { hashSeed } from "./hash.js";

describe("createRng", () => {
  it("mesma semente → mesma sequência", () => {
    // Este é o teste que sustenta a reprodutibilidade do export inteiro.
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("sementes diferentes → sequências diferentes", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("sementes adjacentes não ficam correlacionadas", () => {
    // Sem a rodagem inicial, createRng(1) e createRng(2) produziriam primeiras
    // saídas próximas — visível como explosões vizinhas com aparência idêntica.
    const first = Array.from({ length: 64 }, (_, i) => createRng(i).next());
    const diffs = first.slice(1).map((v, i) => Math.abs(v - (first[i] as number)));
    const meanDiff = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    // Para valores independentes em [0,1), a diferença média absoluta é ~1/3.
    expect(meanDiff).toBeGreaterThan(0.2);
  });

  it("next() fica em [0, 1)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = createRng(seed);
        for (let i = 0; i < 50; i++) {
          const v = rng.next();
          if (!(v >= 0 && v < 1)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("int(max) fica em [0, max)", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 10000 }), (seed, max) => {
        const rng = createRng(seed);
        for (let i = 0; i < 20; i++) {
          const v = rng.int(max);
          if (!Number.isInteger(v) || v < 0 || v >= max) return false;
        }
        return true;
      }),
    );
  });

  it("range(min, max) fica em [min, max)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.range(-10, 10);
      expect(v).toBeGreaterThanOrEqual(-10);
      expect(v).toBeLessThan(10);
    }
  });

  it("bool(p) respeita a probabilidade aproximadamente", () => {
    const rng = createRng(99);
    let trues = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (rng.bool(0.25)) trues++;
    expect(trues / n).toBeCloseTo(0.25, 1);
  });

  it("pick devolve undefined em array vazio", () => {
    expect(createRng(1).pick([])).toBeUndefined();
  });

  it("pick só devolve elementos do array", () => {
    const rng = createRng(3);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it("gaussian tem média ~0 e desvio ~1", () => {
    const rng = createRng(2026);
    const n = 50000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.gaussian();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeCloseTo(1, 1);
  });

  it("angle fica em [0, 2π)", () => {
    const rng = createRng(5);
    for (let i = 0; i < 200; i++) {
      const a = rng.angle();
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });

  it("distribuição é aproximadamente uniforme (chi-quadrado em 10 baldes)", () => {
    const rng = createRng(31337);
    const buckets = new Array<number>(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const b = Math.floor(rng.next() * 10);
      buckets[b] = (buckets[b] as number) + 1;
    }
    const expected = n / 10;
    const chi2 = buckets.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
    // 9 graus de liberdade, p=0.001 → valor crítico 27.88
    expect(chi2).toBeLessThan(27.88);
  });

  it("compõe com hashSeed — o padrão de semente de efeito", () => {
    const seed = hashSeed(20260726, "nd_tank_1", "fx_explosion", 0);
    const a = createRng(seed);
    const b = createRng(hashSeed(20260726, "nd_tank_1", "fx_explosion", 0));
    expect(a.next()).toBe(b.next());

    // Partícula de índice diferente → variação diferente, ainda reproduzível.
    const other = createRng(hashSeed(20260726, "nd_tank_1", "fx_explosion", 1));
    expect(createRng(seed).next()).not.toBe(other.next());
  });
});
