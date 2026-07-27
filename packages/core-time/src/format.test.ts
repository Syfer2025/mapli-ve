import { describe, expect, it } from "vitest";
import { format, formatDuration } from "./format.js";
import { frame, timeBase } from "./units.js";

const FPS_60 = timeBase(60);
const FPS_30 = timeBase(30);
const FPS_120 = timeBase(120);
const NTSC_DF = timeBase(29.97, true);

describe('format "timecode"', () => {
  it("preenche com zeros", () => {
    expect(format(frame(0), FPS_60)).toBe("00:00:00:00");
    expect(format(frame(90), FPS_60)).toBe("00:00:01:30");
  });

  it("compõe horas, minutos, segundos e frames", () => {
    const total = (1 * 3600 + 23 * 60 + 45) * 60 + 14;
    expect(format(frame(total), FPS_60)).toBe("01:23:45:14");
  });

  it("usa três dígitos de frame acima de 100 fps", () => {
    // A 120 fps o campo vai até 119; dois dígitos truncariam a leitura.
    expect(format(frame(119), FPS_120)).toBe("00:00:00:119");
    expect(format(frame(5), FPS_120)).toBe("00:00:00:005");
  });

  it('drop-frame usa ";" antes dos frames', () => {
    expect(format(frame(1800), NTSC_DF)).toMatch(/;\d\d$/);
    expect(format(frame(1800), timeBase(29.97, false))).toMatch(/:\d\d$/);
  });

  it("prefixa o negativo", () => {
    expect(format(frame(-90), FPS_60)).toBe("-00:00:01:30");
  });
});

describe('format "clock"', () => {
  it("é M:SS.mmm", () => {
    expect(format(frame(0), FPS_60, "clock")).toBe("0:00.000");
    expect(format(frame(90), FPS_60, "clock")).toBe("0:01.500");
    expect(format(frame(3661 * 60), FPS_60, "clock")).toBe("61:01.000");
  });

  it("prefixa o negativo", () => {
    expect(format(frame(-90), FPS_60, "clock")).toBe("-0:01.500");
  });
});

describe('format "seconds"', () => {
  it("corta zeros à direita", () => {
    expect(format(frame(90), FPS_60, "seconds")).toBe("1.5s");
    expect(format(frame(120), FPS_60, "seconds")).toBe("2s");
    expect(format(frame(0), FPS_60, "seconds")).toBe("0s");
  });

  it("respeita o fps", () => {
    expect(format(frame(90), FPS_30, "seconds")).toBe("3s");
  });
});

describe('format "frames"', () => {
  it("é o número com sufixo f", () => {
    expect(format(frame(90), FPS_60, "frames")).toBe("90f");
    expect(format(frame(0), FPS_60, "frames")).toBe("0f");
    expect(format(frame(-30), FPS_60, "frames")).toBe("-30f");
  });
});

describe('format "compact"', () => {
  it("omite a parte nula", () => {
    expect(format(frame(90), FPS_60, "compact")).toBe("1.5s");
    expect(format(frame(3600), FPS_60, "compact")).toBe("1m");
    expect(format(frame(5400), FPS_60, "compact")).toBe("1m30s");
    expect(format(frame(0), FPS_60, "compact")).toBe("0s");
  });

  it("prefixa o negativo", () => {
    expect(format(frame(-5400), FPS_60, "compact")).toBe("-1m30s");
  });
});

describe("formatDuration", () => {
  it("monta a partir das unidades presentes", () => {
    expect(formatDuration(frame(0), FPS_60)).toBe("0s");
    expect(formatDuration(frame(60), FPS_60)).toBe("1s");
    expect(formatDuration(frame(5400), FPS_60)).toBe("1m 30s");
    expect(formatDuration(frame(3600 * 60), FPS_60)).toBe("1h");
    expect(formatDuration(frame((3600 + 24 * 60 + 18) * 60), FPS_60)).toBe("1h 24m 18s");
  });

  it("usa valor absoluto", () => {
    expect(formatDuration(frame(-5400), FPS_60)).toBe("1m 30s");
  });
});
