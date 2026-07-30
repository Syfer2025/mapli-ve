import { createDocumentStore } from "@theatrum/document";
import { createEmptyProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { createCommandBus } from "./index.js";

describe("comandos de paleta", () => {
  it("adiciona uma paleta validada e desfaz exatamente", () => {
    const initial = createEmptyProjectDocument();
    const store = createDocumentStore(initial);
    const bus = createCommandBus(store);
    const palette = {
      id: "hormuz",
      name: "Estreito de Hormuz",
      colors: { "cor-01": "#1f5268", "cor-02": "#b99c68" },
    };

    expect(
      bus.dispatch({ type: "palette.add", payload: { palette }, source: "user" }),
    ).toMatchObject({ ok: true });
    expect(store.get().palettes).toEqual([palette]);
    expect(bus.undo()).toBe(true);
    expect(store.get()).toEqual(initial);
  });

  it("rejeita id duplicado e cor inválida", () => {
    const store = createDocumentStore(createEmptyProjectDocument());
    const bus = createCommandBus(store);
    const palette = {
      id: "hormuz",
      name: "Estreito de Hormuz",
      colors: { mar: "#1f5268" },
    };
    expect(bus.dispatch({ type: "palette.add", payload: { palette } })).toMatchObject({ ok: true });
    expect(bus.dispatch({ type: "palette.add", payload: { palette } })).toMatchObject({
      ok: false,
    });
    expect(
      bus.dispatch({
        type: "palette.add",
        payload: { palette: { id: "invalida", name: "Inválida", colors: { x: "azul" } } },
      }),
    ).toMatchObject({ ok: false });
  });
});
