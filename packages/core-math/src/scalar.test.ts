import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  approximately,
  clamp,
  clamp01,
  dampingToWindow,
  gaussianWeights,
  inverseLerp,
  lerp,
  lerpAngle,
  normalizeDegrees,
  remap,
  remapClamped,
  shortestAngleDelta,
  toDegrees,
  toRadians,
  weightedAverage,
} from "./scalar.js";

describe("conversão de ângulo", () => {
  it("ida e volta preserva o valor", () => {
    fc.assert(
      fc.property(fc.double({ min: -720, max: 720, noNaN: true }), (deg) =>
        approximately(toDegrees(toRadians(deg)), deg, 1e-9),
      ),
    );
  });

  it("valores conhecidos", () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 12);
    expect(toDegrees(Math.PI / 2)).toBeCloseTo(90, 12);
  });
});

describe("lerp / inverseLerp / remap", () => {
  it("lerp atinge os extremos exatamente", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it("lerp extrapola fora de [0,1]", () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });

  it("inverseLerp é o inverso de lerp", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b, t) => {
          if (Math.abs(a - b) < 1e-6) return true;
          return approximately(inverseLerp(a, b, lerp(a, b, t)), t, 1e-6);
        },
      ),
    );
  });

  it("inverseLerp devolve 0 quando a === b, em vez de NaN", () => {
    expect(inverseLerp(5, 5, 5)).toBe(0);
    expect(Number.isNaN(inverseLerp(5, 5, 99))).toBe(false);
  });

  it("remap converte entre faixas", () => {
    expect(remap(5, 0, 10, 0, 100)).toBe(50);
    expect(remap(0, 0, 10, 20, 30)).toBe(20);
  });

  it("remapClamped não passa dos limites de saída", () => {
    expect(remapClamped(20, 0, 10, 0, 100)).toBe(100);
    expect(remapClamped(-5, 0, 10, 0, 100)).toBe(0);
    expect(remap(20, 0, 10, 0, 100)).toBe(200); // sem clamp, extrapola
  });
});

describe("clamp", () => {
  it("limita nos dois lados", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("clamp01 é o caso comum", () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });

  it("resultado sempre dentro da faixa", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true }),
        fc.double({ min: -100, max: 0, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (v, min, max) => {
          const r = clamp(v, min, max);
          return r >= min && r <= max;
        },
      ),
    );
  });
});

describe("normalizeDegrees", () => {
  it("normaliza para [0, 360)", () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(-10)).toBe(350);
    expect(normalizeDegrees(-370)).toBe(350);
  });

  it("resultado sempre em [0, 360)", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), (deg) => {
        const n = normalizeDegrees(deg);
        return n >= 0 && n < 360;
      }),
    );
  });
});

