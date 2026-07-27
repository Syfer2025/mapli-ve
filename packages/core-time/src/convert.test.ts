import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  exactFrames,
  framesToSeconds,
  framesToTimecode,
  remapFrame,
  secondsToFrames,
  timecodeToFrames,
} from "./convert.js";
import { frame, seconds, timeBase, type TimeBase } from "./units.js";

const FPS_60 = timeBase(60);
const FPS_30 = timeBase(30);
const FPS_25 = timeBase(25);
const FPS_24 = timeBase(24);
const NTSC_DF = timeBase(29.97, true);
const NTSC_NDF = timeBase(29.97, false);
const NTSC_60_DF = timeBase(59.94, true);

describe("framesToSeconds / secondsToFrames", () => {
  it("valores conhecidos", () => {
    expect(framesToSeconds(frame(60), FPS_60)).toBe(1);
    expect(framesToSeconds(frame(90), FPS_60)).toBe(1.5);
    expect(framesToSeconds(frame(90), FPS_30)).toBe(3);
    expect(secondsToFrames(seconds(1.5), FPS_60)).toBe(90);
    expect(secondsToFrames(seconds(1.5), FPS_30)).toBe(45);
  });

  it("mesmo frame significa tempos diferentes em fps diferentes", () => {
    // O ponto central do ADR-004: o número do frame não carrega o fps.
    const f = frame(90);
    expect(framesToSeconds(f, FPS_60)).toBe(1.5);
    expect(framesToSeconds(f, FPS_30)).toBe(3);
  });

  it("ida e volta preserva o frame", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500000 }),
        fc.constantFrom(FPS_24, FPS_30, FPS_60, timeBase(120)),
        (n, base) => secondsToFrames(framesToSeconds(frame(n), base), base) === n,
      ),
    );
  });

  it("arredonda half-up", () => {
    // Regra documentada: "1.008s" a 60 fps = frame 60,48 → 60.
    expect(secondsToFrames(seconds(1.008), FPS_60)).toBe(60);
    expect(secondsToFrames(seconds(1.009), FPS_60)).toBe(61);
    expect(secondsToFrames(seconds(0.5), timeBase(1))).toBe(1); // 0,5 → 1
    expect(secondsToFrames(seconds(1.5), timeBase(1))).toBe(2); // 1,5 → 2
  });

  it("exactFrames não arredonda — base do motion blur subframe", () => {
    expect(exactFrames(seconds(1.008), FPS_60)).toBeCloseTo(60.48, 10);
    expect(Number.isInteger(exactFrames(seconds(1.008), FPS_60))).toBe(false);
  });
});

describe("framesToTimecode (non-drop)", () => {
  it("zero é 00:00:00:00", () => {
    expect(framesToTimecode(frame(0), FPS_60)).toEqual({
      negative: false,
      hours: 0,
      minutes: 0,
      seconds: 0,
      frames: 0,
    });
  });

  it("decompõe corretamente a 60 fps", () => {
    // 1h 23m 45s 14f = (3600 + 1380 + 45) * 60 + 14
    const total = (1 * 3600 + 23 * 60 + 45) * 60 + 14;
    expect(framesToTimecode(frame(total), FPS_60)).toEqual({
      negative: false,
      hours: 1,
      minutes: 23,
      seconds: 45,
      frames: 14,
    });
  });

  it("marca negativo e decompõe o valor absoluto", () => {
    const t = framesToTimecode(frame(-90), FPS_60);
    expect(t.negative).toBe(true);
    expect(t.seconds).toBe(1);
    expect(t.frames).toBe(30);
  });

  it("ida e volta preserva o frame", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000000 }),
        fc.constantFrom(FPS_24, FPS_30, FPS_60, NTSC_NDF),
        (n, base) => timecodeToFrames(framesToTimecode(frame(n), base), base) === n,
      ),
      { numRuns: 500 },
    );
  });
});

describe("timecode drop-frame", () => {
  it("ida e volta preserva o frame a 29.97", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000000 }),
        (n) => timecodeToFrames(framesToTimecode(frame(n), NTSC_DF), NTSC_DF) === n,
      ),
      { numRuns: 1000 },
    );
  });

  it("ida e volta preserva o frame a 59.94", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000000 }),
        (n) => timecodeToFrames(framesToTimecode(frame(n), NTSC_60_DF), NTSC_60_DF) === n,
      ),
      { numRuns: 1000 },
    );
  });

  it("salta os rótulos 0 e 1 na virada de minuto", () => {
    // Drop-frame não descarta imagem; descarta NÚMEROS de quadro, para que o
    // timecode não derive do tempo de parede a 29,97.
    const atMinute = timecodeToFrames(
      { negative: false, hours: 0, minutes: 0, seconds: 59, frames: 29 },
      NTSC_DF,
    );
    const next = framesToTimecode(frame(atMinute + 1), NTSC_DF);
    expect(next.minutes).toBe(1);
    expect(next.seconds).toBe(0);
    expect(next.frames).toBe(2); // 0 e 1 foram saltados
  });

  it("NÃO salta no décimo minuto", () => {
    const atNine = timecodeToFrames(
      { negative: false, hours: 0, minutes: 9, seconds: 59, frames: 29 },
      NTSC_DF,
    );
    const next = framesToTimecode(frame(atNine + 1), NTSC_DF);
    expect(next.minutes).toBe(10);
    expect(next.frames).toBe(0);
  });

  it("acompanha o tempo de parede em uma hora, melhor que non-drop", () => {
    // É para isso que drop-frame existe: 1h de timecode ≈ 1h de relógio.
    const oneHourFrames = frame(Math.round(29.97 * 3600));
    const df = framesToTimecode(oneHourFrames, NTSC_DF);
    const ndf = framesToTimecode(oneHourFrames, NTSC_NDF);

    expect(df.hours).toBe(1);
    expect(df.minutes).toBe(0);
    // Non-drop atrasa ~3,6 s por hora.
    expect(ndf.hours).toBe(0);
    expect(ndf.minutes).toBe(59);
  });

  it("drop-frame e non-drop dão rótulos diferentes para o mesmo frame", () => {
    const f = frame(30000);
    expect(framesToTimecode(f, NTSC_DF)).not.toEqual(framesToTimecode(f, NTSC_NDF));
  });
});

describe("remapFrame", () => {
  it("preserva os segundos ao trocar o fps", () => {
    // Opção "remapear" do diálogo de mudança de fps.
    const f = frame(90); // 1,5 s a 60 fps
    expect(remapFrame(f, FPS_60, FPS_30)).toBe(45); // 1,5 s a 30 fps
    expect(remapFrame(f, FPS_60, timeBase(120))).toBe(180);
  });

  it("é identidade quando o fps não muda", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        (n) => remapFrame(frame(n), FPS_60, FPS_60) === n,
      ),
    );
  });

  it("ida e volta é estável para fps múltiplos", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), (n) => {
        const f = frame(n);
        return remapFrame(remapFrame(f, FPS_30, FPS_60), FPS_60, FPS_30) === n;
      }),
    );
  });

  it("mantém a duração em segundos aproximadamente", () => {
    const bases: TimeBase[] = [FPS_24, FPS_25, FPS_30, FPS_60];
    for (const from of bases) {
      for (const to of bases) {
        const original = framesToSeconds(frame(600), from);
        const remapped = framesToSeconds(remapFrame(frame(600), from, to), to);
        // O erro é limitado por meio frame do destino (arredondamento half-up).
        expect(Math.abs(remapped - original)).toBeLessThanOrEqual(0.5 / to.fps + 1e-12);
      }
    }
  });
});
