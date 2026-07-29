/**
 * Medição opt-in do custo do canvas Three do palco.
 *
 * CPU e GPU são sinais diferentes e permanecem separados. A CPU é registrada
 * pelo chamador, que sabe onde começa e termina o frame completo. A GPU usa
 * `EXT_disjoint_timer_query_webgl2`: `endFrame` só fecha a query e `poll` só lê
 * resultados que o driver já marcou como disponíveis. Não há `finish`,
 * `readPixels`, espera ativa nem valor estimado quando a extensão não existe.
 *
 * Uso esperado:
 *
 * ```ts
 * profiler.beginFrame(reflectionOn);
 * try {
 *   // render do frame
 * } finally {
 *   profiler.endFrame();
 * }
 * ```
 *
 * `recordCpuFrame` fica separado de propósito: medir com o relógio e escolher o
 * intervalo pertencem ao ponto de integração, não a este módulo.
 */

import type { WebGLRenderer } from "three";

const TIMER_QUERY_EXTENSION = "EXT_disjoint_timer_query_webgl2";
const DEBUG_RENDERER_EXTENSION = "WEBGL_debug_renderer_info";
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface DebugRendererInfo {
  readonly UNMASKED_RENDERER_WEBGL: number;
  readonly UNMASKED_VENDOR_WEBGL: number;
}

interface DiagnosticContext {
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  readonly RENDERER: number;
  readonly VENDOR: number;
  readonly getExtension: (name: string) => unknown;
  readonly getParameter: (parameter: number) => unknown;
}

interface TimerQueryContext extends DiagnosticContext {
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
  readonly createQuery: () => WebGLQuery | null;
  readonly beginQuery: (target: number, query: WebGLQuery) => void;
  readonly endQuery: (target: number) => void;
  readonly getQueryParameter: (query: WebGLQuery, parameter: number) => unknown;
  readonly deleteQuery: (query: WebGLQuery) => void;
}

interface GpuQuerySample {
  readonly query: WebGLQuery;
  readonly reflectionOn: boolean;
}

interface OpenGpuQuery extends GpuQuerySample {
  readonly target: number;
  discard: boolean;
}

export interface StudioFrameProfilerSamples {
  readonly reflectionOff: readonly number[];
  readonly reflectionOn: readonly number[];
}

export interface StudioFrameProfilerCanvas {
  /** Backing store real do WebGL, já incluindo DPR. */
  readonly width: number;
  readonly height: number;
}

export interface StudioFrameProfilerDiagnostics {
  /** Valores mascarados expostos pelo WebGL sem extensão de debug. */
  readonly renderer: string | null;
  readonly vendor: string | null;
  /** Valores reais quando `WEBGL_debug_renderer_info` está disponível. */
  readonly unmaskedRenderer: string | null;
  readonly unmaskedVendor: string | null;
  /** Renderer contendo `ANGLE`, quando o Chromium o expõe. */
  readonly angle: string | null;
}

export interface StudioFrameProfilerStatus {
  /** Coleta aceita novas amostras. CPU pode estar ativa mesmo sem timer de GPU. */
  readonly active: boolean;
  readonly disposed: boolean;
  /** A extensão WebGL2 foi realmente obtida; `false` nunca ganha GPU ms sintético. */
  readonly supported: boolean;
  /** Queries encerradas cujo resultado ainda pertence ao driver. */
  readonly pending: number;
  /** Há uma query entre `beginFrame` e `endFrame`. */
  readonly frameOpen: boolean;
  /** Eventos disjoint distintos observados desde o último reset. */
  readonly disjoints: number;
  readonly canvas: StudioFrameProfilerCanvas;
  readonly diagnostics: StudioFrameProfilerDiagnostics;
  /** Amostras cruas em milissegundos, sem média, descarte estatístico ou pareamento. */
  readonly cpuMs: StudioFrameProfilerSamples;
  /** Amostras cruas válidas em milissegundos; lote disjoint nunca entra aqui. */
  readonly gpuMs: StudioFrameProfilerSamples;
}

