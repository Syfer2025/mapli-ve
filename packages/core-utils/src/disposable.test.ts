import { describe, expect, it, vi } from "vitest";
import { disposeAll, DisposableStore, NO_OP_DISPOSABLE, toDisposable } from "./disposable.js";

describe("toDisposable", () => {
  it("chama a função no dispose", () => {
    const fn = vi.fn();
    toDisposable(fn).dispose();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("é idempotente", () => {
    const fn = vi.fn();
    const d = toDisposable(fn);
    d.dispose();
    d.dispose();
    d.dispose();
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("NO_OP_DISPOSABLE", () => {
  it("não lança", () => {
    expect(() => NO_OP_DISPOSABLE.dispose()).not.toThrow();
  });
});

describe("disposeAll", () => {
  it("descarta todos", () => {
    const fns = [vi.fn(), vi.fn(), vi.fn()];
    disposeAll(fns.map(toDisposable));
    for (const fn of fns) expect(fn).toHaveBeenCalledOnce();
  });

  it("um que lança não impede os outros", () => {
    const before = vi.fn();
    const after = vi.fn();
    const items = [
      toDisposable(before),
      toDisposable(() => {
        throw new Error("quebrado");
      }),
      toDisposable(after),
    ];
    expect(() => disposeAll(items)).toThrow("quebrado");
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });

  it("múltiplas falhas vêm agregadas", () => {
    const items = [
      toDisposable(() => {
        throw new Error("a");
      }),
      toDisposable(() => {
        throw new Error("b");
      }),
    ];
    try {
      disposeAll(items);
      expect.unreachable("devia ter lançado");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toHaveLength(2);
    }
  });

  it("lista vazia não lança", () => {
    expect(() => disposeAll([])).not.toThrow();
  });
});

describe("DisposableStore", () => {
  it("add devolve o próprio recurso", () => {
    const store = new DisposableStore();
    const d = toDisposable(vi.fn());
    expect(store.add(d)).toBe(d);
    expect(store.size).toBe(1);
  });

  it("dispose descarta tudo o que foi adicionado", () => {
    const store = new DisposableStore();
    const fns = [vi.fn(), vi.fn()];
    for (const fn of fns) store.add(toDisposable(fn));
    store.dispose();
    for (const fn of fns) expect(fn).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
    expect(store.isDisposed).toBe(true);
  });

  it("dispose é idempotente", () => {
    const store = new DisposableStore();
    const fn = vi.fn();
    store.add(toDisposable(fn));
    store.dispose();
    store.dispose();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("add em store já descartado descarta na hora", () => {
    // Evita vazamento silencioso em inicialização assíncrona que chega tarde.
    const store = new DisposableStore();
    store.dispose();
    const fn = vi.fn();
    store.add(toDisposable(fn));
    expect(fn).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
  });

  it("clear descarta mas mantém o store utilizável", () => {
    const store = new DisposableStore();
    const first = vi.fn();
    store.add(toDisposable(first));
    store.clear();
    expect(first).toHaveBeenCalledOnce();
    expect(store.isDisposed).toBe(false);

    const second = vi.fn();
    store.add(toDisposable(second));
    expect(store.size).toBe(1);
    store.dispose();
    expect(second).toHaveBeenCalledOnce();
  });

  it("detach transfere a posse sem descartar", () => {
    const store = new DisposableStore();
    const fn = vi.fn();
    const d = store.add(toDisposable(fn));
    expect(store.detach(d)).toBe(true);
    store.dispose();
    expect(fn).not.toHaveBeenCalled();
    expect(store.detach(d)).toBe(false);
  });
});
