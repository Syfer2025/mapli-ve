import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FPS_PRESETS,
  frame,
  frames,
  isDropFrameValid,
  nominalFps,
  seconds,
  subframe,
  timeBase,
} from "./units.js";

describe("frame", () => {
  it("arredonda half-up", () => {
    expect(frame(59.4)).toBe(59);
    expect(frame(59.5)).toBe(60);
    expect(frame(59.6)).toBe(60);
  });

  it("sempre devolve inteiro", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (n) =>
        Number.isInteger(frame(n)),
      ),
    );
  });
});

describe("subframe", () => {
  it("preserva a fração — é a exceção do motion blur", () => {
    // Único lugar onde tempo não inteiro é válido: amostragem f ± 0,25.
    expect(subframe(59.5)).toBe(59.5);
    expect(frames.isInteger(subframe(59.5))).toBe(false);
    expect(frames.isInteger(frame(59.5))).toBe(true);
  });
});

describe("operações que preservam a marca", () => {
  it("add e sub", () => {
    expect(frames.add(frame(60), 30)).toBe(90);
    expect(frames.add(frame(60), -30)).toBe(30);
    expect(frames.sub(frame(90), frame(60))).toBe(30);
  });

  it("clamp limita nos dois lados", () => {
    expect(frames.clamp(frame(50), frame(0), frame(100))).toBe(50);
    expect(frames.clamp(frame(-10), frame(0), frame(100))).toBe(0);
    expect(frames.clamp(frame(200), frame(0), frame(100))).toBe(100);
  });

  it("min e max", () => {
    expect(frames.min(frame(30), frame(60))).toBe(30);
    expect(frames.max(frame(30), frame(60))).toBe(60);
  });

  it("clamp sempre resulta dentro da faixa", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -100, max: 0 }),
        fc.integer({ min: 0, max: 100 }),
        (v, min, max) => {
          const r = frames.clamp(frame(v), frame(min), frame(max));
          return r >= min && r <= max;
        },
      ),
    );
  });
});

describe("nominalFps", () => {
  it("arredonda o fps NTSC para o inteiro de timecode", () => {
    expect(nominalFps(timeBase(29.97))).toBe(30);
    expect(nominalFps(timeBase(59.94))).toBe(60);
    expect(nominalFps(timeBase(23.976))).toBe(24);
  });

  it("é identidade para fps inteiro", () => {
    for (const fps of [24, 25, 30, 50, 60, 120]) {
      expect(nominalFps(timeBase(fps))).toBe(fps);
    }
  });
});

describe("isDropFrameValid", () => {
  it("aceita drop-frame só em fps NTSC", () => {
    expect(isDropFrameValid(timeBase(29.97, true))).toBe(true);
    expect(isDropFrameValid(timeBase(59.94, true))).toBe(true);
  });

  it("rejeita drop-frame em fps inteiro", () => {
    // Drop-frame em 60 fps não tem significado: o timecode não deriva.
    expect(isDropFrameValid(timeBase(30, true))).toBe(false);
    expect(isDropFrameValid(timeBase(60, true))).toBe(false);
    expect(isDropFrameValid(timeBase(24, true))).toBe(false);
  });

  it("non-drop é sempre válido", () => {
    for (const fps of FPS_PRESETS) {
      expect(isDropFrameValid(timeBase(fps, false))).toBe(true);
    }
  });
});

describe("seconds", () => {
  it("marca sem alterar o valor", () => {
    expect(seconds(1.5)).toBe(1.5);
    expect(seconds(0)).toBe(0);
  });
});

describe("FPS_PRESETS", () => {
  it("cobre os fps de produção e inclui os NTSC", () => {
    expect(FPS_PRESETS).toContain(24);
    expect(FPS_PRESETS).toContain(60);
    expect(FPS_PRESETS).toContain(120);
    expect(FPS_PRESETS).toContain(29.97);
    expect(FPS_PRESETS).toContain(59.94);
  });
});
