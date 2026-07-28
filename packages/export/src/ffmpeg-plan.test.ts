import { describe, expect, it } from "vitest";
import { planFfmpegExport } from "./ffmpeg-plan.js";

describe("plano FFmpeg", () => {
  it("gera GIF em dois passos, com uma paleta calculada da sequência inteira", () => {
    const plan = planFfmpegExport({
      format: "gif",
      fps: 30,
      framePattern: "D:/job/Cena_%04d.png",
      palettePath: "D:/job/palette.png",
      outputPath: "D:/job/Cena.gif",
    });
    expect(plan.passes).toHaveLength(2);
    expect(plan.passes[0]).toContain("palettegen=stats_mode=full");
    expect(plan.passes[1]).toContain("paletteuse=dither=sierra2_4a:diff_mode=rectangle");
    expect(plan.passes[1]?.at(-1)).toBe("D:/job/Cena.gif");
  });

  it("gera ProRes 4444 com plano alfa de 16 bits e metadata estável", () => {
    const plan = planFfmpegExport({
      format: "prores4444",
      fps: 59.94,
      framePattern: "D:/job/Cena_%04d.png",
      outputPath: "D:/job/Cena.mov",
    });
    expect(plan.passes).toHaveLength(1);
    expect(plan.passes[0]).toEqual(
      expect.arrayContaining([
        "prores_ks",
        "4",
        "yuva444p10le",
        "16",
        "creation_time=1970-01-01T00:00:00Z",
      ]),
    );
    expect(plan.passes[0]?.at(-1)).toBe("D:/job/Cena.mov");
  });

  it("recusa taxa impossível e GIF sem paleta", () => {
    expect(() =>
      planFfmpegExport({
        format: "prores4444",
        fps: 0,
        framePattern: "frames.png",
        outputPath: "out.mov",
      }),
    ).toThrow("taxa");
    expect(() =>
      planFfmpegExport({
        format: "gif",
        fps: 30,
        framePattern: "frames.png",
        outputPath: "out.gif",
      }),
    ).toThrow("paleta");
  });
});
