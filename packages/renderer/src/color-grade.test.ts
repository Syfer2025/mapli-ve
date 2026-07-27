/**
 * A correção de cor é matriz, então dá para verificar sem GPU: aplica-se a matriz
 * a cores conhecidas e confere-se o resultado. É o teste que a Fase 6 pede para o
 * filtro que não tem shader próprio.
 */

import { describe, expect, it } from "vitest";
import {
  colorGradeMatrix,
  composeColorMatrices,
  isIdentityColorMatrix,
  IDENTITY_COLOR_MATRIX,
  type ColorMatrix,
} from "./color-grade.js";

/** Aplica a matriz a uma cor em 0–1, como o shader do Pixi faz por pixel. */
function apply(matrix: ColorMatrix, color: readonly [number, number, number, number]) {
  const out: number[] = [];
  for (let row = 0; row < 4; row += 1) {
    let sum = matrix[row * 5 + 4] ?? 0;
    for (let k = 0; k < 4; k += 1) sum += (matrix[row * 5 + k] ?? 0) * (color[k] ?? 0);
    out.push(sum);
  }
  return out as [number, number, number, number];
}

const GREY = [0.5, 0.5, 0.5, 1] as const;
const RED = [0.8, 0.2, 0.1, 1] as const;

describe("matriz de correção de cor", () => {
  it("parâmetros neutros não mexem em pixel nenhum", () => {
    const matrix = colorGradeMatrix({
      exposure: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
    });
    expect(isIdentityColorMatrix(matrix)).toBe(true);
    expect(apply(matrix, RED)).toEqual([...RED]);
  });

  it("uma parada de exposição dobra a luz, e a volta desfaz", () => {
    const up = apply(
      colorGradeMatrix({ exposure: 1, contrast: 0, saturation: 0, temperature: 0 }),
      GREY,
    );
    expect(up[0]).toBeCloseTo(1, 6);
    const down = apply(
      colorGradeMatrix({ exposure: -1, contrast: 0, saturation: 0, temperature: 0 }),
      GREY,
    );
    expect(down[0]).toBeCloseTo(0.25, 6);
    // Alfa nunca é tocado por exposição.
    expect(up[3]).toBeCloseTo(1, 6);
  });

  it("dessaturar por completo devolve a luminância nos três canais", () => {
    const matrix = colorGradeMatrix({
      exposure: 0,
      contrast: 0,
      saturation: -1,
      temperature: 0,
    });
    const [r, g, b] = apply(matrix, RED);
    const luma = 0.2126 * RED[0] + 0.7152 * RED[1] + 0.0722 * RED[2];
    expect(r).toBeCloseTo(luma, 6);
    expect(g).toBeCloseTo(luma, 6);
    expect(b).toBeCloseTo(luma, 6);
  });

  it("contraste gira em torno do cinza médio: 0,5 fica parado", () => {
    for (const contrast of [-0.8, -0.2, 0.5, 1]) {
      const value = apply(
        colorGradeMatrix({ exposure: 0, contrast, saturation: 0, temperature: 0 }),
        GREY,
      );
      expect(value[0]).toBeCloseTo(0.5, 6);
    }
    // Fora do pivô, o contraste positivo afasta.
    const bright = apply(
      colorGradeMatrix({ exposure: 0, contrast: 1, saturation: 0, temperature: 0 }),
      [0.7, 0.7, 0.7, 1],
    );
    expect(bright[0]).toBeCloseTo(0.9, 6);
  });

  it("temperatura desloca vermelho e azul em sentidos opostos, verde parado", () => {
    const warm = apply(
      colorGradeMatrix({ exposure: 0, contrast: 0, saturation: 0, temperature: 1 }),
      GREY,
    );
    expect(warm[0]).toBeGreaterThan(0.5);
    expect(warm[1]).toBeCloseTo(0.5, 6);
    expect(warm[2]).toBeLessThan(0.5);

    const cool = apply(
      colorGradeMatrix({ exposure: 0, contrast: 0, saturation: 0, temperature: -1 }),
      GREY,
    );
    expect(cool[0]).toBeCloseTo(1 - warm[0], 6);
    expect(cool[2]).toBeCloseTo(1 - warm[2], 6);
  });

  it("compor duas matrizes é o mesmo que aplicar as duas em ordem", () => {
    const first = colorGradeMatrix({ exposure: 0.5, contrast: 0, saturation: 0, temperature: 0.4 });
    const second = colorGradeMatrix({
      exposure: 0,
      contrast: 0.3,
      saturation: 0.6,
      temperature: 0,
    });
    const composed = composeColorMatrices(second, first);
    const sequential = apply(second, apply(first, RED));
    apply(composed, RED).forEach((value, index) => {
      expect(value).toBeCloseTo(sequential[index] ?? 0, 9);
    });
  });

  it("identidade composta com qualquer matriz devolve a matriz", () => {
    const matrix = colorGradeMatrix({
      exposure: -0.7,
      contrast: 0.2,
      saturation: 0.9,
      temperature: -0.3,
    });
    const left = composeColorMatrices(IDENTITY_COLOR_MATRIX, matrix);
    const right = composeColorMatrices(matrix, IDENTITY_COLOR_MATRIX);
    for (let index = 0; index < 20; index += 1) {
      expect(left[index]).toBeCloseTo(matrix[index] ?? 0, 9);
      expect(right[index]).toBeCloseTo(matrix[index] ?? 0, 9);
    }
  });

  it("mesma entrada dá exatamente a mesma matriz — nada de estado escondido", () => {
    const params = { exposure: 0.3, contrast: -0.4, saturation: 0.5, temperature: 0.2 };
    expect([...colorGradeMatrix(params)]).toEqual([...colorGradeMatrix(params)]);
  });
});
