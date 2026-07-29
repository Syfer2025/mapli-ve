import { describe, expect, it } from "vitest";
import type { WebGLRenderer } from "three";
import { createStudioFrameProfiler } from "./studio-frame-profiler.js";

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;
const RENDERER = 0x1f01;
const VENDOR = 0x1f00;
const UNMASKED_RENDERER_WEBGL = 0x9246;
const UNMASKED_VENDOR_WEBGL = 0x9245;

interface FakeQuery {
  readonly id: number;
  readonly handle: WebGLQuery;
  available: boolean;
  nanoseconds: number;
  deleted: boolean;
}

interface FakeWebGl2 {
  readonly renderer: WebGLRenderer;
  readonly queries: readonly FakeQuery[];
  readonly deletedIds: readonly number[];
  readonly beginTargets: readonly number[];
  readonly endTargets: readonly number[];
  setTimerAvailable(available: boolean): void;
  setDisjoint(disjoint: boolean): void;
  complete(index: number, nanoseconds: number): void;
}

function fakeWebGl2(timerInitiallyAvailable = true): FakeWebGl2 {
  const queries: FakeQuery[] = [];
  const deletedIds: number[] = [];
  const beginTargets: number[] = [];
  const endTargets: number[] = [];
  const byHandle = new Map<WebGLQuery, FakeQuery>();
  let timerAvailable = timerInitiallyAvailable;
  let disjoint = false;
  let current: WebGLQuery | null = null;
  const timerExtension = { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT };
  const debugExtension = { UNMASKED_RENDERER_WEBGL, UNMASKED_VENDOR_WEBGL };

  const context = {
    drawingBufferWidth: 1920,
    drawingBufferHeight: 1080,
    QUERY_RESULT,
    QUERY_RESULT_AVAILABLE,
    RENDERER,
    VENDOR,
    getExtension: (name: string): unknown => {
      if (name === "EXT_disjoint_timer_query_webgl2") {
        return timerAvailable ? timerExtension : null;
      }
      if (name === "WEBGL_debug_renderer_info") return debugExtension;
      return null;
    },
    getParameter: (parameter: number): unknown => {
      if (parameter === GPU_DISJOINT_EXT) return disjoint;
      if (parameter === RENDERER) return "WebKit WebGL";
      if (parameter === VENDOR) return "WebKit";
      if (parameter === UNMASKED_RENDERER_WEBGL) return "ANGLE (NVIDIA RTX, Direct3D11)";
      if (parameter === UNMASKED_VENDOR_WEBGL) return "Google Inc. (NVIDIA)";
      return null;
    },
    createQuery: (): WebGLQuery => {
      const handle = { fakeQuery: queries.length + 1 } as unknown as WebGLQuery;
      const query: FakeQuery = {
        id: queries.length + 1,
        handle,
        available: false,
        nanoseconds: 0,
        deleted: false,
      };
      queries.push(query);
      byHandle.set(handle, query);
      return handle;
    },
    beginQuery: (target: number, query: WebGLQuery): void => {
      if (current !== null) throw new Error("query já ativa");
      if (!byHandle.has(query)) throw new Error("query desconhecida");
      beginTargets.push(target);
      current = query;
    },
    endQuery: (target: number): void => {
      if (current === null) throw new Error("nenhuma query ativa");
      endTargets.push(target);
      current = null;
    },
    getQueryParameter: (handle: WebGLQuery, parameter: number): unknown => {
      const query = byHandle.get(handle);
      if (query === undefined || query.deleted) throw new Error("query inválida");
      if (parameter === QUERY_RESULT_AVAILABLE) return query.available;
      if (parameter === QUERY_RESULT) return query.nanoseconds;
      throw new Error("parâmetro desconhecido");
    },
    deleteQuery: (handle: WebGLQuery): void => {
      const query = byHandle.get(handle);
      if (query === undefined) throw new Error("query desconhecida");
      if (query.deleted) throw new Error("query apagada duas vezes");
      query.deleted = true;
      deletedIds.push(query.id);
    },
  };
  const renderer = { getContext: () => context } as unknown as WebGLRenderer;

  return {
    renderer,
    queries,
    deletedIds,
    beginTargets,
    endTargets,
    setTimerAvailable: (available) => {
      timerAvailable = available;
    },
    setDisjoint: (next) => {
      disjoint = next;
    },
    complete: (index, nanoseconds) => {
      const query = queries[index];
      if (query === undefined) throw new Error(`query ${String(index)} ausente`);
      query.available = true;
      query.nanoseconds = nanoseconds;
    },
  };
}