export interface StudioFrameProfiler {
  /** Inicia uma época nova: descarta queries antigas e zera todas as amostras. */
  readonly start: () => void;
  /** Zera a época sem mudar se o profiler está ativo. */
  readonly reset: () => void;
  /** Abre a query de GPU do frame; `false` significa que nenhuma query foi aberta. */
  readonly beginFrame: (reflectionOn: boolean) => boolean;
  /**
   * Fecha a query aberta. O bucket opcional permite classificar pelo passe que
   * realmente ocorreu, depois do render; omitido preserva o rótulo de `beginFrame`.
   */
  readonly endFrame: (reflectionOn?: boolean) => boolean;
  /** Registra a medição externa de CPU quando ativa e finita. */
  readonly recordCpuFrame: (milliseconds: number, reflectionOn: boolean) => boolean;
  /** Para novas amostras; uma query aberta é encerrada, nunca aguardada. */
  readonly stop: () => void;
  /** Recolhe somente queries já disponíveis e devolve um snapshot. */
  readonly poll: () => StudioFrameProfilerStatus;
  /** Snapshot sem consultar disponibilidade de query. */
  readonly status: () => StudioFrameProfilerStatus;
  /** Descarta e apaga todas as queries WebGL ainda pertencentes ao profiler. */
  readonly dispose: () => void;
}

/**
 * Cria o profiler desligado. Consultar extensões não inicia medição; queries só
 * nascem depois de `start`.
 */