describe("shortestAngleDelta", () => {
  it("escolhe o caminho curto na virada de 360", () => {
    // O caso que faz um tanque girar 340° no sentido errado se tratado ingenuamente.
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
  });

  it("é zero para o mesmo ângulo", () => {
    expect(shortestAngleDelta(45, 45)).toBe(0);
    expect(shortestAngleDelta(45, 405)).toBe(0);
  });

  it("resultado em (-180, 180]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        (from, to) => {
          const d = shortestAngleDelta(from, to);
          return d > -180.0000001 && d <= 180.0000001;
        },
      ),
    );
  });

  /**
   * A distância entre dois ângulos é modular, e comparar as normalizações com
   * `approximately` mede na régua errada — a diferença linear atravessa a costura
   * 0/360.
   *
   * Isto não é teoria: com `to = -360.00000000000006` (o double imediatamente
   * abaixo de −360) `normalizeDegrees` devolve 359.99999999999994, enquanto
   * `from + delta` arredonda para um múltiplo exato de 360 e devolve 0. Os dois
   * são a MESMA direção a menos de 6e-14, mas a diferença linear é 360, e a
   * asserção falhava. Como o `fc.assert` corre sem semente fixa e é o fast-check
   * que insiste nas fronteiras, a falha aparecia em uma volta a cada poucas — o
   * pior tipo de vermelho, porque parece infraestrutura e é asserção.
   *
   * A régua certa é o próprio `shortestAngleDelta`: se aplicar o delta chega no
   * destino, a menor rotação entre o resultado e o destino é zero.
   */
  it("aplicar o delta chega no destino", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -360, max: 360, noNaN: true }),
        fc.double({ min: -360, max: 360, noNaN: true }),
        (from, to) =>
          approximately(
            shortestAngleDelta(
              normalizeDegrees(from + shortestAngleDelta(from, to)),
              normalizeDegrees(to),
            ),
            0,
            1e-9,
          ),
      ),
    );
  });

  it("chega no destino mesmo na costura 0/360", () => {
    // O contraexemplo exato que o fast-check achava de vez em quando.
    for (const [from, to] of [
      [199.67773465141272, -360.00000000000006],
      [302.4476246687557, -360.00000000000006],
      [0, -360.00000000000006],
      [180, 360.00000000000006],
    ] as const) {
      const arrived = normalizeDegrees(from + shortestAngleDelta(from, to));
      expect(Math.abs(shortestAngleDelta(arrived, normalizeDegrees(to)))).toBeLessThan(1e-9);
    }
  });
});

describe("lerpAngle", () => {
  it("interpola pelo caminho curto", () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(360, 9);
    expect(normalizeDegrees(lerpAngle(350, 10, 0.5))).toBeCloseTo(0, 9);
  });

  it("atinge os extremos", () => {
    expect(lerpAngle(30, 60, 0)).toBe(30);
    expect(normalizeDegrees(lerpAngle(30, 60, 1))).toBeCloseTo(60, 9);
  });
});

describe("suavização determinística", () => {
  it("gaussianWeights soma 1", () => {
    for (const n of [1, 3, 5, 11, 31, 61]) {
      const w = gaussianWeights(n);
      const sum = Array.from(w).reduce((s, v) => s + v, 0);
      expect(sum).toBeCloseTo(1, 12);
    }
  });

  it("gaussianWeights é simétrico e tem pico no centro", () => {
    const w = gaussianWeights(11);
    for (let i = 0; i < 5; i++) {
      expect(w[i]).toBeCloseTo(w[10 - i] as number, 12);
    }
    const center = w[5] as number;
    expect(center).toBeGreaterThan(w[0] as number);
    expect(center).toBe(Math.max(...Array.from(w)));
  });

  it("janela de 1 é peso unitário — damping 0 significa sem suavização", () => {
    expect(Array.from(gaussianWeights(1))).toEqual([1]);
    expect(dampingToWindow(0)).toBe(1);
  });

  it("dampingToWindow devolve tamanho ímpar", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (d) => {
        const w = dampingToWindow(d);
        return w % 2 === 1 && w >= 1 && w <= 61;
      }),
    );
  });

  it("dampingToWindow cresce com o damping", () => {
    expect(dampingToWindow(0)).toBeLessThan(dampingToWindow(0.5));
    expect(dampingToWindow(0.5)).toBeLessThan(dampingToWindow(1));
    expect(dampingToWindow(1)).toBe(61);
  });

  it("weightedAverage de valor constante devolve a constante", () => {
    const w = gaussianWeights(21);
    const values = new Array<number>(21).fill(7);
    expect(weightedAverage(values, w)).toBeCloseTo(7, 12);
  });

  it("weightedAverage suaviza um degrau sem deslocá-lo no tempo", () => {
    // Janela simétrica: no centro exato do degrau, o valor é a média.
    const w = gaussianWeights(21);
    const values = Array.from({ length: 21 }, (_, i) => (i < 10 ? 0 : i === 10 ? 0.5 : 1));
    expect(weightedAverage(values, w)).toBeCloseTo(0.5, 6);
  });
});
