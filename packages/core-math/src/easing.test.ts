import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  cubicBezierEase,
  EASE_PRESETS,
  evaluateBezierEase,
  solveBezierX,
  type EasePresetName,
} from "./easing.js";
import type { Vec2 } from "./vec.js";

const PRESET_NAMES = Object.keys(EASE_PRESETS) as EasePresetName[];

/** Handles válidos: x em [0,1] (monotonicidade temporal), y livre (overshoot). */
const arbHandle = fc.tuple(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: -0.5, max: 1.5, noNaN: true }),
) as fc.Arbitrary<Vec2>;

describe("solveBezierX", () => {
  it("atalho exato para a curva linear", () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(solveBezierX(1 / 3, 2 / 3, x)).toBe(x);
    }
  });

  it("t resolvido reproduz o x pedido", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (p1x, p2x, x) => {
          const t = solveBezierX(p1x, p2x, x);
          // Reconstrói x(t) e compara.
          const u = 1 - t;
          const back = 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t;
          return Math.abs(back - x) < 1e-4;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("converge mesmo em ease extremo, onde a derivada é quase nula", () => {
    // Só Newton-Raphson divergiria aqui; a bisseção de fallback é o que salva.
    const t = solveBezierX(1, 0, 0.5);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(1);
  });
});

describe("cubicBezierEase", () => {
  it("ancora nos extremos exatamente", () => {
    for (const name of PRESET_NAMES) {
      const { out, in: inHandle } = EASE_PRESETS[name];
      const ease = cubicBezierEase(out, inHandle);
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
  });

  it("satura fora de [0,1]", () => {
    const ease = cubicBezierEase(EASE_PRESETS.easeInOut.out, EASE_PRESETS.easeInOut.in);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it("linear é a identidade", () => {
    const ease = cubicBezierEase(EASE_PRESETS.linear.out, EASE_PRESETS.linear.in);
    for (const x of [0.1, 0.25, 0.5, 0.9]) {
      expect(ease(x)).toBeCloseTo(x, 6);
    }
  });

  it("easeIn começa devagar; easeOut termina devagar", () => {
    const easeIn = cubicBezierEase(EASE_PRESETS.easeIn.out, EASE_PRESETS.easeIn.in);
    const easeOut = cubicBezierEase(EASE_PRESETS.easeOut.out, EASE_PRESETS.easeOut.in);
    expect(easeIn(0.25)).toBeLessThan(0.25);
    expect(easeOut(0.25)).toBeGreaterThan(0.25);
  });

  it("presets com handles em [0,1] são monotônicos crescentes", () => {
    // cinematicIn tem y=1 nos dois handles, o que é válido e não gera overshoot.
    for (const name of PRESET_NAMES) {
      const { out, in: inHandle } = EASE_PRESETS[name];
      const ease = cubicBezierEase(out, inHandle);
      let previous = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const y = ease(i / 100);
        expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = y;
      }
    }
  });

  it("saída fica em [0,1] quando os handles em y estão em [0,1]", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
        ),
        fc.tuple(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
        ),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (p1, p2, x) => {
          const y = cubicBezierEase(p1 as Vec2, p2 as Vec2)(x);
          return y >= -1e-9 && y <= 1 + 1e-9;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("é determinístico — mesma entrada, mesma saída", () => {
    fc.assert(
      fc.property(arbHandle, arbHandle, fc.double({ min: 0, max: 1, noNaN: true }), (p1, p2, x) => {
        const a = cubicBezierEase(p1, p2)(x);
        const b = cubicBezierEase(p1, p2)(x);
        return a === b;
      }),
      { numRuns: 300 },
    );
  });
});

describe("evaluateBezierEase", () => {
  it("concorda com a versão em closure", () => {
    fc.assert(
      fc.property(arbHandle, arbHandle, fc.double({ min: 0, max: 1, noNaN: true }), (p1, p2, x) => {
        const closure = cubicBezierEase(p1, p2)(x);
        const direct = evaluateBezierEase(p1, p2, x);
        return Math.abs(closure - direct) < 1e-9;
      }),
      { numRuns: 300 },
    );
  });
});

describe("presets específicos do domínio", () => {
  it("cinematic acelera cedo e desacelera longo — movimento de câmera", () => {
    const cinematic = cubicBezierEase(EASE_PRESETS.cinematic.out, EASE_PRESETS.cinematic.in);
    const inOut = cubicBezierEase(EASE_PRESETS.easeInOut.out, EASE_PRESETS.easeInOut.in);

    // Já passou de 80% do caminho na metade do tempo…
    expect(cinematic(0.5)).toBeGreaterThan(0.8);
    expect(cinematic(0.3)).toBeGreaterThan(inOut(0.3));
    // …e gasta a metade final desacelerando os últimos 20%.
    expect(cinematic(0.9)).toBeGreaterThan(0.98);
  });

  it("snap sai quase instantâneo — impacto de explosão", () => {
    const snap = cubicBezierEase(EASE_PRESETS.snap.out, EASE_PRESETS.snap.in);
    expect(snap(0.1)).toBeGreaterThan(0.4);
    expect(snap(0.25)).toBeGreaterThan(0.8);
  });

  it("todos os presets têm x de handle em [0,1] — condição de monotonicidade", () => {
    for (const name of PRESET_NAMES) {
      const { out, in: inHandle } = EASE_PRESETS[name];
      expect(out[0]).toBeGreaterThanOrEqual(0);
      expect(out[0]).toBeLessThanOrEqual(1);
      expect(inHandle[0]).toBeGreaterThanOrEqual(0);
      expect(inHandle[0]).toBeLessThanOrEqual(1);
    }
  });
});
