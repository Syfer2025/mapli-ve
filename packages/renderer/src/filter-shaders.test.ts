/**
 * Shader não roda em Node, mas as regras que fazem um shader **falhar ao ligar**
 * são textuais e dão para cobrar aqui. Este arquivo existe por causa de um bug
 * real: o Pixi injeta `precision highp float` no vertex e `mediump` no fragment
 * quando o código não declara nada, e como os dois estágios declaram `uInputSize`,
 * o programa não ligava — o filtro simplesmente não pintava, sem erro visível.
 */

import { describe, expect, it } from "vitest";
import {
  CHROMATIC_FRAGMENT_SHADER,
  FILTER_VERTEX_SHADER,
  GLOW_FRAGMENT_SHADER,
  hexToRgbTriple,
  OUTLINE_FRAGMENT_SHADER,
  SHADOW_FRAGMENT_SHADER,
} from "./filter-shaders.js";

const FRAGMENTS = Object.freeze({
  glow: GLOW_FRAGMENT_SHADER,
  shadow: SHADOW_FRAGMENT_SHADER,
  outline: OUTLINE_FRAGMENT_SHADER,
  chromatic: CHROMATIC_FRAGMENT_SHADER,
});

describe("shaders de filtro", () => {
  it("todo estágio abre declarando precisão alta, na primeira linha", () => {
    for (const [name, source] of Object.entries({ vertex: FILTER_VERTEX_SHADER, ...FRAGMENTS })) {
      // O pré-processador do Pixi testa os nove primeiros caracteres: nem um
      // newline pode vir antes, ou ele injeta a precisão dele por cima.
      expect(source.startsWith("precision highp float;"), name).toBe(true);
    }
  });

  it("uniform compartilhado entre estágios é declarado igual nos dois", () => {
    const declarations = (source: string): readonly string[] =>
      [...source.matchAll(/uniform\s+(\w+)\s+(\w+)\s*;/g)].map((match) => `${match[1]} ${match[2]}`);

    const vertex = new Map(
      declarations(FILTER_VERTEX_SHADER).map((entry) => [entry.split(" ")[1], entry]),
    );
    for (const [name, source] of Object.entries(FRAGMENTS)) {
      for (const entry of declarations(source)) {
        const uniform = entry.split(" ")[1];
        const inVertex = vertex.get(uniform);
        if (inVertex === undefined) continue;
        expect(entry, `${name}: ${uniform}`).toBe(inVertex);
      }
    }
  });

  it("cada fragmento escreve a saída e amostra a textura de entrada", () => {
    for (const [name, source] of Object.entries(FRAGMENTS)) {
      expect(source.includes("finalColor ="), name).toBe(true);
      expect(source.includes("texture(uTexture"), name).toBe(true);
    }
  });

  it("nenhum laço depende de uniform: o custo por pixel é fixo", () => {
    for (const [name, source] of Object.entries(FRAGMENTS)) {
      for (const loop of source.matchAll(/for\s*\(([^)]*)\)/g)) {
        // O limite precisa ser literal ou constante nomeada em maiúsculas.
        expect(loop[1], `${name}: ${loop[1]}`).toMatch(/<=?\s*(\d+|[A-Z_]+)\b/);
      }
    }
  });

  it("hexadecimal vira componentes em 0–1, tolerando alfa e ausência de #", () => {
    expect(hexToRgbTriple("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToRgbTriple("#000000ff")).toEqual([0, 0, 0]);
    const [r, g, b] = hexToRgbTriple("ff8000");
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(128 / 255, 6);
    expect(b).toBeCloseTo(0, 6);
  });
});
