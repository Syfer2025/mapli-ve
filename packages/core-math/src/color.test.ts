import { describe, expect, it } from "vitest";

import { formatHexColor, lerpOklabHex, oklabToSrgb, parseHexColor, srgbToOklab } from "./color.js";

describe("parseHexColor", () => {
  it("lê os quatro formatos de hex", () => {
    expect(parseHexColor("#f00")).toEqual([255, 0, 0, 255]);
    expect(parseHexColor("#f008")).toEqual([255, 0, 0, 136]);
    expect(parseHexColor("#ff0000")).toEqual([255, 0, 0, 255]);
    expect(parseHexColor("#ff000080")).toEqual([255, 0, 0, 128]);
    expect(parseHexColor("#FF0000")).toEqual([255, 0, 0, 255]);
  });

  it("recusa o que não é cor", () => {
    expect(parseHexColor("")).toBeNull();
    expect(parseHexColor("red")).toBeNull();
    expect(parseHexColor("#12")).toBeNull();
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor("#gggggg")).toBeNull();
    expect(parseHexColor("ff0000")).toBeNull();
    expect(parseHexColor("a")).toBeNull();
  });
});

describe("formatHexColor", () => {
  it("usa seis dígitos quando opaco e oito quando há alfa", () => {
    expect(formatHexColor(255, 0, 0)).toBe("#ff0000");
    expect(formatHexColor(255, 0, 0, 255)).toBe("#ff0000");
    expect(formatHexColor(255, 0, 0, 128)).toBe("#ff000080");
    expect(formatHexColor(0, 0, 0, 0)).toBe("#00000000");
  });

  it("arredonda e grampeia canais fora do gamute", () => {
    expect(formatHexColor(255.4, -3, 12.5)).toBe("#ff000d");
  });
});

describe("srgb ↔ oklab", () => {
  it("faz roundtrip dentro de um nível de canal", () => {
    for (let channel = 0; channel <= 255; channel += 17) {
      for (let other = 0; other <= 255; other += 85) {
        const [l, a, b] = srgbToOklab(channel, other, 255 - channel);
        const [r, g, blue] = oklabToSrgb(l, a, b);
        expect(Math.abs(Math.round(r) - channel)).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.round(g) - other)).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.round(blue) - (255 - channel))).toBeLessThanOrEqual(1);
      }
    }
  });

  it("mapeia os extremos", () => {
    const [l, a, b] = srgbToOklab(0, 0, 0);
    expect(l).toBeCloseTo(0, 6);
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
    const [wr, wg, wb] = oklabToSrgb(...srgbToOklab(255, 255, 255));
    expect(Math.round(wr)).toBe(255);
    expect(Math.round(wg)).toBe(255);
    expect(Math.round(wb)).toBe(255);
  });
});

describe("lerpOklabHex", () => {
  it("devolve as fronteiras bit-idênticas, sem roundtrip", () => {
    expect(lerpOklabHex("#Ff0000", "#0000FF", 0)).toBe("#Ff0000");
    expect(lerpOklabHex("#ff0000", "#0000ff", 1)).toBe("#0000ff");
    expect(lerpOklabHex("#ff0000", "#0000ff", -0.5)).toBe("#ff0000");
    expect(lerpOklabHex("#ff0000", "#0000ff", 1.5)).toBe("#0000ff");
  });

  it("recusa o que não é cor, para o chamador cair no discreto", () => {
    expect(lerpOklabHex("a", "b", 0.5)).toBeNull();
    expect(lerpOklabHex("#ff0000", "b", 0.5)).toBeNull();
    expect(lerpOklabHex("a", "#0000ff", 0.5)).toBeNull();
  });

  it("cruza vermelho→azul por roxo, sem o cinza do sRGB direto", () => {
    const mid = lerpOklabHex("#ff0000", "#0000ff", 0.5);
    expect(mid).not.toBeNull();
    const parsed = parseHexColor(mid ?? "");
    expect(parsed).not.toBeNull();
    const [r, g, b] = parsed ?? [0, 0, 0, 0];
    // Roxo perceptual: vermelho e azul presentes, verde bem abaixo de ambos.
    expect(r).toBeGreaterThan(60);
    expect(b).toBeGreaterThan(60);
    expect(g).toBeLessThan(r - 30);
    expect(g).toBeLessThan(b - 30);
    // E não é o `#800080` do lerp em sRGB direto.
    expect(mid).not.toBe("#800080");
  });

  it("é determinístico e percorre tons distintos", () => {
    const first = lerpOklabHex("#ff0000", "#0000ff", 0.5);
    expect(lerpOklabHex("#ff0000", "#0000ff", 0.5)).toBe(first);
    const quarter = lerpOklabHex("#ff0000", "#0000ff", 0.25);
    const threeQuarters = lerpOklabHex("#ff0000", "#0000ff", 0.75);
    expect(new Set([quarter, first, threeQuarters]).size).toBe(3);
  });

  it("interpola alfa fora do OkLab e preserva o formato do documento", () => {
    expect(lerpOklabHex("#ff0000ff", "#0000ff00", 0.5)).toMatch(/^#[0-9a-f]{8}$/);
    expect(lerpOklabHex("#ff0000ff", "#0000ff00", 0.5)?.slice(7)).toBe("80");
    expect(lerpOklabHex("#ff0000", "#0000ff", 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