export function createStudioFrameProfiler(renderer: WebGLRenderer): StudioFrameProfiler {
  const rawContext = renderer.getContext() as unknown;
  const context = diagnosticContext(rawContext);
  const timerContext = timerQueryContext(rawContext);
  let extension = timerContext === null ? null : readTimerExtension(timerContext);

  const cpuOff: number[] = [];
  const cpuOn: number[] = [];
  const gpuOff: number[] = [];
  const gpuOn: number[] = [];
  let pending: GpuQuerySample[] = [];
  let open: OpenGpuQuery | null = null;
  let active = false;
  let disposed = false;
  let disjoints = 0;
  let disjointLatched = false;

  const refreshExtension = (): void => {
    if (disposed || extension !== null || timerContext === null) return;
    extension = readTimerExtension(timerContext);
  };

  const deleteQuery = (query: WebGLQuery): void => {
    if (timerContext === null) return;
    try {
      timerContext.deleteQuery(query);
    } catch {
      // Contexto perdido já descartou o recurso no driver. O profiler não deve
      // transformar diagnóstico em falha do frame.
    }
  };

  const discardPending = (): void => {
    for (const sample of pending) deleteQuery(sample.query);
    pending = [];
  };

  const discardOpen = (): void => {
    const current = open;
    if (current === null || timerContext === null) return;
    open = null;
    try {
      timerContext.endQuery(current.target);
    } catch {
      // Mesmo em contexto perdido a referência JS ainda precisa sair do profiler.
    }
    deleteQuery(current.query);
  };

  const observeDisjoint = (): "clear" | "disjoint" | "unknown" => {
    if (timerContext === null || extension === null) return "unknown";
    let value: unknown;
    try {
      value = timerContext.getParameter(extension.GPU_DISJOINT_EXT);
    } catch {
      return "unknown";
    }
    if (typeof value !== "boolean" && typeof value !== "number") return "unknown";
    const disjoint = Boolean(value);
    if (!disjoint) {
      disjointLatched = false;
      return "clear";
    }
    if (!disjointLatched) disjoints += 1;
    disjointLatched = true;
    if (open !== null) open.discard = true;
    discardPending();
    return "disjoint";
  };

  const reset = (): void => {
    discardOpen();
    discardPending();
    cpuOff.length = 0;
    cpuOn.length = 0;
    gpuOff.length = 0;
    gpuOn.length = 0;
    disjoints = 0;
    disjointLatched = false;
  };

  const status = (): StudioFrameProfilerStatus => {
    // A extensão pode aparecer depois da criação (por exemplo, após restauração
    // do contexto). Consultá-la não cria query nem espera pela GPU.
    refreshExtension();
    return Object.freeze({
      active,
      disposed,
      supported: extension !== null,
      pending: pending.length,
      frameOpen: open !== null,
      disjoints,
      canvas: canvasStatus(context),
      diagnostics: rendererDiagnostics(context),
      cpuMs: sampleStatus(cpuOff, cpuOn),
      gpuMs: sampleStatus(gpuOff, gpuOn),
    });
  };

  const endFrame = (reflectionOn?: boolean): boolean => {
    const current = open;
    if (current === null || timerContext === null) return false;
    open = null;
    try {
      timerContext.endQuery(current.target);
    } catch {
      deleteQuery(current.query);
      return false;
    }
    if (current.discard) {
      deleteQuery(current.query);
      return false;
    }
    pending.push({
      query: current.query,
      reflectionOn: reflectionOn ?? current.reflectionOn,
    });
    return true;
  };

  return {
    start: () => {
      if (disposed) return;
      reset();
      refreshExtension();
      active = true;
    },
    reset,
    beginFrame: (reflectionOn) => {
      if (!active || disposed) return false;
      refreshExtension();
      if (timerContext === null || extension === null) return false;
      if (open !== null) {
        throw new Error("StudioFrameProfiler: beginFrame sem endFrame anterior.");
      }
      const query = timerContext.createQuery();
      if (query === null) return false;
      try {
        timerContext.beginQuery(extension.TIME_ELAPSED_EXT, query);
      } catch {
        deleteQuery(query);
        return false;
      }
      open = {
        query,
        target: extension.TIME_ELAPSED_EXT,
        reflectionOn,
        discard: false,
      };
      return true;
    },
    endFrame,
    recordCpuFrame: (milliseconds, reflectionOn) => {
      if (!active || disposed || !Number.isFinite(milliseconds) || milliseconds < 0) return false;
      (reflectionOn ? cpuOn : cpuOff).push(milliseconds);
      return true;
    },
    stop: () => {
      if (disposed) return;
      endFrame();
      active = false;
    },
    poll: () => {
      if (disposed) return status();
      refreshExtension();
      if (timerContext === null || extension === null) return status();

      const before = observeDisjoint();
      if (before !== "clear" || pending.length === 0) return status();

      const completed: { readonly sample: GpuQuerySample; readonly milliseconds: number | null }[] =
        [];
      const unavailable: GpuQuerySample[] = [];
      for (const sample of pending) {
        try {
          const available = Boolean(
            timerContext.getQueryParameter(sample.query, timerContext.QUERY_RESULT_AVAILABLE),
          );
          if (!available) {
            unavailable.push(sample);
            continue;
          }
          const nanoseconds = timerContext.getQueryParameter(
            sample.query,
            timerContext.QUERY_RESULT,
          );
          const milliseconds =
            typeof nanoseconds === "number" && Number.isFinite(nanoseconds) && nanoseconds >= 0
              ? nanoseconds / NANOSECONDS_PER_MILLISECOND
              : null;
          completed.push({ sample, milliseconds });
        } catch {
          // Query inválida/contexto perdido: descarta sem fabricar zero.
          completed.push({ sample, milliseconds: null });
        }
      }

      // O driver pode anunciar disjoint entre a primeira consulta e a leitura dos
      // resultados. Só publica o lote depois de uma segunda confirmação.
      const after = observeDisjoint();
      if (after !== "clear") return status();

      pending = unavailable;
      for (const result of completed) {
        deleteQuery(result.sample.query);
        if (result.milliseconds === null) continue;
        (result.sample.reflectionOn ? gpuOn : gpuOff).push(result.milliseconds);
      }
      return status();
    },
    status,
    dispose: () => {
      if (disposed) return;
      active = false;
      discardOpen();
      discardPending();
      disposed = true;
    },
  };
}

