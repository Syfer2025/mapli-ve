import { createDocumentStore } from "@theatrum/document";
import {
  createEmptyProjectDocument,
  type Composition,
  type Node,
  type ProjectDocument,
} from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { createCommandBus, type CommandBus } from "./index.js";

describe("CommandBus", () => {
  it("restaura exatamente o documento inicial depois de 50 operações e 50 undo", () => {
    const initial = createEmptyProjectDocument();
    const document = createDocumentStore(initial);
    const bus = createCommandBus(document);

    for (let index = 1; index <= 50; index += 1) {
      expectOk(
        bus,
        command("project.rename", {
          name: `Projeto ${String(index).padStart(2, "0")}`,
        }),
      );
    }

    expect(bus.history.entries()).toHaveLength(50);
    expect(bus.history.cursor()).toBe(49);
    expect(document.get()).not.toEqual(initial);

    for (let index = 0; index < 50; index += 1) {
      expect(bus.undo()).toBe(true);
    }

    expect(bus.undo()).toBe(false);
    expect(bus.history.cursor()).toBe(-1);
    expect(bus.history.canRedo()).toBe(true);
    expect(document.get()).toEqual(initial);
  });

  it("refaz comandos e descarta o ramo futuro depois de uma nova edição", () => {
    const document = createDocumentStore(createEmptyProjectDocument());
    const bus = createCommandBus(document);

    expectOk(bus, command("project.rename", { name: "Versão A" }));
    expectOk(bus, command("project.rename", { name: "Versão B" }));
    expect(bus.undo()).toBe(true);
    expect(document.get().name).toBe("Versão A");

    expect(bus.redo()).toBe(true);
    expect(document.get().name).toBe("Versão B");
    expect(bus.undo()).toBe(true);

    expectOk(bus, command("project.rename", { name: "Ramo C" }));

    expect(document.get().name).toBe("Ramo C");
    expect(bus.history.entries()).toHaveLength(2);
    expect(bus.history.cursor()).toBe(1);
    expect(bus.history.canRedo()).toBe(false);
    expect(bus.redo()).toBe(false);
  });

  it("agrupa vários comandos em uma única entrada atômica", () => {
    const initial = createEmptyProjectDocument();
    const document = createDocumentStore(initial);
    const bus = createCommandBus(document);
    let firstDeferred = false;
    let secondDeferred = false;

    const result = bus.transaction("Preparar composição", () => {
      const first = bus.dispatch(command("project.rename", { name: "Operação Barbarossa" }));
      const second = bus.dispatch(
        command("composition.set-seed", {
          compositionId: "cmp_main",
          seed: 1941,
        }),
      );
      firstDeferred = first.ok && first.deferred;
      secondDeferred = second.ok && second.deferred;
    });

    expect(result).toMatchObject({ ok: true, deferred: false, label: "Preparar composição" });
    expect(firstDeferred).toBe(true);
    expect(secondDeferred).toBe(true);
    expect(bus.history.entries()).toHaveLength(1);
    expect(bus.history.entries()[0]).toMatchObject({
      label: "Preparar composição",
      commandTypes: ["project.rename", "composition.set-seed"],
    });
    expect(document.get().name).toBe("Operação Barbarossa");
    expect(mainComposition(document.get()).seed).toBe(1941);

    expect(bus.undo()).toBe(true);
    expect(document.get()).toEqual(initial);
  });

  it("rejeita payload inválido e referência inexistente sem qualquer mutação", () => {
    const document = createDocumentStore(createEmptyProjectDocument());
    const bus = createCommandBus(document);
    const before = document.get();

    const malformed = bus.dispatch({
      type: "node.rename",
      payload: { compositionId: "cmp_main", nodeId: "nd_root" },
    });
    expect(malformed).toMatchObject({
      ok: false,
      error: { code: "invalid-command" },
    });
    expect(document.get()).toBe(before);
    expect(bus.history.entries()).toHaveLength(0);

    const missingNode = bus.dispatch(
      command("node.rename", {
        compositionId: "cmp_main",
        nodeId: "nd_missing",
        name: "Fantasma",
      }),
    );
    expect(missingNode).toMatchObject({
      ok: false,
      error: { code: "rejected" },
    });
    expect(document.get()).toBe(before);
    expect(bus.history.entries()).toHaveLength(0);
  });

  it("cria, renomeia, reparenta e exclui uma subárvore de nós", () => {
    const initial = createEmptyProjectDocument();
    const document = createDocumentStore(initial);
    const bus = createCommandBus(document);
    const template = mainComposition(initial).nodes["nd_root"];
    if (template === undefined) throw new Error("Fixture sem nó raiz.");

    expectOk(
      bus,
      command("node.create", {
        compositionId: "cmp_main",
        parentId: "nd_root",
        node: makeNode(template, "nd_group", "Grupo"),
      }),
    );
    expectOk(
      bus,
      command("node.create", {
        compositionId: "cmp_main",
        parentId: "nd_root",
        node: makeNode(template, "nd_unit", "Unidade"),
      }),
    );
    expectOk(
      bus,
      command("node.rename", {
        compositionId: "cmp_main",
        nodeId: "nd_unit",
        name: "1º Exército",
      }),
    );
    expectOk(
      bus,
      command("node.reparent", {
        compositionId: "cmp_main",
        nodeId: "nd_unit",
        parentId: "nd_group",
      }),
    );

    let composition = mainComposition(document.get());
    expect(composition.nodes["nd_root"]?.children).toEqual(["nd_group"]);
    expect(composition.nodes["nd_group"]?.children).toEqual(["nd_unit"]);
    expect(composition.nodes["nd_unit"]).toMatchObject({
      name: "1º Exército",
      parent: "nd_group",
    });

    expectOk(
      bus,
      command("node.delete", {
        compositionId: "cmp_main",
        nodeId: "nd_group",
      }),
    );
    composition = mainComposition(document.get());
    expect(composition.nodes["nd_group"]).toBeUndefined();
    expect(composition.nodes["nd_unit"]).toBeUndefined();
    expect(composition.nodes["nd_root"]?.children).toEqual([]);

    expect(bus.undo()).toBe(true);
    composition = mainComposition(document.get());
    expect(composition.nodes["nd_group"]?.children).toEqual(["nd_unit"]);
    expect(composition.nodes["nd_unit"]?.parent).toBe("nd_group");
  });

  it("edita composição, propriedade animável e ciclo de vida de keyframes", () => {
    const document = createDocumentStore(createEmptyProjectDocument());
    const bus = createCommandBus(document);
    const location = {
      compositionId: "cmp_main",
      target: { kind: "node", nodeId: "nd_root" },
      path: ["transform", "opacity"],
    } as const;

    expectOk(
      bus,
      command("composition.set-resolution", {
        compositionId: "cmp_main",
        width: 3840,
        height: 2160,
        pixelAspect: 1.25,
      }),
    );
    expectOk(bus, command("property.set", { ...location, value: 0.75 }));
    expectOk(
      bus,
      command("property.set-expression", {
        ...location,
        expression: "value * 0.9",
      }),
    );
    expectOk(
      bus,
      command("keyframe.set", {
        ...location,
        keyframe: keyframe("kf_20", 20, 0.2),
      }),
    );
    expectOk(
      bus,
      command("keyframe.set", {
        ...location,
        keyframe: keyframe("kf_10", 10, 0.8),
      }),
    );

    let composition = mainComposition(document.get());
    let opacity = rootNode(composition).transform.opacity;
    expect(composition).toMatchObject({ width: 3840, height: 2160, pixelAspect: 1.25 });
    expect(opacity.value).toBe(0.75);
    expect(opacity.expression).toBe("value * 0.9");
    expect(opacity.keyframes.map(({ id, frame }) => [id, frame])).toEqual([
      ["kf_10", 10],
      ["kf_20", 20],
    ]);

    expectOk(
      bus,
      command("keyframe.move", {
        ...location,
        keyframeId: "kf_20",
        frame: 5,
      }),
    );
    expectOk(
      bus,
      command("keyframe.set-easing", {
        ...location,
        keyframeId: "kf_20",
        out: { kind: "hold" },
      }),
    );
    expectOk(
      bus,
      command("keyframe.remove", {
        ...location,
        keyframeId: "kf_10",
      }),
    );

    composition = mainComposition(document.get());
    opacity = rootNode(composition).transform.opacity;
    expect(opacity.keyframes).toHaveLength(1);
    expect(opacity.keyframes[0]).toMatchObject({
      id: "kf_20",
      frame: 5,
      out: { kind: "hold" },
    });

    expectOk(bus, command("keyframe.clear", location));
    expect(rootNode(mainComposition(document.get())).transform.opacity.keyframes).toEqual([]);
  });

  it("inicializa uma prop opcional sem tornar property.set permissivo a typo", () => {
    const document = createDocumentStore(createEmptyProjectDocument());
    const bus = createCommandBus(document);
    const location = {
      compositionId: "cmp_main",
      target: { kind: "node", nodeId: "nd_root" },
      path: ["props", "legacyStrength"],
    } as const;

    const typo = bus.dispatch(command("property.set", { ...location, value: 0.8 }));
    expect(typo).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(rootNode(mainComposition(document.get())).props["legacyStrength"]).toBeUndefined();

    expectOk(
      bus,
      command("property.initialize", {
        ...location,
        property: { value: 0.3, keyframes: [], expression: null },
      }),
    );
    expect(rootNode(mainComposition(document.get())).props["legacyStrength"]).toEqual({
      value: 0.3,
      keyframes: [],
      expression: null,
    });
    expect(bus.history.entries()[0]?.commandTypes).toEqual(["property.initialize"]);

    const duplicate = bus.dispatch(
      command("property.initialize", {
        ...location,
        property: { value: 0.9, keyframes: [], expression: null },
      }),
    );
    expect(duplicate).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(bus.history.entries()).toHaveLength(1);

    expect(bus.undo()).toBe(true);
    expect(rootNode(mainComposition(document.get())).props["legacyStrength"]).toBeUndefined();
  });

  it("agrupa inicialização e primeiro keyframe em um undo atômico", () => {
    const document = createDocumentStore(createEmptyProjectDocument());
    const bus = createCommandBus(document);
    const location = {
      compositionId: "cmp_main",
      target: { kind: "node", nodeId: "nd_root" },
      path: ["props", "legacyStrength"],
    } as const;

    const result = bus.transaction("Criar primeiro keyframe", () => {
      bus.dispatch(
        command("property.initialize", {
          ...location,
          property: { value: 0.3, keyframes: [], expression: null },
        }),
      );
      bus.dispatch(
        command("keyframe.set", {
          ...location,
          keyframe: keyframe("kf_12", 12, 0.3),
        }),
      );
    });

    expect(result).toMatchObject({ ok: true, deferred: false });
    expect(bus.history.entries()).toHaveLength(1);
    expect(bus.history.entries()[0]?.commandTypes).toEqual(["property.initialize", "keyframe.set"]);
    expect(rootNode(mainComposition(document.get())).props["legacyStrength"]).toMatchObject({
      value: 0.3,
      keyframes: [{ id: "kf_12", frame: 12, value: 0.3 }],
    });

    expect(bus.undo()).toBe(true);
    expect(rootNode(mainComposition(document.get())).props["legacyStrength"]).toBeUndefined();
  });

  it("cria, duplica, renomeia e exclui composições válidas", () => {
    const document = createDocumentStore(createEmptyProjectDocument());
    const bus = createCommandBus(document);
    const second = standaloneComposition("cmp_second", "nd_second", "Segunda");
    const copy = standaloneComposition("cmp_copy", "nd_copy", "Cópia");

    expectOk(bus, command("composition.create", { composition: second }));
    expectOk(bus, command("composition.duplicate", { composition: copy }));
    expectOk(
      bus,
      command("composition.rename", {
        compositionId: "cmp_copy",
        name: "Cópia revisada",
      }),
    );
    expect(document.get().compositions.map(({ id, name }) => [id, name])).toEqual([
      ["cmp_main", "Principal"],
      ["cmp_second", "Segunda"],
      ["cmp_copy", "Cópia revisada"],
    ]);

    expectOk(
      bus,
      command("composition.delete", {
        compositionId: "cmp_second",
      }),
    );
    expect(document.get().compositions.map(({ id }) => id)).toEqual(["cmp_main", "cmp_copy"]);
  });
});

