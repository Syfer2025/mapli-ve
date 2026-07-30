import { describe, expect, it } from "vitest";
import { SupersamplingError, downsampleRgbaBox } from "./supersampling.js";

function rgba(...pixels: readonly (readonly [number, number, number, number])[]): Uint8Array {
  return new Uint8Array(pixels.flat());
}

describe("downsampleRgbaBox", () => {
  it("fator 1 preserva cada byte e não altera a origem", () => {
    const source = rgba([1, 2, 3, 0], [250, 249, 248, 247]);
    const before = source.slice();
    const result = downsampleRgbaBox({ rgba: source, width: 2, height: 1, factor: 1 });
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(source).toEqual(before);
  });

  it("faz média box opaca com arredondamento half-up", () => {
    const source = rgba([0, 10, 20, 255], [10, 20, 30, 255], [20, 30, 40, 255], [31, 41, 51, 255]);
    expect(downsampleRgbaBox({ rgba: source, width: 2, height: 2, factor: 2 })).toEqual(
      rgba([15, 25, 35, 255]),
    );
  });

  it("calcula blocos e stride independentemente em uma grade 4×4", () => {
    const pixels: [number, number, number, number][] = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) pixels.push([x + y * 10, 0, 0, 255]);
    }
    expect(downsampleRgbaBox({ rgba: rgba(...pixels), width: 4, height: 4, factor: 2 })).toEqual(
      rgba([6, 0, 0, 255], [8, 0, 0, 255], [26, 0, 0, 255], [28, 0, 0, 255]),
    );
  });

  it("promedia cobertura em alfa premultiplicado sem escurecer a cor", () => {
    const source = rgba([255, 0, 0, 255], [0, 0, 0, 0], [17, 99, 201, 0], [0, 0, 0, 0]);
    expect(downsampleRgbaBox({ rgba: source, width: 2, height: 2, factor: 2 })).toEqual(
      rgba([255, 0, 0, 64]),
    );
  });

  it("normaliza RGB invisível quando o bloco é totalmente transparente", () => {
    const source = rgba([255, 1, 2, 0], [3, 254, 4, 0], [5, 6, 253, 0], [252, 251, 250, 0]);
    expect(downsampleRgbaBox({ rgba: source, width: 2, height: 2, factor: 2 })).toEqual(
      rgba([0, 0, 0, 0]),
    );
  });

  it("recorta a paridade depois do box, sem misturar a borda descartada", () => {
    const source = rgba(
      [10, 0, 0, 255],
      [10, 0, 0, 255],
      [250, 0, 0, 255],
      [250, 0, 0, 255],
      [20, 0, 0, 255],
      [20, 0, 0, 255],
      [240, 0, 0, 255],
      [240, 0, 0, 255],
    );
    expect(
      downsampleRgbaBox({
        rgba: source,
        width: 4,
        height: 2,
        factor: 2,
        outputWidth: 1,
        outputHeight: 1,
      }),
    ).toEqual(rgba([15, 0, 0, 255]));
  });

  it("reaproveita o destino e sobrescreve resíduos da chamada anterior", () => {
    const destination = new Uint8Array([255, 255, 255, 255]);
    const result = downsampleRgbaBox(
      {
        rgba: rgba([8, 16, 24, 255], [8, 16, 24, 255], [8, 16, 24, 255], [8, 16, 24, 255]),
        width: 2,
        height: 2,
        factor: 2,
      },
      destination,
    );
    expect(result).toBe(destination);
    expect(result).toEqual(rgba([8, 16, 24, 255]));
  });

  it("recusa fator, grade, buffer e destino incompatíveis", () => {
    const source = new Uint8Array(16);
    expect(() => downsampleRgbaBox({ rgba: source, width: 2, height: 2, factor: 0 })).toThrow(
      SupersamplingError,
    );
    expect(() =>
      downsampleRgbaBox({ rgba: new Uint8Array(24), width: 3, height: 2, factor: 2 }),
    ).toThrow(/blocos inteiros/);
    expect(() =>
      downsampleRgbaBox({ rgba: new Uint8Array(15), width: 2, height: 2, factor: 2 }),
    ).toThrow(/RGBA incompatível/);
    expect(() =>
      downsampleRgbaBox({ rgba: source, width: 2, height: 2, factor: 2 }, new Uint8Array(8)),
    ).toThrow(/destino incompatível/);
  });
});
