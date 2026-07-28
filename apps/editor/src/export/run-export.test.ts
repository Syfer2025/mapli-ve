/**
 * Provas do motor de export.
 *
 * O que importa aqui é a política de `settle`: um frame só é escrito depois de o
 * overlay parar de mudar. Capturar antes gravaria um frame pela metade, e *quanto*
 * pela metade dependeria da velocidade do disco — o que é a definição de
 * não-determinístico, e mata o critério byte-idêntico da Fase 8.
 *
 * Nada aqui toca DOM: o motor recebe `compose` pelo hospedeiro, e é justamente
 * essa injeção que torna a política provável sem GPU. A composição de verdade —
 * três canvases empilhados — é provada ao vivo em `tools/verify-phase8.mjs`.
 */

import { describe, expect, it, vi } from "vitest";
import { percentile, runExport, type ExportHost } from "./run-export.js";
import {
  EXCLUDED_SURFACE_SELECTORS,
  EXPORT_SURFACE_SELECTORS,
  exportSurfaceSelectors,
  selectExportSurfaces,
} from "./frame-composer.js";

const PLAN = { compositionId: "cmp", durationFrames: 5, compositionFps: 30 };
const FRAME = { width: 8, height: 4, rgba: new Uint8Array(8 * 4 * 4) };

/**
 * Hospedeiro falso que só fica quieto depois de `rendersPorFrame` repinturas —
 * o comportamento de um mapa carregando tiles.
 */
function host(overrides: Partial<ExportHost> & { rendersPorFrame?: number } = {}): {
  readonly host: ExportHost;
  readonly written: { filename: string; width: number; height: number }[];
  readonly capturedAtRenders: number[];
} {
  const written: { filename: string; width: number; height: number }[] = [];
  const capturedAtRenders: number[] = [];
  const rendersPorFrame = overrides.rendersPorFrame ?? 1;
  let current = -1;
  let renders = 0;
  let rendersNesteFrame = 0;

  const base: ExportHost = {
    seek: (frame) => {
      current = frame;
      rendersNesteFrame = 0;
    },
    observe: () => {
      // Cada observação "produz" uma repintura até completar a cota do frame.
      if (rendersNesteFrame < rendersPorFrame) {
        rendersNesteFrame += 1;
        renders += 1;
      }
      return { frame: current, renders };
    },
    mapBusy: () => false,
    assetsBusy: () => false,
    compose: () => FRAME,
    writeFrame: (filename, frame) => {
      written.push({ filename, width: frame.width, height: frame.height });
      capturedAtRenders.push(renders);
      return Promise.resolve({ ok: true, sha256: `sha-${filename}` });
    },
  };
  return { host: { ...base, ...overrides }, written, capturedAtRenders };
}

