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
  EXPORT_MODES,
  exportSurfaceSelectors,
  selectCompleteExportSurfaces,
  selectExportSurfaces,
  type ComposedFrame,
} from "./frame-composer.js";

const PLAN = { compositionId: "cmp", durationFrames: 5, compositionFps: 30 };
const FRAME = { width: 8, height: 4, rgba: new Uint8Array(8 * 4 * 4) };

function shaForFilename(filename: string): string {
  let value = 0;
  for (const character of filename) value = (value * 33 + character.charCodeAt(0)) >>> 0;
  return value.toString(16).padStart(64, "0");
}

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
    surfacesBusy: () => false,
    compose: () => FRAME,
    writeFrame: (filename, frame) => {
      written.push({ filename, width: frame.width, height: frame.height });
      capturedAtRenders.push(renders);
      return Promise.resolve({ ok: true, sha256: shaForFilename(filename) });
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
      h.written.map((w) => shaForFilename(w.filename)),
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

  it("superfície fora de medida impede a captura, como o mapa ocupado", async () => {
    // A regressão que este predicado fecha: o redimensionamento da RESTAURAÇÃO do
    // export anterior chega atrasado e cai no meio deste. Sem esperar, o
    // compositor escala uma superfície de 2360×800 dentro de um frame de
    // 1920×1080 — plausível, e diferente entre execuções. Fazia o critério 6 do
    // verify:phase8 oscilar entre 5/7 e 7/7 com o mesmo código.
    let chamadas = 0;
    const h = host({
      surfacesBusy: () => {
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

  it("a política continue captura o timeout, mas o marca como duvidoso", async () => {
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
    const report = await runExport({
      plan: { ...PLAN, durationFrames: 1 },
      host: h.host,
      settlePolicy: "continue",
    });
    expect(report.settleFailed).toBe(1);
    // Continuar é uma escolha explícita da bancada; o produto usa `fail`.
    expect(report.written).toBe(1);
    expect(report.settlePolicy).toBe("continue");
    expect(report.terminatedBySettle).toBe(false);
    expect(report.settleP99Ms).toBeGreaterThan(0);
  }, 20_000);

  it("mapBusy preso falha fechado por padrão e não escreve o frame contaminado", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const h = host({ mapBusy: () => true });
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 3 },
        host: h.host,
      });
      await vi.runAllTimersAsync();
      const report = await exporting;

      expect(report.settlePolicy).toBe("fail");
      expect(report.terminatedBySettle).toBe(true);
      expect(report.aborted).toBe(false);
      expect(report.settleFailed).toBe(1);
      expect(report.settleFailures[0]?.reason).toBe("map-busy");
      expect(report.written).toBe(0);
      expect(h.written).toEqual([]);
      expect(report.errors[0]).toContain("nenhum pixel desse frame foi escrito");
    } finally {
      vi.useRealTimers();
    }
  });

  it("conta saídas repetidas separadamente quando outputFps é maior", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let current = -1;
      let renders = 0;
      const failingHost: ExportHost = {
        seek: (frame) => {
          current = frame;
        },
        observe: () => ({ frame: current, renders: (renders += 1) }),
        mapBusy: () => false,
        assetsBusy: () => false,
        surfacesBusy: () => false,
        compose: () => FRAME,
        writeFrame: () => Promise.resolve({ ok: true, sha256: "timeout" }),
      };
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 2, outputFps: 60 },
        host: failingHost,
        settlePolicy: "continue",
      });
      await vi.runAllTimersAsync();
      const report = await exporting;

      expect(report.plan.frames.map((frame) => frame.frame)).toEqual([0, 1, 1]);
      expect(report.settleFailed).toBe(3);
      expect(report.settleFailedOutputFrames).toBe(3);
      expect(report.settleFailedFrames).toEqual([0, 1, 1]);
      expect(report.settleFailures.map((failure) => failure.outputIndex)).toEqual([0, 1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("interrompe quando pedido, e diz que interrompeu", async () => {
    const h = host();
    const report = await runExport({
      plan: PLAN,
      host: h.host,
      shouldAbort: () => h.written.length >= 2,
    });
    expect(report.aborted).toBe(true);
    expect(report.written).toBe(2);
  });

  it("retoma no índice confirmado, preserva nomes e grava checkpoints periódicos", async () => {
    const h = host();
    const resumedHashes = [
      { filename: "frame_0000.png", sha256: "0".repeat(64) },
      { filename: "frame_0001.png", sha256: "1".repeat(64) },
    ];
    const checkpoints: {
      completedFrames: number;
      totalFrames: number;
      lastFilename: string | null;
      complete: boolean;
      hashes: readonly { filename: string; sha256: string }[];
    }[] = [];
    const report = await runExport({
      plan: PLAN,
      host: h.host,
      resumeFromOutputIndex: 2,
      resumeFrameHashes: resumedHashes,
      checkpointEvery: 2,
      onCheckpoint: (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(report.reused).toBe(2);
    expect(report.written).toBe(3);
    expect(h.written.map(({ filename }) => filename)).toEqual([
      "frame_0002.png",
      "frame_0003.png",
      "frame_0004.png",
    ]);
    expect(checkpoints).toEqual([
      {
        completedFrames: 4,
        totalFrames: 5,
        lastFilename: "frame_0003.png",
        complete: false,
        hashes: [
          ...resumedHashes,
          { filename: "frame_0002.png", sha256: shaForFilename("frame_0002.png") },
          { filename: "frame_0003.png", sha256: shaForFilename("frame_0003.png") },
        ],
      },
      {
        completedFrames: 5,
        totalFrames: 5,
        lastFilename: "frame_0004.png",
        complete: true,
        hashes: [
          ...resumedHashes,
          { filename: "frame_0002.png", sha256: shaForFilename("frame_0002.png") },
          { filename: "frame_0003.png", sha256: shaForFilename("frame_0003.png") },
          { filename: "frame_0004.png", sha256: shaForFilename("frame_0004.png") },
        ],
      },
    ]);
  });

  it("recusa checkpoint fora do plano antes de tocar o host", async () => {
    const h = host();
    await expect(runExport({ plan: PLAN, host: h.host, resumeFromOutputIndex: 6 })).rejects.toThrow(
      "checkpoint inválido",
    );
    expect(h.written).toEqual([]);
  });

  it("para de forma segura se a persistência do checkpoint falhar", async () => {
    const h = host();
    const report = await runExport({
      plan: PLAN,
      host: h.host,
      checkpointEvery: 1,
      onCheckpoint: () => {
        throw new Error("disco de checkpoints indisponível");
      },
    });

    expect(report.written).toBe(1);
    expect(report.errors[0]).toContain("checkpoint 1/5 falhou");
    expect(h.written).toHaveLength(1);
  });

  it("falha de escrita interrompe imediatamente para não criar lacuna", async () => {
    let n = 0;
    const h = host({
      writeFrame: (filename) => {
        n += 1;
        return Promise.resolve(
          n === 2
            ? { ok: false, sha256: "", message: "disco cheio" }
            : { ok: true, sha256: shaForFilename(filename) },
        );
      },
    });
    const report = await runExport({ plan: { ...PLAN, durationFrames: 3 }, host: h.host });
    expect(report.written).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("disco cheio");
    expect(n).toBe(2);
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

  it("faz seek, settle e compose em cada subframe fracionário, mas escreve uma vez", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let current = -1;
      const seeks: number[] = [];
      const composedAt: number[] = [];
      const written: Uint8Array[] = [];
      const progress: { sample: number; samplesDone: number }[] = [];
      const motionHost: ExportHost = {
        seek: (frame) => {
          current = frame;
          seeks.push(frame);
        },
        observe: () => ({ frame: current, renders: seeks.length }),
        mapBusy: () => false,
        assetsBusy: () => false,
        surfacesBusy: () => false,
        compose: () => {
          composedAt.push(current);
          return {
            width: 1,
            height: 1,
            rgba: Uint8Array.from([Math.round(current * 100), 0, 0, 255]),
          };
        },
        writeFrame: (_filename, frame) => {
          written.push(frame.rgba.slice());
          return Promise.resolve({ ok: true, sha256: "motion" });
        },
      };
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 3, range: { first: 1, last: 1 } },
        host: motionHost,
        motionBlur: { shutterAngle: 180, samples: 4 },
        onProgress: (value) =>
          progress.push({ sample: value.currentSample, samplesDone: value.samplesDone }),
      });
      await vi.runAllTimersAsync();
      const report = await exporting;

      const samples = [0.8125, 0.9375, 1.0625, 1.1875];
      expect(seeks).toEqual([...samples, 1]);
      expect(composedAt).toEqual(samples);
      expect(written).toHaveLength(1);
      expect([...written[0]!]).toEqual([100, 0, 0, 255]);
      expect(report.written).toBe(1);
      expect(report.settleFailed).toBe(0);
      expect(report.motionBlur).toMatchObject({
        enabled: true,
        processedSamples: 4,
        settledSamples: 4,
        accumulatedSamples: 4,
        resolvedFrames: 1,
        accumulatorAllocations: 1,
        accumulatorBytes: 20,
        accumulatorFloatBytes: 16,
      });
      expect(report.motionBlur.sampleTrace.map((sample) => sample.requestedFrame)).toEqual(samples);
      expect(report.motionBlur.sampleTrace.map((sample) => sample.observedFrame)).toEqual(samples);
      expect(progress.map((entry) => entry.sample)).toEqual([1, 2, 3, 4, 4]);
      expect(progress.at(-1)?.samplesDone).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ângulo zero e uma amostra preservam o objeto composto e não alocam", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      for (const motionBlur of [
        { shutterAngle: 0, samples: 8 },
        { shutterAngle: 180, samples: 1 },
      ]) {
        let writtenFrame: ComposedFrame | null = null;
        const h = host({
          writeFrame: (_filename, frame) => {
            writtenFrame = frame;
            return Promise.resolve({ ok: true, sha256: "identity" });
          },
        });
        const exporting = runExport({
          plan: { ...PLAN, durationFrames: 1 },
          host: h.host,
          motionBlur,
        });
        await vi.runAllTimersAsync();
        const report = await exporting;
        expect(writtenFrame).toBe(FRAME);
        expect(report.motionBlur.enabled).toBe(false);
        expect(report.motionBlur.accumulatorAllocations).toBe(0);
        expect(report.motionBlur.accumulatedSamples).toBe(0);
        expect(report.motionBlur.resolvedFrames).toBe(0);
        expect(report.motionBlur.sampleTrace).toEqual([]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelamento no meio descarta a acumulação parcial e restaura o centro", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let current = -1;
      let abort = false;
      const seeks: number[] = [];
      let writes = 0;
      const motionHost: ExportHost = {
        seek: (frame) => {
          current = frame;
          seeks.push(frame);
        },
        observe: () => ({ frame: current, renders: seeks.length }),
        mapBusy: () => false,
        assetsBusy: () => false,
        surfacesBusy: () => false,
        compose: () => {
          abort = true;
          return { width: 1, height: 1, rgba: Uint8Array.from([1, 2, 3, 255]) };
        },
        writeFrame: () => {
          writes += 1;
          return Promise.resolve({ ok: true, sha256: "não deveria escrever" });
        },
      };
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 3, range: { first: 1, last: 1 } },
        host: motionHost,
        motionBlur: { shutterAngle: 180, samples: 4 },
        shouldAbort: () => abort,
      });
      await vi.runAllTimersAsync();
      const report = await exporting;

      expect(report.aborted).toBe(true);
      expect(report.written).toBe(0);
      expect(report.motionBlur.settledSamples).toBe(1);
      expect(report.motionBlur.processedSamples).toBe(1);
      expect(report.motionBlur.accumulatedSamples).toBe(1);
      expect(report.motionBlur.resolvedFrames).toBe(0);
      expect(writes).toBe(0);
      expect(seeks.at(-1)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settle falho numa subamostra descarta o frame temporal inteiro", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let current = -1;
      let sampleSeekCount = 0;
      let writes = 0;
      const seeks: number[] = [];
      const motionHost: ExportHost = {
        seek: (frame) => {
          current = frame;
          seeks.push(frame);
          if (!Number.isInteger(frame)) sampleSeekCount += 1;
        },
        observe: () => ({ frame: current, renders: sampleSeekCount }),
        // A primeira amostra estabiliza; a segunda simula o PMTiles preso.
        mapBusy: () => sampleSeekCount >= 2,
        assetsBusy: () => false,
        surfacesBusy: () => false,
        compose: () => FRAME,
        writeFrame: () => {
          writes += 1;
          return Promise.resolve({ ok: true, sha256: "não deveria escrever" });
        },
      };
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 3, range: { first: 1, last: 1 } },
        host: motionHost,
        motionBlur: { shutterAngle: 180, samples: 4 },
      });
      await vi.runAllTimersAsync();
      const report = await exporting;

      expect(report.terminatedBySettle).toBe(true);
      expect(report.settleFailures[0]).toMatchObject({
        sampleIndex: 1,
        reason: "map-busy",
      });
      expect(report.motionBlur.accumulatedSamples).toBe(1);
      expect(report.motionBlur.resolvedFrames).toBe(0);
      expect(report.written).toBe(0);
      expect(writes).toBe(0);
      expect(seeks.at(-1)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exceção numa subamostra restaura o centro antes de subir ao serviço", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let current = -1;
      const seeks: number[] = [];
      const motionHost: ExportHost = {
        seek: (frame) => {
          current = frame;
          seeks.push(frame);
        },
        observe: () => ({ frame: current, renders: seeks.length }),
        mapBusy: () => false,
        assetsBusy: () => false,
        surfacesBusy: () => false,
        compose: () => {
          throw new Error("falha de leitura");
        },
        writeFrame: () => Promise.resolve({ ok: true, sha256: "não deveria escrever" }),
      };
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 3, range: { first: 1, last: 1 } },
        host: motionHost,
        motionBlur: { shutterAngle: 180, samples: 4 },
      });
      const rejection = expect(exporting).rejects.toThrow("falha de leitura");
      await vi.runAllTimersAsync();
      await rejection;

      expect(seeks.at(-1)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exceção durante o settle também restaura o centro", async () => {
    let current = -1;
    const seeks: number[] = [];
    const motionHost: ExportHost = {
      seek: (frame) => {
        current = frame;
        seeks.push(frame);
      },
      observe: () => {
        throw new Error("sonda perdida");
      },
      mapBusy: () => false,
      assetsBusy: () => false,
      surfacesBusy: () => false,
      compose: () => FRAME,
      writeFrame: () => Promise.resolve({ ok: true, sha256: "não deveria escrever" }),
    };

    await expect(
      runExport({
        plan: { ...PLAN, durationFrames: 3, range: { first: 1, last: 1 } },
        host: motionHost,
        motionBlur: { shutterAngle: 180, samples: 4 },
      }),
    ).rejects.toThrow("sonda perdida");
    expect(current).toBe(1);
    expect(seeks.at(-1)).toBe(1);
  });

  it("erro ao acumular a segunda amostra restaura o centro", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let current = -1;
      let composes = 0;
      const seeks: number[] = [];
      const motionHost: ExportHost = {
        seek: (frame) => {
          current = frame;
          seeks.push(frame);
        },
        observe: () => ({ frame: current, renders: seeks.length }),
        mapBusy: () => false,
        assetsBusy: () => false,
        surfacesBusy: () => false,
        compose: () => {
          composes += 1;
          return composes === 1
            ? { width: 1, height: 1, rgba: new Uint8Array(4) }
            : { width: 2, height: 1, rgba: new Uint8Array(8) };
        },
        writeFrame: () => Promise.resolve({ ok: true, sha256: "não deveria escrever" }),
      };
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 3, range: { first: 1, last: 1 } },
        host: motionHost,
        motionBlur: { shutterAngle: 180, samples: 4 },
      });
      const rejection = expect(exporting).rejects.toThrow("subframe fora da resolução");
      await vi.runAllTimersAsync();
      await rejection;

      expect(seeks.at(-1)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelamento detectado dentro do settle descarta e restaura", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let current = -1;
      let abortChecks = 0;
      const seeks: number[] = [];
      let composes = 0;
      const motionHost: ExportHost = {
        seek: (frame) => {
          current = frame;
          seeks.push(frame);
        },
        observe: () => ({ frame: current, renders: 1 }),
        mapBusy: () => false,
        assetsBusy: () => false,
        surfacesBusy: () => false,
        compose: () => {
          composes += 1;
          return FRAME;
        },
        writeFrame: () => Promise.resolve({ ok: true, sha256: "não deveria escrever" }),
      };
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 3, range: { first: 1, last: 1 } },
        host: motionHost,
        motionBlur: { shutterAngle: 180, samples: 4 },
        // 1: antes do frame; 2: antes da amostra; 3: dentro de waitForQuiet.
        shouldAbort: () => (abortChecks += 1) >= 3,
      });
      await vi.runAllTimersAsync();
      const report = await exporting;

      expect(report.aborted).toBe(true);
      expect(report.written).toBe(0);
      expect(report.motionBlur.processedSamples).toBe(0);
      expect(composes).toBe(0);
      expect(seeks.at(-1)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("um host que arredonda subframes falha o settle e fica visível no trace", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let current = -1;
      const roundedHost: ExportHost = {
        seek: (frame) => {
          current = Math.round(frame);
        },
        observe: () => ({ frame: current, renders: 1 }),
        mapBusy: () => false,
        assetsBusy: () => false,
        surfacesBusy: () => false,
        compose: () => ({ width: 1, height: 1, rgba: Uint8Array.from([0, 0, 0, 255]) }),
        writeFrame: () => Promise.resolve({ ok: true, sha256: "rounded" }),
      };
      const exporting = runExport({
        plan: { ...PLAN, durationFrames: 3, range: { first: 1, last: 1 } },
        host: roundedHost,
        motionBlur: { shutterAngle: 180, samples: 4 },
        settlePolicy: "continue",
      });
      await vi.runAllTimersAsync();
      const report = await exporting;

      expect(report.settleFailed).toBe(4);
      expect(report.settleFailedOutputFrames).toBe(1);
      expect(report.settleFailedFrames).toEqual([1]);
      expect(report.settleFailures).toEqual(
        [0.8125, 0.9375, 1.0625, 1.1875].map((sampleFrame, sampleIndex) => ({
          outputIndex: 0,
          outputFrame: 1,
          sampleIndex,
          sampleFrame,
          reason: "frame-mismatch",
        })),
      );
      expect(report.motionBlur.processedSamples).toBe(4);
      expect(report.motionBlur.settledSamples).toBe(0);
      expect(report.motionBlur.sampleTrace.every((sample) => !sample.quiet)).toBe(true);
      expect(
        report.motionBlur.sampleTrace.some((sample) => Number.isInteger(sample.observedFrame)),
      ).toBe(true);
      expect(
        report.motionBlur.sampleTrace.every(
          (sample) => sample.requestedFrame !== sample.observedFrame,
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it("no modo temporal recusa a pilha inteira quando falta uma superfície", () => {
    const background = { width: 1920, height: 1080, nome: "fundo" };
    const overlay = { width: 1920, height: 1080, nome: "overlay" };
    expect(selectCompleteExportSurfaces([background, overlay])).toEqual([background, overlay]);
    expect(selectCompleteExportSurfaces([background, null])).toEqual([]);
    expect(selectCompleteExportSurfaces([undefined, overlay])).toEqual([]);
    expect(
      selectCompleteExportSurfaces([background, { width: 300, height: 150, nome: "não montado" }]),
    ).toEqual([]);
  });

  it("cada modo tem fundo e overlay do PROPRIO painel", () => {
    // O ADR-014 trocou a lista fixa de tres superficies por dois contratos, um
    // por modo. Misturar as superficies dos dois — mapa com overlay do palco —
    // era exatamente o que a lista universal permitia expressar por engano.
    expect(EXPORT_MODES.map((mode) => [mode.id, mode.background, mode.overlay])).toEqual([
      ["map", ".maplibregl-canvas", ".scene-overlay__pixi"],
      ["studio", ".studio-viewport__stage", ".studio-viewport__pixi"],
    ]);
  });

  it("o matte descarta o fundo e preserva o overlay, nos dois modos", () => {
    for (const mode of EXPORT_MODES) {
      expect(exportSurfaceSelectors(mode, true)).toEqual([mode.background, mode.overlay]);
      // Sem o fundo opaco: e ele que apagaria a transparencia que o matte existe
      // para produzir.
      expect(exportSurfaceSelectors(mode, false)).toEqual([mode.overlay]);
    }
  });

  it("gizmos e timeline nunca entram — é o critério 8 da Fase 8", () => {
    // Nenhum elemento de UI em nenhum frame. Aqui isso é estrutural: o canvas
    // de gizmos não está na lista de composição, e este teste falha se alguém
    // o acrescentar por engano.
    for (const excluido of EXCLUDED_SURFACE_SELECTORS) {
      for (const mode of EXPORT_MODES) {
        expect(exportSurfaceSelectors(mode, true)).not.toContain(excluido);
      }
    }
    expect(EXCLUDED_SURFACE_SELECTORS).toContain(".scene-overlay__ui");
    // E os marcadores de ponto de interesse do palco, pela mesma razão: o modo de
    // marcação é do editor, e esquecê-lo ligado não pode custar um numerozinho
    // verde em cima do míssil no vídeo entregue.
    expect(EXCLUDED_SURFACE_SELECTORS).toContain(".studio-viewport__markers");
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
