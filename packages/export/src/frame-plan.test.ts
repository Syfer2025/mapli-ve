/**
 * Provas do plano de export. O critério byte-idêntico começa aqui: duas
 * execuções têm de percorrer a mesma lista, na mesma ordem, com os mesmos nomes.
 */

import { describe, expect, it } from "vitest";
import { ExportPlanError, counterDigits, planExport, sanitizeBasename } from "./frame-plan.js";

const BASE = { compositionId: "cmp", durationFrames: 300, compositionFps: 30 };

describe("planExport", () => {
  it("exporta a composição inteira quando não há trecho", () => {
    const plan = planExport(BASE);
    expect(plan.frames).toHaveLength(300);
    expect(plan.frames[0]?.frame).toBe(0);
    expect(plan.frames[299]?.frame).toBe(299);
    expect(plan.durationSeconds).toBe(10);
  });

  it("o trecho é inclusivo nas duas pontas", () => {
    const plan = planExport({ ...BASE, range: { first: 10, last: 12 } });
    expect(plan.frames.map((f) => f.frame)).toEqual([10, 11, 12]);
  });

  it("um trecho de um frame só produz um frame, não zero", () => {
    const plan = planExport({ ...BASE, range: { first: 42, last: 42 } });
    expect(plan.frames.map((f) => f.frame)).toEqual([42]);
  });

  it("grampeia trecho fora da composição em vez de estourar", () => {
    const plan = planExport({ ...BASE, range: { first: -50, last: 9999 } });
    expect(plan.frames[0]?.frame).toBe(0);
    expect(plan.frames[plan.frames.length - 1]?.frame).toBe(299);
  });

  it("trecho invertido não devolve lista vazia", () => {
    const plan = planExport({ ...BASE, range: { first: 200, last: 100 } });
    expect(plan.frames.length).toBeGreaterThan(0);
    expect(plan.frames[0]?.frame).toBe(200);
  });

  it("é determinístico: duas chamadas com a mesma entrada dão o mesmo plano", () => {
    const a = planExport({ ...BASE, outputFps: 24, basename: "kursk" });
    const b = planExport({ ...BASE, outputFps: 24, basename: "kursk" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  describe("taxa de saída diferente da composição", () => {
    it("reduzir a taxa reduz a contagem e mantém a duração", () => {
      const plan = planExport({ ...BASE, outputFps: 15 });
      expect(plan.frames).toHaveLength(150);
      expect(plan.durationSeconds).toBe(10);
    });

    it("aumentar a taxa repete frames sem inventar frações", () => {
      const plan = planExport({ ...BASE, outputFps: 60 });
      expect(plan.frames).toHaveLength(599);
      // Todo frame avaliado é inteiro: o avaliador é indexado por frame, e um
      // valor fracionário interpolaria duas vezes.
      for (const frame of plan.frames) expect(Number.isInteger(frame.frame)).toBe(true);
      expect(plan.frames.slice(0, 4).map((f) => f.frame)).toEqual([0, 1, 1, 2]);
    });

    it("nunca passa do fim do trecho, mesmo com passo fracionário", () => {
      for (const outputFps of [7, 11, 24, 47, 60, 120]) {
        const plan = planExport({ ...BASE, outputFps, range: { first: 5, last: 97 } });
        for (const frame of plan.frames) {
          expect(frame.frame).toBeGreaterThanOrEqual(5);
          expect(frame.frame).toBeLessThanOrEqual(97);
        }
      }
    });

    it("não acumula erro: o índice grande cai onde a multiplicação manda", () => {
      // Passo 1/3 somado 3000 vezes desvia; multiplicado, não. Com 90 fps sobre
      // uma composição de 30, o frame de saída 2999 tem de ser round(2999/3).
      const plan = planExport({
        ...BASE,
        durationFrames: 3000,
        outputFps: 90,
      });
      const ultimo = plan.frames[2999];
      expect(ultimo?.frame).toBe(Math.round(2999 / 3));
    });

    it("o índice de saída é sempre sequencial e sem furos", () => {
      const plan = planExport({ ...BASE, outputFps: 23.976 });
      plan.frames.forEach((frame, position) => expect(frame.index).toBe(position));
    });
  });

  describe("nomes de arquivo", () => {
    it("zero-padded pelo total, para ordenar alfabeticamente", () => {
      // `frame_9` antes de `frame_10` é como um glob monta o vídeo fora de ordem.
      const plan = planExport({ ...BASE, durationFrames: 12 });
      expect(plan.frames[0]?.filename).toBe("frame_0000.png");
      expect(plan.frames[11]?.filename).toBe("frame_0011.png");
    });

    it("ganha dígitos quando o total exige", () => {
      const plan = planExport({ ...BASE, durationFrames: 12345 });
      expect(plan.frames[0]?.filename).toBe("frame_00000.png");
    });

    it("usa o prefixo pedido", () => {
      const plan = planExport({ ...BASE, basename: "kursk-julho" });
      expect(plan.frames[0]?.filename).toBe("kursk-julho_0000.png");
    });

    it("todos os nomes são distintos", () => {
      const plan = planExport({ ...BASE, outputFps: 60 });
      expect(new Set(plan.frames.map((f) => f.filename)).size).toBe(plan.frames.length);
    });
  });

  describe("entrada inválida", () => {
    it("recusa taxa e duração impossíveis em vez de produzir plano torto", () => {
      expect(() => planExport({ ...BASE, compositionFps: 0 })).toThrow(ExportPlanError);
      expect(() => planExport({ ...BASE, outputFps: -30 })).toThrow(ExportPlanError);
      expect(() => planExport({ ...BASE, durationFrames: 0 })).toThrow(ExportPlanError);
      expect(() => planExport({ ...BASE, durationFrames: 10.5 })).toThrow(ExportPlanError);
      expect(() => planExport({ ...BASE, compositionFps: Number.NaN })).toThrow(ExportPlanError);
    });
  });
});

describe("counterDigits", () => {
  it("nunca desce de quatro", () => {
    expect(counterDigits(1)).toBe(4);
    expect(counterDigits(999)).toBe(4);
  });

  it("cresce com o total", () => {
    expect(counterDigits(10_000)).toBe(5);
    expect(counterDigits(1_000_000)).toBe(7);
  });
});

describe("sanitizeBasename", () => {
  it("tira separador de caminho — o nome vira caminho no disco", () => {
    expect(sanitizeBasename("Kursk/Julho")).toBe("Kursk-Julho");
    expect(sanitizeBasename("C:\\saida")).toBe("C-saida");
  });

  it("preserva letras acentuadas de forma estável", () => {
    // Estável importa mais que bonito: o nome entra no arquivo, e duas
    // normalizações diferentes dariam nomes diferentes entre execuções.
    expect(sanitizeBasename("ofensiva")).toBe("ofensiva");
    expect(sanitizeBasename("ofensiva-2")).toBe("ofensiva-2");
  });

  it("cai no padrão quando não sobra nada", () => {
    expect(sanitizeBasename("///")).toBe("frame");
    expect(sanitizeBasename("")).toBe("frame");
    expect(sanitizeBasename("...")).toBe("frame");
  });

  it("limita o tamanho", () => {
    expect(sanitizeBasename("a".repeat(200))).toHaveLength(64);
  });
});
