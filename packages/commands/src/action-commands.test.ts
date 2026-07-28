import { createDocumentStore } from "@theatrum/document";
import {
  ActionInstanceDataSchema,
  createEmptyProjectDocument,
  type ActionInstanceData,
  type ProjectDocument,
} from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { createCommandBus, type CommandBus } from "./index.js";

function setup(): { bus: CommandBus; read: () => ProjectDocument; initial: ProjectDocument } {
  const initial = structuredClone(createEmptyProjectDocument());
  initial.paths["path_main"] = {
    id: "path_main",
    name: "Caminho principal",
    space: "geo",
    vertices: [
      { point: [55, 26], inHandle: null, outHandle: null },
      { point: [56, 26], inHandle: null, outHandle: null },
    ],
    closed: false,
    interpolation: "linear",
    geodesic: true,
  };
  const store = createDocumentStore(initial);
  return { bus: createCommandBus(store), read: () => store.get(), initial };
}

function advance(id = "act_advance"): ActionInstanceData {
  return ActionInstanceDataSchema.parse({
    id,
    type: "advance",
    enabled: true,
    mode: "live",
    startFrame: 12,
    params: {
      pathId: "path_main",
      speedKmh: 45,
      cycles: 1,
      autoOrient: true,
      showRoute: true,
      color: "#f2a13cff",
    },
  });
}

describe("comandos de Action", () => {
  it("adiciona, altera, desativa e remove com validação", () => {
    const { bus, read } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };
    const actions = () => read().compositions[0]?.nodes[composition.root]?.actions ?? [];

    const added = bus.dispatch({
      type: "action.add",
      payload: { ...location, action: advance() },
    });
    expect(added, added.ok ? "" : added.error.message).toMatchObject({ ok: true });
    expect(actions()).toHaveLength(1);

    expect(
      bus.dispatch({
        type: "action.set-params",
        payload: {
          ...location,
          actionId: "act_advance",
          params: { ...advance().params, speedKmh: 60 },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(actions()[0]?.params["speedKmh"]).toBe(60);

    expect(
      bus.dispatch({
        type: "action.set-enabled",
        payload: { ...location, actionId: "act_advance", enabled: false },
      }),
    ).toMatchObject({ ok: true });
    expect(actions()[0]?.enabled).toBe(false);

    expect(
      bus.dispatch({
        type: "action.remove",
        payload: { ...location, actionId: "act_advance" },
      }),
    ).toMatchObject({ ok: true });
    expect(actions()).toEqual([]);
  });

  it("rejeita id duplicado e undo restaura exatamente o documento", () => {
    const { bus, read, initial } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };

    bus.dispatch({ type: "action.add", payload: { ...location, action: advance() } });
    expect(
      bus.dispatch({ type: "action.add", payload: { ...location, action: advance() } }),
    ).toMatchObject({ ok: false });
    expect(bus.undo()).toBe(true);
    expect(read()).toEqual(initial);
  });
});