describe("StudioFrameProfiler", () => {
  it("descobre a extensão tardiamente e nunca espera por uma query indisponível", () => {
    const fake = fakeWebGl2(false);
    const profiler = createStudioFrameProfiler(fake.renderer);
    expect(profiler.status().supported).toBe(false);

    profiler.start();
    expect(profiler.beginFrame(false)).toBe(false);
    fake.setTimerAvailable(true);
    expect(profiler.status().supported).toBe(true);
    expect(profiler.beginFrame(true)).toBe(true);
    expect(profiler.endFrame()).toBe(true);
    expect(profiler.status()).toMatchObject({ supported: true, pending: 1 });

    // Poll não bloqueia nem apaga enquanto o driver ainda não liberou o resultado.
    expect(profiler.poll().pending).toBe(1);
    expect(fake.deletedIds).toEqual([]);

    fake.complete(0, 4_250_000);
    const status = profiler.poll();
    expect(status.gpuMs).toEqual({ reflectionOff: [], reflectionOn: [4.25] });
    expect(status.pending).toBe(0);
    expect(fake.deletedIds).toEqual([1]);
  });

  it("mantém CPU e GPU cruas em buckets ON/OFF e expõe canvas e ANGLE", () => {
    const fake = fakeWebGl2();
    const profiler = createStudioFrameProfiler(fake.renderer);
    profiler.start();

    expect(profiler.recordCpuFrame(2.25, false)).toBe(true);
    expect(profiler.recordCpuFrame(3.5, true)).toBe(true);
    expect(profiler.recordCpuFrame(Number.NaN, true)).toBe(false);
    expect(profiler.recordCpuFrame(-1, false)).toBe(false);

    expect(profiler.beginFrame(false)).toBe(true);
    expect(profiler.endFrame()).toBe(true);
    expect(profiler.beginFrame(true)).toBe(true);
    expect(profiler.endFrame()).toBe(true);
    fake.complete(0, 1_500_000);
    fake.complete(1, 2_750_000);

    const status = profiler.poll();
    expect(status.cpuMs).toEqual({ reflectionOff: [2.25], reflectionOn: [3.5] });
    expect(status.gpuMs).toEqual({ reflectionOff: [1.5], reflectionOn: [2.75] });
    expect(status.canvas).toEqual({ width: 1920, height: 1080 });
    expect(status.diagnostics).toEqual({
      renderer: "WebKit WebGL",
      vendor: "WebKit",
      unmaskedRenderer: "ANGLE (NVIDIA RTX, Direct3D11)",
      unmaskedVendor: "Google Inc. (NVIDIA)",
      angle: "ANGLE (NVIDIA RTX, Direct3D11)",
    });
    expect(fake.beginTargets).toEqual([TIME_ELAPSED_EXT, TIME_ELAPSED_EXT]);
    expect(fake.endTargets).toEqual([TIME_ELAPSED_EXT, TIME_ELAPSED_EXT]);
  });

  it("pode classificar no fim pelo passe que realmente ocorreu", () => {
    const fake = fakeWebGl2();
    const profiler = createStudioFrameProfiler(fake.renderer);
    profiler.start();

    expect(profiler.beginFrame(true)).toBe(true);
    // A intenção era ON, mas o projetor recusou a câmera: a amostra pertence a OFF.
    expect(profiler.endFrame(false)).toBe(true);
    fake.complete(0, 1_250_000);

    expect(profiler.poll().gpuMs).toEqual({
      reflectionOff: [1.25],
      reflectionOn: [],
    });
  });

  it("descarta todo o lote no disjoint e conta eventos, não polls repetidos", () => {
    const fake = fakeWebGl2();
    const profiler = createStudioFrameProfiler(fake.renderer);
    profiler.start();

    for (const reflectionOn of [false, true]) {
      expect(profiler.beginFrame(reflectionOn)).toBe(true);
      expect(profiler.endFrame()).toBe(true);
    }
    fake.complete(0, 1_000_000);
    fake.complete(1, 2_000_000);
    fake.setDisjoint(true);

    expect(profiler.poll()).toMatchObject({
      pending: 0,
      disjoints: 1,
      gpuMs: { reflectionOff: [], reflectionOn: [] },
    });
    expect(fake.deletedIds).toEqual([1, 2]);
    expect(profiler.poll().disjoints).toBe(1);

    fake.setDisjoint(false);
    profiler.poll();
    expect(profiler.beginFrame(false)).toBe(true);
    expect(profiler.endFrame()).toBe(true);
    fake.complete(2, 3_000_000);
    fake.setDisjoint(true);
    expect(profiler.poll().disjoints).toBe(2);
    expect(fake.deletedIds).toEqual([1, 2, 3]);
    expect(profiler.status().gpuMs).toEqual({ reflectionOff: [], reflectionOn: [] });
  });

  it("sem extensão mantém CPU real, supported=false e nenhum GPU ms inventado", () => {
    const fake = fakeWebGl2(false);
    const profiler = createStudioFrameProfiler(fake.renderer);
    profiler.start();

    expect(profiler.recordCpuFrame(7.25, true)).toBe(true);
    expect(profiler.beginFrame(true)).toBe(false);
    expect(profiler.endFrame()).toBe(false);
    expect(profiler.poll()).toMatchObject({
      active: true,
      supported: false,
      pending: 0,
      cpuMs: { reflectionOff: [], reflectionOn: [7.25] },
      gpuMs: { reflectionOff: [], reflectionOn: [] },
    });
    expect(fake.queries).toHaveLength(0);

    profiler.stop();
    expect(profiler.status().active).toBe(false);
    expect(profiler.recordCpuFrame(1, false)).toBe(false);
  });

  it("endFrame em finally fecha a query mesmo quando o render lança", () => {
    const fake = fakeWebGl2();
    const profiler = createStudioFrameProfiler(fake.renderer);
    profiler.start();

    expect(() => {
      expect(profiler.beginFrame(false)).toBe(true);
      try {
        throw new Error("render falhou");
      } finally {
        expect(profiler.endFrame()).toBe(true);
      }
    }).toThrow("render falhou");

    expect(profiler.status()).toMatchObject({ frameOpen: false, pending: 1 });
    // Uma segunda query prova que a primeira não ficou ativa no WebGL.
    expect(profiler.beginFrame(true)).toBe(true);
    expect(profiler.endFrame()).toBe(true);
    expect(profiler.status().pending).toBe(2);
  });

  it("reset/start apagam a época anterior e deleteQuery cobre descarte e dispose", () => {
    const fake = fakeWebGl2();
    const profiler = createStudioFrameProfiler(fake.renderer);
    profiler.start();
    profiler.recordCpuFrame(1, false);
    profiler.beginFrame(false);
    profiler.endFrame();
    expect(profiler.status().pending).toBe(1);

    profiler.reset();
    expect(profiler.status()).toMatchObject({
      active: true,
      pending: 0,
      disjoints: 0,
      cpuMs: { reflectionOff: [], reflectionOn: [] },
    });
    expect(fake.deletedIds).toEqual([1]);

    profiler.recordCpuFrame(2, true);
    profiler.start();
    expect(profiler.status().cpuMs).toEqual({ reflectionOff: [], reflectionOn: [] });

    // Uma query encerrada e outra ainda aberta: dispose deve apagar as duas.
    profiler.beginFrame(false);
    profiler.endFrame();
    profiler.beginFrame(true);
    profiler.dispose();
    expect([...fake.deletedIds].sort((left, right) => left - right)).toEqual([1, 2, 3]);
    expect(profiler.status()).toMatchObject({
      active: false,
      disposed: true,
      pending: 0,
      frameOpen: false,
    });
    expect(profiler.beginFrame(false)).toBe(false);
    profiler.start();
    expect(profiler.status().active).toBe(false);
  });
});
