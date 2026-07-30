import { describe, expect, it } from "vitest";
import {
  MotionBlurAccumulator,
  MotionBlurError,
  estimateMotionBlurSettleMs,
  motionBlurSampleFrames,
  planMotionBlur,
} from "./motion-blur.js";

describe("planMotionBlur", () => {
  it("fica desligado por padrão e expõe uma amostra efetiva", () => {
    expect(planMotionBlur()).toEqual({
      shutterAngle: 180,
      samples: 1,
      enabled: false,
      effectiveSamples: 1,
      exposureFrames: 0,
    });
  });

  it("ângulo zero e uma amostra contornam o blur", () => {
    expect(planMotionBlur({ shutterAngle: 0, samples: 8 })).toMatchObject({
      enabled: false,
      samples: 8,
      effectiveSamples: 1,
    });
    expect(planMotionBlur({ shutterAngle: 180, samples: 1 })).toMatchObject({
      enabled: false,
      effectiveSamples: 1,
    });
  });

  it("aceita 180° × 8 como meia exposição em oito estratos", () => {
    expect(planMotionBlur({ shutterAngle: 180, samples: 8 })).toEqual({
      shutterAngle: 180,
      samples: 8,
      enabled: true,
      effectiveSamples: 8,
      exposureFrames: 0.5,
    });
  });

  it.each([
    { shutterAngle: -1, samples: 8 },
    { shutterAngle: 361, samples: 8 },
    { shutterAngle: Number.NaN, samples: 8 },
    { shutterAngle: Number.POSITIVE_INFINITY, samples: 8 },
    { shutterAngle: 180, samples: 0 },
    { shutterAngle: 180, samples: 1.5 },
    { shutterAngle: 180, samples: 65 },
  ])("recusa configuração inválida %#", (spec) => {
    expect(() => planMotionBlur(spec)).toThrow(MotionBlurError);
  });
});

describe("motionBlurSampleFrames", () => {
  it("usa pontos médios simétricos sem arredondar", () => {
    const frames = motionBlurSampleFrames(
      12,
      30,
      planMotionBlur({ shutterAngle: 180, samples: 8 }),
    );
    expect(frames).toEqual([
      11.78125, 11.84375, 11.90625, 11.96875, 12.03125, 12.09375, 12.15625, 12.21875,
    ]);
    expect(frames.some((value) => !Number.isInteger(value))).toBe(true);
    expect(frames[0]! + frames[7]!).toBe(24);
  });

  it("limita só nas bordas reais da composição", () => {
    const plan = planMotionBlur({ shutterAngle: 360, samples: 4 });
    expect(motionBlurSampleFrames(0, 10, plan)).toEqual([0, 0, 0.125, 0.375]);
    expect(motionBlurSampleFrames(9, 10, plan)).toEqual([8.625, 8.875, 9, 9]);
    // Um frame que seria a ponta de um trecho 4…6 não é grampeado ao trecho.
    expect(motionBlurSampleFrames(4, 10, plan)[0]).toBe(3.625);
  });

  it("o plano desligado devolve somente o frame central", () => {
    expect(motionBlurSampleFrames(7, 20, planMotionBlur({ shutterAngle: 0, samples: 8 }))).toEqual([
      7,
    ]);
  });
});

describe("estimateMotionBlurSettleMs", () => {
  it("reproduz a referência declarada de 300 × 8 × 100 ms = 4 min", () => {
    const plan = planMotionBlur({ shutterAngle: 180, samples: 8 });
    expect(estimateMotionBlurSettleMs(300, plan)).toBe(240_000);
  });

  it("usa uma amostra efetiva quando desligado", () => {
    expect(estimateMotionBlurSettleMs(300, planMotionBlur())).toBe(30_000);
  });
});

function rgba(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("MotionBlurAccumulator", () => {
  it("faz média half-up de pixels opacos", () => {
    const accumulator = new MotionBlurAccumulator();
    accumulator.begin(1, 1);
    accumulator.add({ width: 1, height: 1, rgba: rgba(255, 0, 0, 255) });
    accumulator.add({ width: 1, height: 1, rgba: rgba(0, 0, 255, 255) });
    expect([...accumulator.resolve(2).rgba]).toEqual([128, 0, 128, 255]);
  });

  it("acumula pré-multiplicado e não deixa RGB transparente criar halo", () => {
    const accumulator = new MotionBlurAccumulator();
    accumulator.begin(1, 1);
    accumulator.add({ width: 1, height: 1, rgba: rgba(255, 0, 0, 255) });
    accumulator.add({ width: 1, height: 1, rgba: rgba(0, 0, 255, 0) });
    expect([...accumulator.resolve(2).rgba]).toEqual([255, 0, 0, 128]);
  });

  it("resolve pixel totalmente transparente para zero canônico", () => {
    const accumulator = new MotionBlurAccumulator();
    accumulator.begin(1, 1);
    accumulator.add({ width: 1, height: 1, rgba: rgba(99, 88, 77, 0) });
    accumulator.add({ width: 1, height: 1, rgba: rgba(1, 2, 3, 0) });
    expect([...accumulator.resolve(2).rgba]).toEqual([0, 0, 0, 0]);
  });

  it("zera RGB quando o alfa médio positivo arredonda para zero", () => {
    const accumulator = new MotionBlurAccumulator();
    accumulator.begin(1, 1);
    accumulator.add({ width: 1, height: 1, rgba: rgba(255, 0, 0, 1) });
    for (let index = 1; index < 4; index += 1) {
      accumulator.add({ width: 1, height: 1, rgba: rgba(0, 0, 0, 0) });
    }
    expect([...accumulator.resolve(4).rgba]).toEqual([0, 0, 0, 0]);
  });

  it("preserva exatamente amostras idênticas", () => {
    const source = rgba(1, 2, 3, 4, 250, 200, 150, 100);
    const accumulator = new MotionBlurAccumulator();
    accumulator.begin(2, 1);
    for (let index = 0; index < 8; index += 1) {
      accumulator.add({ width: 2, height: 1, rgba: source });
    }
    expect(accumulator.resolve(8).rgba).toEqual(source);
  });

  it("reaproveita um único Float32Array e o mesmo destino entre frames", () => {
    const accumulator = new MotionBlurAccumulator();
    accumulator.begin(1, 1);
    accumulator.add({ width: 1, height: 1, rgba: rgba(10, 20, 30, 255) });
    const first = accumulator.resolve(1).rgba;

    accumulator.begin(1, 1);
    accumulator.add({ width: 1, height: 1, rgba: rgba(40, 50, 60, 255) });
    const second = accumulator.resolve(1).rgba;

    expect(second).toBe(first);
    expect([...second]).toEqual([40, 50, 60, 255]);
    expect(accumulator.allocations).toBe(1);
    expect(accumulator.floatBytes).toBe(16);
  });

  it("recusa resolução variável e acumulação parcial", () => {
    const accumulator = new MotionBlurAccumulator();
    accumulator.begin(1, 1);
    accumulator.add({ width: 1, height: 1, rgba: rgba(0, 0, 0, 255) });
    expect(() => accumulator.resolve(2)).toThrow(/parcial/u);
    expect(() => accumulator.begin(2, 1)).toThrow(/resolução mudou/u);
  });
});
