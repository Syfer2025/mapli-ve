import { describe, expect, it } from "vitest";
import { previewFrameRanges } from "./preview-cache-ranges.js";

describe("faixa de preview cacheado", () => {
  it("compacta frames contíguos e ignora entradas inválidas", () => {
    expect(previewFrameRanges([4, 2, 3, 8, 8, -1, 1.5])).toEqual([
      { startFrame: 2, endFrameExclusive: 5 },
      { startFrame: 8, endFrameExclusive: 9 },
    ]);
  });
});
