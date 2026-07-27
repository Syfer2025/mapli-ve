/**
 * Comandos `path.*` e `behavior.*` — a Fase 5 precisa deles para que um caminho
 * desenhado no mapa possa ser atribuído a um objeto, com undo exato.
 */

import { createDocumentStore } from "@theatrum/document";
import { createEmptyProjectDocument, type PathData, type ProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { createCommandBus, type CommandBus } from "./index.js";

const ROUTE: PathData = {
  id: "pt_route",
  name: "Varsóvia → Leningrado",
  space: "geo",
  vertices: [
    { point: [21.0122, 52.2297], inHandle: null, outHandle: [5, 2] },
    { point: [30.3158, 59.9391], inHandle: [-4, -3], outHandle: null },
  ],
  closed: false,
  interpolation: "bezier",
  geodesic: false,
};

function setup(): { bus: CommandBus; read: () => ProjectDocument; initial: ProjectDocument } {
  const initial = createEmptyProjectDocument();
  const store = createDocumentStore(initial);
  return { bus: createCommandBus(store), read: () => store.get(), initial };
}

function motionPath(pathId: string, id = "bh_path") {
  return {
    id,
    type: "motion-path",
    enabled: true,
    params: {
      pathId,
      progress: { value: 0, keyframes: [], expression: null },
      autoOrient: true,
      orientOffset: 0,
      banking: 0,
      offset: [0, 0],
      loop: false,
    },
  };
}

describe("comandos de caminho", () => {
  it("cria, renomeia, edita vértices e altera flags", () => {
    const { bus, read } = setup();

    expect(bus.dispatch({ type: "path.create", payload: { path: ROUTE } })).toMatchObject({
      ok: true,
    });
    expect(read().paths["pt_route"]?.vertices).toHaveLength(2);

    expect(
      bus.dispatch({ type: "path.rename", payload: { pathId: "pt_route", name: "Ofensiva" } }),
    ).toMatchObject({ ok: true });
    expect(read().paths["pt_route"]?.name).toBe("Ofensiva");

    const withMiddle = [
      ROUTE.vertices[0]!,
      { point: [26, 57] as [number, number], inHandle: null, outHandle: null },
      ROUTE.vertices[1]!,
    ];
    expect(
      bus.dispatch({
        type: "path.set-vertices",
        payload: { pathId: "pt_route", vertices: withMiddle },
      }),
    ).toMatchObject({ ok: true });
    expect(read().paths["pt_route"]?.vertices).toHaveLength(3);

    expect(
      bus.dispatch({
        type: "path.set-flags",
        payload: { pathId: "pt_route", flags: { geodesic: true, interpolation: "catmull-rom" } },
      }),
    ).toMatchObject({ ok: true });
    expect(read().paths["pt_route"]?.geodesic).toBe(true);
    expect(read().paths["pt_route"]?.interpolation).toBe("catmull-rom");
  });

  it("undo devolve o documento exatamente ao estado inicial", () => {
    const { bus, read, initial } = setup();
    bus.dispatch({ type: "path.create", payload: { path: ROUTE } });
    bus.dispatch({
      type: "path.set-vertices",
      payload: {
        pathId: "pt_route",
        vertices: [{ point: [10, 10], inHandle: null, outHandle: null }],
      },
    });
    bus.dispatch({ type: "path.delete", payload: { pathId: "pt_route" } });

    expect(bus.undo()).toBe(true);
    expect(read().paths["pt_route"]?.vertices).toHaveLength(1);
    expect(bus.undo()).toBe(true);
    expect(read().paths["pt_route"]?.vertices).toHaveLength(2);
    expect(bus.undo()).toBe(true);
    expect(read()).toEqual(initial);
  });

  it("rejeita id duplicado e caminho inexistente", () => {
    const { bus } = setup();
    bus.dispatch({ type: "path.create", payload: { path: ROUTE } });
    expect(bus.dispatch({ type: "path.create", payload: { path: ROUTE } })).toMatchObject({
      ok: false,
    });
    expect(
      bus.dispatch({ type: "path.rename", payload: { pathId: "pt_nada", name: "x" } }),
    ).toMatchObject({ ok: false });
    expect(bus.dispatch({ type: "path.delete", payload: { pathId: "pt_nada" } })).toMatchObject({
      ok: false,
    });
  });

  it("recusa caminho sem vértice e flags vazias", () => {
    const { bus } = setup();
    bus.dispatch({ type: "path.create", payload: { path: ROUTE } });
    expect(
      bus.dispatch({ type: "path.set-vertices", payload: { pathId: "pt_route", vertices: [] } }),
    ).toMatchObject({ ok: false });
    expect(
      bus.dispatch({ type: "path.set-flags", payload: { pathId: "pt_route", flags: {} } }),
    ).toMatchObject({ ok: false });
  });

  it("excluir caminho em uso é rejeitado pela integridade referencial", () => {
    const { bus, read } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };
    bus.dispatch({ type: "path.create", payload: { path: ROUTE } });
    bus.dispatch({
      type: "behavior.add",
      payload: { ...location, behavior: motionPath("pt_route") },
    });

    // O validador de documento da Fase 3 não permite `pathId` pendurado, então o
    // caminho não pode sair enquanto alguém o referencia. Melhor assim: o erro
    // aparece no comando, não como comportamento silenciosamente quebrado.
    const rejected = bus.dispatch({ type: "path.delete", payload: { pathId: "pt_route" } });
    expect(rejected).toMatchObject({ ok: false });
    expect(read().paths["pt_route"]).toBeDefined();
    expect(read().compositions[0]?.nodes[composition.root]?.behaviors).toHaveLength(1);

    // Removido o comportamento, a exclusão passa.
    bus.dispatch({ type: "behavior.remove", payload: { ...location, behaviorId: "bh_path" } });
    expect(bus.dispatch({ type: "path.delete", payload: { pathId: "pt_route" } })).toMatchObject({
      ok: true,
    });
    expect(read().paths["pt_route"]).toBeUndefined();
  });

  it("comportamento que aponta para caminho inexistente é rejeitado na origem", () => {
    const { bus, read } = setup();
    const composition = read().compositions[0]!;
    const rejected = bus.dispatch({
      type: "behavior.add",
      payload: {
        compositionId: composition.id,
        nodeId: composition.root,
        behavior: motionPath("pt_fantasma"),
      },
    });
    expect(rejected).toMatchObject({ ok: false });
    expect(read().compositions[0]?.nodes[composition.root]?.behaviors).toHaveLength(0);
  });
});

