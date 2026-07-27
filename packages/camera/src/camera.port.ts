import { type Disposable } from "@theatrum/core-utils";
import {
  DEFAULT_CAMERA_CONSTRAINTS,
  type CameraConstraints,
  type CameraState,
  normalizeCameraState,
} from "./state.js";

declare function setTimeout(callback: () => void, delayMs: number): unknown;
declare function clearTimeout(handle: unknown): void;

/** Forma de aplicar uma câmera no runtime. Export usa sempre `jump`. */
export type CameraApplyMode = "jump" | "ease";

/**
 * Subconjunto estrutural de `AbortSignal` usado sem acoplar o pacote ao DOM.
 *
 * Um `AbortSignal` nativo pode ser passado diretamente.
 */
export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/**
 * Fronteira entre o motor puro de câmera e o runtime de mapa.
 *
 * A implementação MapLibre traduz `apply` para `jumpTo`/`easeTo`, consulta o
 * estado de carga em `isSettled` e publica o evento `idle` em `onSettled`.
 */
export interface CameraPort {
  apply(state: CameraState, mode: CameraApplyMode): void;
  current(): CameraState;
  isSettled(): boolean;
  onSettled(listener: () => void): Disposable;
}

/** Opções da espera por tiles, glyphs e demais recursos da vista atual. */
export interface SettleOptions {
  readonly timeoutMs: number;
  readonly signal?: CancellationSignal;
}

/** Resultado total de `settle`; a espera nunca fica pendurada indefinidamente. */
export type SettleResult =
  | { readonly settled: true }
  | { readonly settled: false; readonly reason: "timeout"; readonly timeoutMs: number }
  | { readonly settled: false; readonly reason: "cancelled" };

const SETTLED: SettleResult = Object.freeze({ settled: true });
const CANCELLED: SettleResult = Object.freeze({ settled: false, reason: "cancelled" });

/**
 * Normaliza e aplica um estado ao runtime.
 *
 * Devolve exatamente o estado enviado ao port, o que facilita manter o
 * documento e o adaptador sincronizados.
 */
export function apply(
  port: CameraPort,
  state: CameraState,
  mode: CameraApplyMode = "jump",
  constraints: CameraConstraints = DEFAULT_CAMERA_CONSTRAINTS,
): CameraState {
  const canonical = normalizeCameraState(state, constraints);
  port.apply(canonical, mode);
  return canonical;
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("timeout precisa ser finito e não negativo");
  }
}

/**
 * Aguarda o mapa terminar de carregar a vista atual.
 *
 * A checagem antes e depois da inscrição fecha a corrida entre `isSettled()` e
 * o evento. Timeout, sucesso, cancelamento e exceção sempre limpam timer e
 * listener.
 */
export function settle(
  port: CameraPort,
  timeoutMs: number,
  signal?: CancellationSignal,
): Promise<SettleResult>;
export function settle(port: CameraPort, options: SettleOptions): Promise<SettleResult>;
export function settle(
  port: CameraPort,
  timeoutOrOptions: number | SettleOptions,
  signal?: CancellationSignal,
): Promise<SettleResult> {
  const timeoutMs =
    typeof timeoutOrOptions === "number" ? timeoutOrOptions : timeoutOrOptions.timeoutMs;
  const cancellation = typeof timeoutOrOptions === "number" ? signal : timeoutOrOptions.signal;

  validateTimeout(timeoutMs);
  if (cancellation?.aborted === true) return Promise.resolve(CANCELLED);
  if (port.isSettled()) return Promise.resolve(SETTLED);

  return new Promise<SettleResult>((resolve, reject) => {
    let isDone = false;
    let isAbortListening = false;
    let canComplete = false;
    let pendingResult: SettleResult | undefined;
    let subscription: Disposable | undefined;
    let timeoutHandle: unknown | null = null;

    const cleanup = (): readonly unknown[] => {
      const errors: unknown[] = [];
      if (timeoutHandle !== null) {
        try {
          clearTimeout(timeoutHandle);
        } catch (error: unknown) {
          errors.push(error);
        }
        timeoutHandle = null;
      }
      if (isAbortListening && cancellation !== undefined) {
        try {
          cancellation.removeEventListener("abort", onAbort);
        } catch (error: unknown) {
          errors.push(error);
        }
        isAbortListening = false;
      }
      try {
        subscription?.dispose();
      } catch (error: unknown) {
        errors.push(error);
      }
      subscription = undefined;
      return errors;
    };

    const complete = (result: SettleResult): void => {
      if (isDone) return;
      isDone = true;
      const errors = cleanup();
      if (errors.length === 0) {
        resolve(result);
      } else if (errors.length === 1) {
        reject(errors[0]);
      } else {
        reject(new AggregateError(errors, "falhas ao limpar espera da câmera"));
      }
    };

    const fail = (error: unknown): void => {
      if (isDone) return;
      isDone = true;
      const cleanupErrors = cleanup();
      if (cleanupErrors.length === 0) {
        reject(error);
      } else {
        reject(
          new AggregateError(
            [error, ...cleanupErrors],
            "falha no port e ao limpar espera da câmera",
          ),
        );
      }
    };

    const requestCompletion = (result: SettleResult): void => {
      if (!canComplete) {
        pendingResult ??= result;
        return;
      }
      complete(result);
    };

    function onAbort(): void {
      requestCompletion(CANCELLED);
    }

    try {
      timeoutHandle = setTimeout(
        () => requestCompletion({ settled: false, reason: "timeout", timeoutMs }),
        timeoutMs,
      );

      if (cancellation !== undefined) {
        isAbortListening = true;
        cancellation.addEventListener("abort", onAbort);
        if (cancellation.aborted) {
          pendingResult = CANCELLED;
        }
        if (pendingResult !== undefined) {
          canComplete = true;
          complete(pendingResult);
          return;
        }
      }

      subscription = port.onSettled(() => requestCompletion(SETTLED));
      canComplete = true;
      if (pendingResult !== undefined) {
        complete(pendingResult);
        return;
      }

      // O evento pode ter ocorrido entre a primeira checagem e a inscrição.
      if (port.isSettled()) complete(SETTLED);
    } catch (error: unknown) {
      fail(error);
    }
  });
}
