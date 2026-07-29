import { createEmptyProjectDocument, type Node, type ProjectDocument } from "@theatrum/schema";
import { describe, expect, it, vi } from "vitest";
import {
  DocumentValidationError,
  assertValidDocument,
  createDocumentStore,
  migrate,
  select,
  validateDocument,
} from "./index.js";

describe("DocumentStore", () => {
  it("mantém estado congelado, produz patches inversos e notifica uma vez", () => {
    const initial = createEmptyProjectDocument();
    const store = createDocumentStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);

    const result = store.mutate((draft) => {
      draft.name = "Operação";
    });

    expect(store.get().name).toBe("Operação");
    expect(Object.isFrozen(store.get())).toBe(true);
    expect(Object.isFrozen(store.get().settings)).toBe(true);
    expect(result.patches).toEqual([{ op: "replace", path: ["name"], value: "Operação" }]);
    expect(result.inverse).toEqual([{ op: "replace", path: ["name"], value: "Sem título" }]);
    expect(listener).toHaveBeenCalledTimes(1);

    store.apply(result.inverse);
    expect(store.get()).toEqual(initial);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("não publica alteração se a receita falhar ou violar invariante", () => {
    const store = createDocumentStore(createEmptyProjectDocument());
    const before = store.get();

    expect(() =>
      store.mutate((draft) => {
        draft.compositions[0]!.nodes["nd_root"]!.timeRange = { in: 20, out: 10 };
      }),
    ).toThrow(DocumentValidationError);
    expect(store.get()).toBe(before);

    expect(() =>
      store.mutate(() => {
        throw new Error("interrompido");
      }),
    ).toThrow("interrompido");
    expect(store.get()).toBe(before);
  });

  it("replace valida e emite um patch de raiz reversível", () => {
    const store = createDocumentStore(createEmptyProjectDocument());
    const replacement = createEmptyProjectDocument({ id: "prj_other", name: "Outro" });
    const result = store.replace(replacement);
    expect(store.get()).toEqual(replacement);
    store.apply(result.inverse);
    expect(store.get()).toEqual(createEmptyProjectDocument());
  });
});

describe("validação relacional", () => {
  it("detecta inconsistência bidirecional e ciclo por JSON Pointer", () => {
    const document = createDocumentWithTwoNodes();
    const composition = document.compositions[0]!;
    composition.nodes["nd_a"]!.parent = "nd_b";
    composition.nodes["nd_a"]!.children = ["nd_b"];
    composition.nodes["nd_b"]!.parent = "nd_a";
    composition.nodes["nd_b"]!.children = ["nd_a"];
    composition.nodes["nd_root"]!.children = [];

    const result = validateDocument(document);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((issue) => issue.code === "parent-cycle")).toBe(true);
    expect(result.error.every((issue) => issue.pointer.startsWith("/"))).toBe(true);
  });

  it("rejeita referências órfãs e aceita documento mínimo", () => {
    expect(validateDocument(createEmptyProjectDocument()).ok).toBe(true);
    const document = createDocumentWithTwoNodes();
    document.compositions[0]!.nodes["nd_a"]!.props = {
      assetId: "ast_missing",
      pathId: "pth_missing",
    };
    const result = validateDocument(document);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["missing-asset", "missing-path"]),
    );
  });

  /**
   * `props.assetId` guarda o **`src`** do asset, não o `id`.
   *
   * O contrato tinha dois lados discordando e **nenhum teste**, o que é exatamente por
   * que o defeito sobreviveu: os leitores (palco, camada 3D, primitivas de imagem) e o
   * criador de nó canônico usam `src`; o validador comparava contra `id` e o `select` do
   * Inspector gravava `id`. Escolher um modelo no Inspector deixava o palco vazio com
   * `asset ausente: ast_…`, e o validador acusava justamente o caso correto.
   *
   * Este teste trava os dois sentidos, que é o mínimo para um contrato com dois lados.
   */
  it("aceita assetId que é o src do asset e recusa o id", () => {
    const comSrc = createDocumentWithTwoNodes();
    comSrc.assets = [
      {
        id: "ast_um",
        name: "F/A-18",
        kind: "model",
        src: "assets/ab/abcdef.glb",
        bytes: 10,
        tags: [],
        meta: {},
      },
    ] as never;
    comSrc.compositions[0]!.nodes["nd_a"]!.props = { assetId: "assets/ab/abcdef.glb" };
    expect(validateDocument(comSrc).ok).toBe(true);

    const comId = structuredClone(comSrc);
    comId.compositions[0]!.nodes["nd_a"]!.props = { assetId: "ast_um" };
    const result = validateDocument(comId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((issue) => issue.code === "missing-asset")).toBe(true);
  });

  /** Sem asset é estado legítimo: um `model3d` recém-criado nasce com a prop vazia. */
  it("assetId vazio não é referência órfã", () => {
    const document = createDocumentWithTwoNodes();
    document.compositions[0]!.nodes["nd_a"]!.props = { assetId: "" };
    expect(validateDocument(document).ok).toBe(true);
  });

  it("assertValidDocument relata o primeiro ponteiro", () => {
    const raw = { ...createEmptyProjectDocument(), name: 42 };
    expect(() => assertValidDocument(raw)).toThrow(/\/name/);
  });
});

describe("seletores memoizados", () => {
  it("indexa nós, hierarquia e propriedades sem varredura repetida", () => {
    const document = createDocumentWithTwoNodes();
    const children = select.children(document, "nd_root");
    expect(children.map((node) => node.id)).toEqual(["nd_a"]);
    expect(select.children(document, "nd_root")).toBe(children);
    expect(select.ancestors(document, "nd_b").map((node) => node.id)).toEqual(["nd_a", "nd_root"]);
    expect(select.descendants(document, "nd_root").map((node) => node.id)).toEqual([
      "nd_a",
      "nd_b",
    ]);
    expect(select.compositionOfNode(document, "nd_b")?.id).toBe("cmp_main");
    expect(select.property(document, { nodeId: "nd_a", path: "transform.opacity" })?.value).toBe(1);
    expect(select.property(document, { nodeId: "nd_a", path: "/transform/opacity" })?.value).toBe(
      1,
    );
  });
});

describe("migração", () => {
  it("falha de forma acionável para schemaVersion futura", () => {
    const result = migrate({ ...createEmptyProjectDocument(), schemaVersion: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("future-version");
    expect(result.error.message).toContain("99");
    expect(result.error.message).toContain("Atualize");
  });
});

function createDocumentWithTwoNodes(): ProjectDocument {
  const document = structuredClone(createEmptyProjectDocument());
  const composition = document.compositions[0]!;
  const root = composition.nodes["nd_root"]!;
  const first = cloneNode(root, "nd_a", "nd_root");
  const second = cloneNode(root, "nd_b", "nd_a");
  first.children = ["nd_b"];
  root.children = ["nd_a"];
  composition.nodes["nd_a"] = first;
  composition.nodes["nd_b"] = second;
  return document;
}

function cloneNode(source: Node, id: string, parent: string): Node {
  const node = structuredClone(source);
  node.id = id;
  node.name = id;
  node.parent = parent;
  node.children = [];
  return node;
}
