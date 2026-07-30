import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_DIMENSION,
  EXPORT_SCALES,
  EXPORT_SUPERSAMPLING_FACTORS,
  ExportResolutionError,
  describeExportResolution,
  planExportResolution,
} from "./resolution.js";

const HD = { compositionWidth: 1920, compositionHeight: 1080 };

describe("planExportResolution", () => {
  it("na escala 1 o frame é a composição, e o layout também", () => {
    const plan = planExportResolution(HD);
    expect(plan.output).toEqual([1920, 1080]);
    expect(plan.layout).toEqual([1920, 1080]);
    expect(plan.scale).toBe(1);
    expect(plan.supersampling).toBe(1);
    expect(plan.renderPixelRatio).toBe(1);
    expect(plan.render).toEqual([1920, 1080]);
    expect(plan.adjustedFor).toEqual(["none"]);
  });

  it("não depende do tamanho da janela — é o ponto do ADR-022", () => {
    // A conta não recebe janela nenhuma. Este teste existe para travar isso:
    // acrescentar um parâmetro de viewport aqui é reabrir o buraco.
    const plan = planExportResolution(HD);
    expect(plan.output).toEqual([1920, 1080]);
    expect(Object.keys(plan).sort()).toEqual([
      "adjustedFor",
      "layout",
      "output",
      "render",
      "renderPixelRatio",
      "scale",
      "supersampling",
    ]);
  });

  it("o layout fica no tamanho da composição em qualquer escala, e a escala vira pixelRatio", () => {
    // É o que faz `compToScreen` ser exatamente a escala: um nó autorado a 100 px
    // sai a 200 px no dobro, em vez de continuar a 100 px num frame maior.
    const dobro = planExportResolution({ ...HD, scale: 2 });
    expect(dobro.layout).toEqual([1920, 1080]);
    expect(dobro.scale).toBe(2);
    expect(dobro.renderPixelRatio).toBe(2);
    expect(dobro.render).toEqual([3840, 2160]);
    expect(dobro.output).toEqual([3840, 2160]);
  });

  it("supersampling amplia apenas o render e mantém a resolução final", () => {
    const plan = planExportResolution({ ...HD, supersampling: 2 });
    expect(plan.layout).toEqual([1920, 1080]);
    expect(plan.scale).toBe(1);
    expect(plan.supersampling).toBe(2);
    expect(plan.renderPixelRatio).toBe(2);
    expect(plan.render).toEqual([3840, 2160]);
    expect(plan.output).toEqual([1920, 1080]);
  });

  it("não confunde escala de saída com fator de amostragem", () => {
    const escala = planExportResolution({ ...HD, scale: 2 });
    const amostragem = planExportResolution({ ...HD, supersampling: 2 });
    expect(escala.render).toEqual(amostragem.render);
    expect(escala.output).toEqual([3840, 2160]);
    expect(amostragem.output).toEqual([1920, 1080]);
    expect(escala.renderPixelRatio).toBe(amostragem.renderPixelRatio);
  });

  it("meia resolução preserva a proporção da composição", () => {
    const meia = planExportResolution({ ...HD, scale: 0.5 });
    expect(meia.output).toEqual([960, 540]);
    expect(meia.output[0] / meia.output[1]).toBeCloseTo(1920 / 1080, 12);
  });

  it("a saída é par nos dois eixos, e diz quando cortou", () => {
    // 1227×643 é o tamanho de janela que o docstring do video-encoder registra:
    // os dois eixos ímpares. Como composição, ele tem de sair par e declarado.
    const plan = planExportResolution({ compositionWidth: 1227, compositionHeight: 643 });
    expect(plan.output).toEqual([1226, 642]);
    expect(plan.adjustedFor).toEqual(["even"]);
    // E o layout NÃO é cortado: as superfícies vão ao tamanho autorado, e o corte
    // de um pixel acontece na saída. Cortar o layout mudaria o enquadramento.
    expect(plan.layout).toEqual([1227, 643]);
  });

  it("escala fracionária que cai em ímpar também sai par", () => {
    const plan = planExportResolution({ ...HD, scale: 0.35 });
    expect(plan.output).toEqual([672, 378]);
    expect(plan.output.every((side) => side % 2 === 0)).toBe(true);
  });

  it("recusa acima do teto em vez de cortar em silêncio", () => {
    // O MapLibre corta: pedir 7680×4320 devolveu 4096×2304 sem erro. Um export
    // de 8K que sai 4K sem avisar é pior que um export que não começa.
    expect(() => planExportResolution({ ...HD, scale: 4 })).toThrow(ExportResolutionError);
    expect(() => planExportResolution({ ...HD, scale: 4 })).toThrow(/maxCanvasSize/);
  });

  it("aplica o teto ao render ampliado, não só ao arquivo final", () => {
    expect(planExportResolution({ ...HD, supersampling: 2 }).render).toEqual([3840, 2160]);
    expect(() => planExportResolution({ ...HD, scale: 2, supersampling: 2 })).toThrow(
      /7680×4320 de render/,
    );
    expect(
      planExportResolution({
        compositionWidth: 2048,
        compositionHeight: 2048,
        supersampling: 2,
      }).render,
    ).toEqual([4096, 4096]);
    expect(() =>
      planExportResolution({
        compositionWidth: 2050,
        compositionHeight: 2050,
        supersampling: 2,
      }),
    ).toThrow(ExportResolutionError);
  });

  it("4K passa no teto padrão, e é a fronteira", () => {
    const quatroK = planExportResolution({ compositionWidth: 3840, compositionHeight: 2160 });
    expect(quatroK.output).toEqual([3840, 2160]);
    expect(DEFAULT_MAX_DIMENSION).toBe(4096);
    expect(() => planExportResolution({ compositionWidth: 4098, compositionHeight: 2160 })).toThrow(
      ExportResolutionError,
    );
  });

  it("aceita teto explícito acima do padrão, para quando a construção do mapa subir", () => {
    const oitoK = planExportResolution({ ...HD, scale: 4, maxDimension: 16384 });
    expect(oitoK.output).toEqual([7680, 4320]);
  });

  it("recusa entrada que não é resolução", () => {
    expect(() => planExportResolution({ compositionWidth: 0, compositionHeight: 1080 })).toThrow(
      ExportResolutionError,
    );
    expect(() =>
      planExportResolution({ compositionWidth: 1920.5, compositionHeight: 1080 }),
    ).toThrow(ExportResolutionError);
    expect(() => planExportResolution({ ...HD, scale: 0 })).toThrow(ExportResolutionError);
    expect(() => planExportResolution({ ...HD, scale: Number.NaN })).toThrow(ExportResolutionError);
    expect(() => planExportResolution({ ...HD, supersampling: 0 })).toThrow(ExportResolutionError);
    expect(() => planExportResolution({ ...HD, supersampling: 1.5 })).toThrow(/inteiro positivo/);
    expect(() => planExportResolution({ ...HD, supersampling: Number.NaN })).toThrow(
      ExportResolutionError,
    );
    // Escala que reduziria a menos de 2 px por eixo: par arredondaria a zero, e um
    // frame de zero pixel passaria adiante como se fosse válido.
    expect(() => planExportResolution({ ...HD, scale: 0.0005 })).toThrow(/mínimo de 2 px/);
  });

  it("recusa box incompatível em vez de delegar a redução ao navegador", () => {
    expect(() =>
      planExportResolution({
        compositionWidth: 1227,
        compositionHeight: 643,
        scale: 0.5,
        supersampling: 2,
      }),
    ).toThrow(/blocos inteiros/);

    // Sem escala fracionária o backing ampliado é divisível. O box produz a
    // dimensão autorada ímpar e o corte par declarado acontece depois.
    const compatível = planExportResolution({
      compositionWidth: 1227,
      compositionHeight: 643,
      supersampling: 2,
    });
    expect(compatível.render).toEqual([2454, 1286]);
    expect(compatível.output).toEqual([1226, 642]);
    expect(compatível.adjustedFor).toEqual(["even"]);
  });

  it("é pura: a mesma entrada devolve o mesmo plano, e o plano é congelado", () => {
    const a = planExportResolution({ ...HD, scale: 2 });
    const b = planExportResolution({ ...HD, scale: 2 });
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.output)).toBe(true);
  });

  it("todas as escalas oferecidas na interface produzem plano válido para HD", () => {
    for (const scale of EXPORT_SCALES) {
      const plan = planExportResolution({ ...HD, scale });
      expect(plan.output.every((side) => side >= 2 && side % 2 === 0)).toBe(true);
    }
  });

  it("todos os fatores oferecidos na interface produzem plano válido para HD", () => {
    for (const supersampling of EXPORT_SUPERSAMPLING_FACTORS) {
      const plan = planExportResolution({ ...HD, supersampling });
      expect(plan.render[0]).toBe(plan.output[0] * supersampling);
      expect(plan.render[1]).toBe(plan.output[1] * supersampling);
    }
  });
});

describe("describeExportResolution", () => {
  it("mostra a resolução de saída, que é a mitigação declarada do ADR-022", () => {
    expect(describeExportResolution(planExportResolution(HD))).toBe("1920×1080");
    expect(describeExportResolution(planExportResolution({ ...HD, scale: 2 }))).toBe(
      "3840×2160 · 2×",
    );
    expect(describeExportResolution(planExportResolution({ ...HD, supersampling: 2 }))).toBe(
      "1920×1080 · SS 2× (render 3840×2160)",
    );
  });

  it("diz em voz alta quando a paridade do H.264 cortou um pixel", () => {
    const plan = planExportResolution({ compositionWidth: 1227, compositionHeight: 643 });
    expect(describeExportResolution(plan)).toBe("1226×642 (par para H.264)");
  });
});
