import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CAMERA_STATE,
  type CameraApplyMode,
  type CameraPort,
  type CameraState,
  type CancellationSignal,
  apply as applyCamera,
  settle,
} from "./index.js";

class FakeCameraPort implements CameraPort {
  state: CameraState = DEFAULT_CAMERA_STATE;
  settled = false;
  settleDuringSubscription = false;
  settleOnSecondCheck = false;
  throwDuringSubscription: unknown;
  throwDuringDispose: unknown;
  readonly calls: { readonly state: CameraState; readonly mode: CameraApplyMode }[] = [];
  readonly listeners = new Set<() => void>();
  checkCount = 0;
  disposeCount = 0;

  apply(state: CameraState, mode: CameraApplyMode): void {
    this.state = state;
    this.calls.push({ state, mode });
  }

  current(): CameraState {
    return this.state;
  }

  isSettled(): boolean {
    this.checkCount++;
    if (this.settleOnSecondCheck && this.checkCount === 2) this.settled = true;
    return this.settled;
  }

  onSettled(listener: () => void): { dispose(): void } {
    if (this.throwDuringSubscription !== undefined) throw this.throwDuringSubscription;
    this.listeners.add(listener);
    if (this.settleDuringSubscription) {
      this.settled = true;
      listener();
    }
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.disposeCount++;
        this.listeners.delete(listener);
        if (this.throwDuringDispose !== undefined) throw this.throwDuringDispose;
      },
    };
  }

  finishSettling(): void {
    this.settled = true;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeCancellationSignal implements CancellationSignal {
  aborted = false;
  readonly listeners = new Set<() => void>();

  addEventListener(_type: "abort", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "abort", listener: () => void): void {
    this.listeners.delete(listener);
  }

  abort(): void {
    this.aborted = true;
    for (const listener of [...this.listeners]) listener();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("apply", () => {
  it("normaliza e usa jump por padrão", () => {
    const port = new FakeCameraPort();
    const applied = applyCamera(port, {
      center: [181, 90],
      zoom: 99,
      bearing: -10,
      pitch: -10,
    });

    expect(applied).toEqual({
      center: [-179, 85.051_128_779_806_6],
      zoom: 24,
      bearing: 350,
      pitch: 0,
    });
    expect(port.calls).toEqual([{ state: applied, mode: "jump" }]);
    expect(port.current()).toBe(applied);
  });

  it("preserva o modo ease no preview", () => {
    const port = new FakeCameraPort();
    applyCamera(port, DEFAULT_CAMERA_STATE, "ease");
    expect(port.calls[0]?.mode).toBe("ease");
  });

  it("não chama o port quando o estado é inválido", () => {
    const port = new FakeCameraPort();
    expect(() => applyCamera(port, { ...DEFAULT_CAMERA_STATE, zoom: Number.NaN })).toThrow(
      RangeError,
    );
    expect(port.calls).toHaveLength(0);
  });
});

describe("settle", () => {
  it("resolve imediatamente quando o mapa já está estável", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    port.settled = true;

    await expect(settle(port, 100)).resolves.toEqual({ settled: true });
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolve no evento e limpa inscrição e timeout", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    const pending = settle(port, 100);

    expect(port.listeners.size).toBe(1);
    port.finishSettling();

    await expect(pending).resolves.toEqual({ settled: true });
    expect(port.listeners.size).toBe(0);
    expect(port.disposeCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reporta timeout e limpa a inscrição", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    const pending = settle(port, { timeoutMs: 75 });

    await vi.advanceTimersByTimeAsync(75);

    await expect(pending).resolves.toEqual({
      settled: false,
      reason: "timeout",
      timeoutMs: 75,
    });
    expect(port.listeners.size).toBe(0);
    expect(port.disposeCount).toBe(1);
  });

  it("cancela com sinal já abortado sem inscrever ou armar timer", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    const signal = new FakeCancellationSignal();
    signal.abort();

    await expect(settle(port, 100, signal)).resolves.toEqual({
      settled: false,
      reason: "cancelled",
    });
    expect(port.checkCount).toBe(0);
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancela durante a espera e remove todos os listeners", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    const signal = new FakeCancellationSignal();
    const pending = settle(port, { timeoutMs: 100, signal });

    signal.abort();

    await expect(pending).resolves.toEqual({ settled: false, reason: "cancelled" });
    expect(port.listeners.size).toBe(0);
    expect(signal.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aceita AbortSignal nativo estruturalmente", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    const controller = new AbortController();
    const pending = settle(port, { timeoutMs: 100, signal: controller.signal });

    controller.abort();

    await expect(pending).resolves.toEqual({ settled: false, reason: "cancelled" });
  });

  it("fecha a corrida quando o mapa estabiliza entre checagem e inscrição", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    port.settleOnSecondCheck = true;

    await expect(settle(port, 100)).resolves.toEqual({ settled: true });
    expect(port.checkCount).toBe(2);
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limpa uma inscrição cujo evento dispara sincronamente ao registrar", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    port.settleDuringSubscription = true;

    await expect(settle(port, 100)).resolves.toEqual({ settled: true });
    expect(port.listeners.size).toBe(0);
    expect(port.disposeCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limpa recursos e propaga bug lançado pelo port", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    const expected = new Error("falha no adaptador");
    port.throwDuringSubscription = expected;

    await expect(settle(port, 100)).rejects.toBe(expected);
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("não fica pendurado quando o descarte do adaptador falha", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    const expected = new Error("falha ao descartar");
    port.throwDuringDispose = expected;
    const pending = settle(port, 100);

    port.finishSettling();

    await expect(pending).rejects.toBe(expected);
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignora eventos tardios depois do primeiro resultado", async () => {
    vi.useFakeTimers();
    const port = new FakeCameraPort();
    const signal = new FakeCancellationSignal();
    const pending = settle(port, 100, signal);

    port.finishSettling();
    signal.abort();
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({ settled: true });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejeita timeout inválido %s sincronamente",
    (timeoutMs) => {
      expect(() => settle(new FakeCameraPort(), timeoutMs)).toThrow(RangeError);
    },
  );
});