describe("comandos de comportamento", () => {
  it("adiciona na posição pedida, altera params, desativa e remove", () => {
    const { bus, read } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };

    bus.dispatch({ type: "path.create", payload: { path: ROUTE } });
    bus.dispatch({
      type: "behavior.add",
      payload: { ...location, behavior: motionPath("pt_route") },
    });
    bus.dispatch({
      type: "behavior.add",
      payload: {
        ...location,
        index: 0,
        behavior: {
          id: "bh_wiggle",
          type: "wiggle",
          enabled: true,
          params: { amplitude: [4, 4], frequency: 2, octaves: 1, seed: 3, rotationAmplitude: 0 },
        },
      },
    });

    const behaviors = () => read().compositions[0]?.nodes[composition.root]?.behaviors ?? [];
    expect(behaviors().map((entry) => entry.id)).toEqual(["bh_wiggle", "bh_path"]);

    expect(
      bus.dispatch({
        type: "behavior.set-params",
        payload: {
          ...location,
          behaviorId: "bh_path",
          params: { ...motionPath("pt_route").params, banking: 12 },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(behaviors()[1]?.params["banking"]).toBe(12);

    expect(
      bus.dispatch({
        type: "behavior.set-enabled",
        payload: { ...location, behaviorId: "bh_wiggle", enabled: false },
      }),
    ).toMatchObject({ ok: true });
    expect(behaviors()[0]?.enabled).toBe(false);

    expect(
      bus.dispatch({
        type: "behavior.remove",
        payload: { ...location, behaviorId: "bh_wiggle" },
      }),
    ).toMatchObject({ ok: true });
    expect(behaviors().map((entry) => entry.id)).toEqual(["bh_path"]);
  });

  it("rejeita id duplicado, nó inexistente e comportamento inexistente", () => {
    const { bus, read } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };

    bus.dispatch({
      type: "behavior.add",
      payload: { ...location, behavior: motionPath("pt_route") },
    });
    expect(
      bus.dispatch({
        type: "behavior.add",
        payload: { ...location, behavior: motionPath("pt_route") },
      }),
    ).toMatchObject({ ok: false });
    expect(
      bus.dispatch({
        type: "behavior.add",
        payload: { ...location, nodeId: "nd_nada", behavior: motionPath("pt_route", "bh_2") },
      }),
    ).toMatchObject({ ok: false });
    expect(
      bus.dispatch({
        type: "behavior.set-enabled",
        payload: { ...location, behaviorId: "bh_nada", enabled: false },
      }),
    ).toMatchObject({ ok: false });
  });

  it("undo de comportamento restaura o documento inicial", () => {
    const { bus, read, initial } = setup();
    const composition = read().compositions[0]!;
    const location = { compositionId: composition.id, nodeId: composition.root };

    bus.dispatch({ type: "path.create", payload: { path: ROUTE } });
    bus.dispatch({
      type: "behavior.add",
      payload: { ...location, behavior: motionPath("pt_route") },
    });
    bus.dispatch({
      type: "behavior.set-enabled",
      payload: { ...location, behaviorId: "bh_path", enabled: false },
    });
    expect(bus.undo()).toBe(true);
    expect(bus.undo()).toBe(true);
    expect(bus.undo()).toBe(true);
    expect(read()).toEqual(initial);
  });
});