function expectOk(bus: CommandBus, value: unknown): void {
  expect(bus.dispatch(value)).toMatchObject({ ok: true, deferred: false });
}

function command(type: string, payload: unknown): { type: string; payload: unknown } {
  return { type, payload };
}

function mainComposition(document: ProjectDocument): Composition {
  const composition = document.compositions.find(({ id }) => id === "cmp_main");
  if (composition === undefined) throw new Error("Fixture sem composição principal.");
  return composition;
}

function rootNode(composition: Composition): Node {
  const node = composition.nodes[composition.root];
  if (node === undefined) throw new Error("Composição sem nó raiz.");
  return node;
}

function makeNode(template: Node, id: string, name: string): Node {
  return {
    ...structuredClone(template),
    id,
    name,
    parent: null,
    children: [],
  };
}

function keyframe(id: string, frame: number, value: number) {
  return {
    id,
    frame,
    value,
    in: { kind: "linear" as const },
    out: { kind: "linear" as const },
  };
}

function standaloneComposition(id: string, rootNodeId: string, name: string): Composition {
  const project = createEmptyProjectDocument({
    id: `prj_${id}`,
    compositionId: id,
    compositionName: name,
    rootNodeId,
  });
  const composition = project.compositions[0];
  if (composition === undefined) throw new Error("Factory sem composição.");
  return composition;
}
