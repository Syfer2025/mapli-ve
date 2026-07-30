/**
 * A conta da moldura, que é a parte que mente com confiança quando erra.
 *
 * Uma guia no lugar errado é pior que guia nenhuma: ela afirma um enquadramento
 * que o arquivo não vai ter, e o erro só aparece no vídeo entregue.
 */

import { describe, expect, it } from "vitest";
import { compositionFrameRect } from "./composition-frame.js";

const COMPOSICAO = { width: 1920, height: 1080 };

describe("compositionFrameRect", () => {
  it("painel mais largo que a composição sobra à direita", () => {
    // O caso real desta máquina: painel 2032×800, composição 1920×1080.
    const frame = compositionFrameRect(COMPOSICAO, [2032, 800]);
    expect(frame).not.toBeNull();
    // A altura manda, porque é o eixo mais apertado.
    expect(frame?.height).toBeCloseTo(800, 6);
    expect(frame?.width).toBeCloseTo((1920 * 800) / 1080, 6);
    expect(frame?.fills).toBe(false);
  });

  it("painel mais alto que a composição sobra embaixo", () => {
    const frame = compositionFrameRect(COMPOSICAO, [960, 1080]);
    expect(frame?.width).toBeCloseTo(960, 6);
    expect(frame?.height).toBeCloseTo((1080 * 960) / 1920, 6);
    expect(frame?.fills).toBe(false);
  });

  it("durante o export a moldura cobre o painel e não há o que avisar", () => {
    // As superfícies foram conduzidas ao tamanho da composição (ADR-022): preview
    // e arquivo coincidem, então desenhar a guia só sujaria a imagem.
    expect(compositionFrameRect(COMPOSICAO, [1920, 1080])?.fills).toBe(true);
    // E na escala 2 o painel continua em pixels de CSS, então também cobre.
    expect(compositionFrameRect(COMPOSICAO, [1920, 1080])?.width).toBeCloseTo(1920, 6);
  });

  it("resíduo de ponto flutuante não faz a moldura aparecer no export", () => {
    // `min` deixa um eixo exato e o outro sujeito a arredondamento; sem a
    // tolerância de meio pixel a guia piscaria durante exports legítimos.
    const frame = compositionFrameRect({ width: 1001, height: 563 }, [1001, 563]);
    expect(frame?.fills).toBe(true);
  });

  it("a origem é (0,0), igual à do compToScreen do layout", () => {
    // Centralizar a guia sem centralizar o render desenharia a moldura ao lado do
    // conteúdo que ela deveria cercar.
    const frame = compositionFrameRect(COMPOSICAO, [2032, 800]);
    expect(frame?.x).toBe(0);
    expect(frame?.y).toBe(0);
  });

  it("tamanho degenerado devolve nulo em vez de retângulo inválido", () => {
    expect(compositionFrameRect(COMPOSICAO, [0, 800])).toBeNull();
    expect(compositionFrameRect(COMPOSICAO, [2032, 0])).toBeNull();
    expect(compositionFrameRect({ width: 0, height: 1080 }, [2032, 800])).toBeNull();
  });
});
