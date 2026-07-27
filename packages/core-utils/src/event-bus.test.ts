import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "./event-bus.js";

type TestEvents = {
  "playhead:moved": { frame: number; scrubbing: boolean };
  "selection:changed": { nodeIds: string[] };
  "map:idle": { generation: number };
};

describe("createEventBus", () => {
  it("entrega o payload ao listener", () => {
    const bus = createEventBus<TestEvents>();
    const seen: number[] = [];
    bus.on("playhead:moved", ({ frame }) => seen.push(frame));
    bus.emit("playhead:moved", { frame: 90, scrubbing: false });
    expect(seen).toEqual([90]);
  });

  it("entrega a todos os listeners do evento", () => {
    const bus = createEventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("map:idle", a);
    bus.on("map:idle", b);
    bus.emit("map:idle", { generation: 1 });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("não entrega a listeners de outro evento", () => {
    const bus = createEventBus<TestEvents>();
    const other = vi.fn();
    bus.on("selection:changed", other);
    bus.emit("map:idle", { generation: 1 });
    expect(other).not.toHaveBeenCalled();
  });

  it("dispose remove o listener", () => {
    const bus = createEventBus<TestEvents>();
    const fn = vi.fn();
    const handle = bus.on("map:idle", fn);
    bus.emit("map:idle", { generation: 1 });
    handle.dispose();
    bus.emit("map:idle", { generation: 2 });
    expect(fn).toHaveBeenCalledOnce();
  });

  it("dispose duas vezes não é erro", () => {
    const bus = createEventBus<TestEvents>();
    const handle = bus.on("map:idle", vi.fn());
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
  });

  it("once dispara uma vez só", () => {
    const bus = createEventBus<TestEvents>();
    const fn = vi.fn();
    bus.once("map:idle", fn);
    bus.emit("map:idle", { generation: 1 });
    bus.emit("map:idle", { generation: 2 });
    expect(fn).toHaveBeenCalledOnce();
    expect(bus.listenerCount("map:idle")).toBe(0);
  });

  it("emit sem listener não faz nada", () => {
    const bus = createEventBus<TestEvents>();
    expect(() => bus.emit("map:idle", { generation: 1 })).not.toThrow();
  });

  describe("mutação durante o emit", () => {
    it("um listener que se remove durante o emit ainda recebe este emit", () => {
      const bus = createEventBus<TestEvents>();
      const calls: string[] = [];
      const h = bus.on("map:idle", () => {
        calls.push("auto-removido");
        h.dispose();
      });
      bus.on("map:idle", () => calls.push("segundo"));

      bus.emit("map:idle", { generation: 1 });
      expect(calls).toEqual(["auto-removido", "segundo"]);

      calls.length = 0;
      bus.emit("map:idle", { generation: 2 });
      expect(calls).toEqual(["segundo"]);
    });

    it("um listener registrado durante o emit NÃO recebe este emit", () => {
      // Comportamento definido pelo snapshot. Sem ele, a ordem de entrega
      // dependeria da ordem interna do Set — não determinística na prática.
      const bus = createEventBus<TestEvents>();
      const late = vi.fn();
      bus.on("map:idle", () => bus.on("map:idle", late));
      bus.emit("map:idle", { generation: 1 });
      expect(late).not.toHaveBeenCalled();
      bus.emit("map:idle", { generation: 2 });
      expect(late).toHaveBeenCalledOnce();
    });
  });

  describe("erro em listener", () => {
    it("os outros listeners ainda rodam, e o erro é relançado", () => {
      const bus = createEventBus<TestEvents>();
      const after = vi.fn();
      bus.on("map:idle", () => {
        throw new Error("listener quebrado");
      });
      bus.on("map:idle", after);

      expect(() => bus.emit("map:idle", { generation: 1 })).toThrow("listener quebrado");
      expect(after).toHaveBeenCalledOnce();
    });

    it("múltiplos erros vêm agregados", () => {
      const bus = createEventBus<TestEvents>();
      bus.on("map:idle", () => {
        throw new Error("um");
      });
      bus.on("map:idle", () => {
        throw new Error("dois");
      });

      try {
        bus.emit("map:idle", { generation: 1 });
        expect.unreachable("devia ter lançado");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toHaveLength(2);
      }
    });
  });

  describe("listenerCount e clear", () => {
    it("conta por evento", () => {
      const bus = createEventBus<TestEvents>();
      bus.on("map:idle", vi.fn());
      bus.on("map:idle", vi.fn());
      bus.on("selection:changed", vi.fn());
      expect(bus.listenerCount("map:idle")).toBe(2);
      expect(bus.listenerCount("selection:changed")).toBe(1);
      expect(bus.listenerCount("playhead:moved")).toBe(0);
    });

    it("clear(evento) limpa só aquele evento", () => {
      const bus = createEventBus<TestEvents>();
      bus.on("map:idle", vi.fn());
      bus.on("selection:changed", vi.fn());
      bus.clear("map:idle");
      expect(bus.listenerCount("map:idle")).toBe(0);
      expect(bus.listenerCount("selection:changed")).toBe(1);
    });

    it("clear() limpa tudo", () => {
      const bus = createEventBus<TestEvents>();
      bus.on("map:idle", vi.fn());
      bus.on("selection:changed", vi.fn());
      bus.clear();
      expect(bus.listenerCount("map:idle")).toBe(0);
      expect(bus.listenerCount("selection:changed")).toBe(0);
    });
  });
});