function diagnosticContext(value: unknown): DiagnosticContext | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<DiagnosticContext>;
  return (
    typeof candidate.getExtension === "function" &&
    typeof candidate.getParameter === "function" &&
    typeof candidate.drawingBufferWidth === "number" &&
    typeof candidate.drawingBufferHeight === "number" &&
    typeof candidate.RENDERER === "number" &&
    typeof candidate.VENDOR === "number"
      ? candidate
      : null
  ) as DiagnosticContext | null;
}

function timerQueryContext(value: unknown): TimerQueryContext | null {
  const diagnostic = diagnosticContext(value);
  if (diagnostic === null) return null;
  const candidate = value as Partial<TimerQueryContext>;
  return (
    typeof candidate.createQuery === "function" &&
    typeof candidate.beginQuery === "function" &&
    typeof candidate.endQuery === "function" &&
    typeof candidate.getQueryParameter === "function" &&
    typeof candidate.deleteQuery === "function" &&
    typeof candidate.QUERY_RESULT_AVAILABLE === "number" &&
    typeof candidate.QUERY_RESULT === "number"
      ? candidate
      : null
  ) as TimerQueryContext | null;
}

function readTimerExtension(context: DiagnosticContext): TimerQueryExtension | null {
  let value: unknown;
  try {
    value = context.getExtension(TIMER_QUERY_EXTENSION);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<TimerQueryExtension>;
  return typeof candidate.TIME_ELAPSED_EXT === "number" &&
    typeof candidate.GPU_DISJOINT_EXT === "number"
    ? (candidate as TimerQueryExtension)
    : null;
}

function readDebugExtension(context: DiagnosticContext | null): DebugRendererInfo | null {
  if (context === null) return null;
  let value: unknown;
  try {
    value = context.getExtension(DEBUG_RENDERER_EXTENSION);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<DebugRendererInfo>;
  return typeof candidate.UNMASKED_RENDERER_WEBGL === "number" &&
    typeof candidate.UNMASKED_VENDOR_WEBGL === "number"
    ? (candidate as DebugRendererInfo)
    : null;
}

function canvasStatus(context: DiagnosticContext | null): StudioFrameProfilerCanvas {
  const width =
    context !== null && Number.isFinite(context.drawingBufferWidth)
      ? Math.max(0, Math.trunc(context.drawingBufferWidth))
      : 0;
  const height =
    context !== null && Number.isFinite(context.drawingBufferHeight)
      ? Math.max(0, Math.trunc(context.drawingBufferHeight))
      : 0;
  return Object.freeze({ width, height });
}

function rendererDiagnostics(context: DiagnosticContext | null): StudioFrameProfilerDiagnostics {
  if (context === null) {
    return Object.freeze({
      renderer: null,
      vendor: null,
      unmaskedRenderer: null,
      unmaskedVendor: null,
      angle: null,
    });
  }
  const renderer = stringParameter(context, context.RENDERER);
  const vendor = stringParameter(context, context.VENDOR);
  const debug = readDebugExtension(context);
  const unmaskedRenderer =
    debug === null ? null : stringParameter(context, debug.UNMASKED_RENDERER_WEBGL);
  const unmaskedVendor =
    debug === null ? null : stringParameter(context, debug.UNMASKED_VENDOR_WEBGL);
  const angle =
    [unmaskedRenderer, renderer].find(
      (candidate): candidate is string =>
        candidate !== null && candidate.toUpperCase().includes("ANGLE"),
    ) ?? null;
  return Object.freeze({
    renderer,
    vendor,
    unmaskedRenderer,
    unmaskedVendor,
    angle,
  });
}

function stringParameter(context: DiagnosticContext, parameter: number): string | null {
  try {
    const value = context.getParameter(parameter);
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

function sampleStatus(off: readonly number[], on: readonly number[]): StudioFrameProfilerSamples {
  return Object.freeze({
    reflectionOff: Object.freeze([...off]),
    reflectionOn: Object.freeze([...on]),
  });
}
