/**
 * Comandos `effect.*` — a Fase 6 precisa deles para que o painel de efeitos
 * empilhe, edite, desative e remova efeitos num nó com undo exato.
 */

import { createDocumentStore } from "@theatrum/document";
import {
  createEmptyProjectDocument,
  EffectInstanceDataSchema,
  type EffectInstanceData,
  type ProjectDocument,
} from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { createCommandBus, type CommandBus } from "./index.js";

function setup(): { bus: CommandBus; read: () => ProjectDocument; initial: ProjectDocument } {
  const initial = createEmptyProjectDocument();
  const store = createDocumentStore(initial);
  return { bus: createCommandBus(store), read: () => store.get(), initial };
}

function explosion(id = "fx_boom"): EffectInstanceData {
  return EffectInstanceDataSchema.parse({
    id,
    type: "explosion",
    enabled: true,
    params: {
      count: { value: 5000, keyframes: [], expression: null },
      scale: { value: 1, keyframes: [], expression: null },
      lifetime: { value: 42, keyframes: [], expression: null },
      intensity: { value: 1, keyframes: [], expression: null },
      tint: { value: "#ffffffff", keyframes: [], expression: null },
    },
  });
}

function glow(id = "fx_glow"): EffectInstanceData {
  return EffectInstanceDataSchema.parse({
    id,
    type: "glow",
    enabled: true,
    params: {
      radius: { value: 14, keyframes: [], expression: null },
      strength: { value: 1.4, keyframes: [], expression: null },
      tint: { value: "#ffd9a0ff", keyframes: [], expression: null },
    },
  });
}

describe("comandos de efeito", () => {
  it("adiciona na posição pedida, altera params, desativa e remove", () => {
    const { bus, read } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };

    expect(
      bus.dispatch({ type: "effect.add", payload: { ...location, effect: explosion() } }),
    ).toMatchObject({ ok: true });
    expect(
      bus.dispatch({
        type: "effect.add",
        payload: { ...location, index: 0, effect: glow() },
      }),
    ).toMatchObject({ ok: true });

    const effects = () => read().compositions[0]?.nodes[composition.root]?.effects ?? [];
    expect(effects().map((entry) => entry.id)).toEqual(["fx_glow", "fx_boom"]);

    expect(
      bus.dispatch({
        type: "effect.set-params",
        payload: {
          ...location,
          effectId: "fx_boom",
          params: { ...explosion().params, scale: { value: 2, keyframes: [], expression: null } },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(effects()[1]?.params["scale"]).toMatchObject({ value: 2 });

    expect(
      bus.dispatch({
        type: "effect.set-enabled",
        payload: { ...location, effectId: "fx_glow", enabled: false },
      }),
    ).toMatchObject({ ok: true });
    expect(effects()[0]?.enabled).toBe(false);

    expect(
      bus.dispatch({ type: "effect.remove", payload: { ...location, effectId: "fx_glow" } }),
    ).toMatchObject({ ok: true });
    expect(effects().map((entry) => entry.id)).toEqual(["fx_boom"]);
  });

  it("rejeita id duplicado, nó inexistente e efeito inexistente", () => {
    const { bus, read } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };

    bus.dispatch({ type: "effect.add", payload: { ...location, effect: explosion() } });
    expect(
      bus.dispatch({ type: "effect.add", payload: { ...location, effect: explosion() } }),
    ).toMatchObject({ ok: false });
    expect(
      bus.dispatch({
        type: "effect.add",
        payload: { ...location, nodeId: "nd_nada", effect: explosion("fx_2") },
      }),
    ).toMatchObject({ ok: false });
    expect(
      bus.dispatch({
        type: "effect.set-enabled",
        payload: { ...location, effectId: "fx_nada", enabled: false },
      }),
    ).toMatchObject({ ok: false });
    expect(
      bus.dispatch({ type: "effect.remove", payload: { ...location, effectId: "fx_nada" } }),
    ).toMatchObject({ ok: false });
  });

  it("undo de efeito restaura o documento inicial", () => {
    const { bus, read, initial } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };

    bus.dispatch({ type: "effect.add", payload: { ...location, effect: explosion() } });
    bus.dispatch({
      type: "effect.set-enabled",
      payload: { ...location, effectId: "fx_boom", enabled: false },
    });
    bus.dispatch({ type: "effect.remove", payload: { ...location, effectId: "fx_boom" } });

    expect(bus.undo()).toBe(true);
    expect(read().compositions[0]?.nodes[composition.root]?.effects).toHaveLength(1);
    expect(bus.undo()).toBe(true);
    expect(read().compositions[0]?.nodes[composition.root]?.effects[0]?.enabled).toBe(true);
    expect(bus.undo()).toBe(true);
    expect(read()).toEqual(initial);
  });
});