describe("runExport", () => {
  it("escreve um arquivo por frame do plano, na ordem", async () => {
    const h = host();
    const report = await runExport({ plan: PLAN, host: h.host });
    expect(report.written).toBe(5);
    expect(h.written.map((w) => w.filename)).toEqual([
      "frame_0000.png",
      "frame_0001.png",
      "frame_0002.png",
      "frame_0003.png",
      "frame_0004.png",
    ]);
    expect(report.hashes.map((entry) => entry.sha256)).toEqual(
      h.written.map((w) => `sha-${w.filename}`),
    );
    expect(report.settleFailed).toBe(0);
  });

  it("só captura depois de o overlay parar de repintar", async () => {
    // Três repinturas por frame: o export tem de esperar as três antes de
    // capturar, senão grava o frame pela metade.
    const h = host({ rendersPorFrame: 3 });
    await runExport({ plan: { ...PLAN, durationFrames: 2 }, host: h.host });
    // Frame 0 capturado depois de 3 repinturas; frame 1, depois de 6.
    expect(h.capturedAtRenders).toEqual([3, 6]);
  });

  it("mapa ocupado impede a captura mesmo com o contador estável", async () => {
    let chamadas = 0;
    const h = host({
      // Ocupado nas primeiras observações: um tile chegando sem ter causado
      // repintura ainda. Sem esta condição o export capturaria o mapa incompleto.
      mapBusy: () => {
        chamadas += 1;
        return chamadas < 8;
      },
    });
    const report = await runExport({ plan: { ...PLAN, durationFrames: 1 }, host: h.host });
    expect(report.written).toBe(1);
    expect(chamadas).toBeGreaterThanOrEqual(8);
  });

  it("asset grande pode ultrapassar 4 s sem liberar captura nem falhar o settle", async () => {
    // O pump mede com `performance.now()` e dorme com `setTimeout`: os dois
    // relógios precisam avançar juntos, senão o teste fica eternamente em 0 ms.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let assetPendente = true;
      const h = host({ assetsBusy: () => assetPendente });
      const exportando = runExport({
        plan: { ...PLAN, durationFrames: 1 },
        host: h.host,
      });

      await vi.advanceTimersByTimeAsync(4_500);
      expect(h.written).toHaveLength(0);

      assetPendente = false;
      await vi.advanceTimersByTimeAsync(100);
      const report = await exportando;
      expect(report.written).toBe(1);
      expect(report.settleFailed).toBe(0);
      expect(report.settleP99Ms).toBeGreaterThan(4_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("conta settleFailed quando a quietude não chega, sem abortar o job", async () => {
    // Nunca para de repintar: o teto de settle é atingido no frame.
    const h = host({
      observe: (() => {
        let n = 0;
        return () => {
          n += 1;
          return { frame: 0, renders: n };
        };
      })(),
    });
    const report = await runExport({ plan: { ...PLAN, durationFrames: 1 }, host: h.host });
    expect(report.settleFailed).toBe(1);
    // Escreveu de qualquer jeito: relatar é melhor que perder o job inteiro, e o
    // relatório é que diz ao usuário para não confiar naquele frame.
    expect(report.written).toBe(1);
    expect(report.settleP99Ms).toBeGreaterThan(0);
  }, 20_000);

  it("interrompe quando pedido, e diz que interrompeu", async () => {
    const h = host();
    let vistos = 0;
    const report = await runExport({
      plan: PLAN,
      host: h.host,
      shouldAbort: () => {
        vistos += 1;
        return vistos > 2;
      },
    });
    expect(report.aborted).toBe(true);
    expect(report.written).toBe(2);
  });

  it("falha de escrita entra no relatório e não derruba o resto", async () => {
    let n = 0;
    const h = host({
      writeFrame: (filename) => {
        n += 1;
        return Promise.resolve(
          n === 2
            ? { ok: false, sha256: "", message: "disco cheio" }
            : { ok: true, sha256: `sha-${filename}` },
        );
      },
    });
    const report = await runExport({ plan: { ...PLAN, durationFrames: 3 }, host: h.host });
    expect(report.written).toBe(2);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("disco cheio");
  });

  it("sem superfície para compor, registra erro em vez de escrever nada", async () => {
    const h = host({ compose: () => null });
    const report = await runExport({ plan: { ...PLAN, durationFrames: 2 }, host: h.host });
    expect(report.written).toBe(0);
    expect(report.errors).toHaveLength(2);
  });

  it("o relatório traz o plano, para o consumidor não ter de recalculá-lo", async () => {
    const report = await runExport({ plan: { ...PLAN, outputFps: 15 }, host: host().host });
    expect(report.plan.outputFps).toBe(15);
    expect(report.plan.frames).toHaveLength(3);
  });
});

describe("selectExportSurfaces", () => {
  it("recusa canvas de 300×150 — o tamanho de um canvas nunca dimensionado", () => {
    // O palco fora do modo estúdio tem exatamente isto. Compô-lo esticaria
    // 300 px sobre o frame inteiro.
    const escolhidas = selectExportSurfaces([
      { width: 1920, height: 1080, nome: "mapa" },
      { width: 300, height: 150, nome: "palco ocioso" },
      { width: 1920, height: 1080, nome: "overlay" },
    ]);
    expect(escolhidas.map((s) => s.nome)).toEqual(["mapa", "overlay"]);
  });

  it("recusa superfície ausente e de tamanho degenerado", () => {
    expect(selectExportSurfaces([null, undefined, { width: 1, height: 1 }])).toEqual([]);
    expect(selectExportSurfaces([{ width: 0, height: 900 }])).toEqual([]);
  });

  it("preserva a ordem — ela é a ordem de empilhamento", () => {
    const ordem = selectExportSurfaces([
      { width: 10, height: 10, z: 0 },
      { width: 10, height: 10, z: 1 },
      { width: 10, height: 10, z: 2 },
    ]);
    expect(ordem.map((s) => s.z)).toEqual([0, 1, 2]);
  });

  it("a lista de superfícies é mapa, palco, overlay — nessa ordem", () => {
    expect(EXPORT_SURFACE_SELECTORS).toEqual([
      ".maplibregl-canvas",
      ".scene-overlay__studio",
      ".scene-overlay__pixi",
    ]);
  });

  it("o matte exclui somente o mapa e preserva palco + overlay", () => {
    expect(exportSurfaceSelectors(false)).toEqual([
      ".scene-overlay__studio",
      ".scene-overlay__pixi",
    ]);
    expect(exportSurfaceSelectors(true)).toBe(EXPORT_SURFACE_SELECTORS);
  });

  it("gizmos e timeline nunca entram — é o critério 8 da Fase 8", () => {
    // Nenhum elemento de UI em nenhum frame. Aqui isso é estrutural: o canvas
    // de gizmos não está na lista de composição, e este teste falha se alguém
    // o acrescentar por engano.
    for (const excluido of EXCLUDED_SURFACE_SELECTORS) {
      expect(EXPORT_SURFACE_SELECTORS).not.toContain(excluido);
    }
    expect(EXCLUDED_SURFACE_SELECTORS).toContain(".scene-overlay__ui");
  });
});

describe("percentile", () => {
  it("devolve zero para lista vazia em vez de NaN", () => {
    expect(percentile([], 0.99)).toBe(0);
  });

  it("pega o elemento na posição, sem interpolar", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.99)).toBe(5);
    expect(percentile([7], 0.99)).toBe(7);
  });
});
