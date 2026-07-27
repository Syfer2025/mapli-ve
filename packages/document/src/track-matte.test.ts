/**
 * O recorte por matte aponta um nó para outro, então é referência que pode ficar
 * pendurada ou circular. As duas coisas são barradas no validador, não em tempo de
 * desenho: um ciclo pediria a máscara de um nó que depende da própria máscara, e o
 * frame nunca fecharia.
 */

import { createEmptyProjectDocument, type Node, type ProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { createDocumentStore, DocumentValidationError, validateDocument } from "./index.js";

function documentWithNodes(): { document: ProjectDocument; ids: readonly string[] } {
  const base = createEmptyProjectDocument();
  const composition = base.compositions[0];
  if (composition === undefined) throw new Error("documento vazio sem composição");
  const root = composition.nodes["nd_root"];
  if (root === undefined) throw new Error("documento vazio sem raiz");

  const clone = (id: string): Node => ({ ...root, id, name: id, parent: null, children: [] });
  const document: ProjectDocument = {
    ...base,
    compositions: [
      {
        ...composition,
        nodes: {
          ...composition.nodes,
          nd_a: clone("nd_a"),
          nd_b: clone("nd_b"),
          nd_c: clone("nd_c"),
        },
      },
      ...base.compositions.slice(1),
    ],
  };
  return { document, ids: ["nd_a", "nd_b", "nd_c"] };
}

function issuesFor(mutate: (document: ProjectDocument) => void) {
  const { document } = documentWithNodes();
  mutate(document);
  const result = validateDocument(document);
  return result.ok ? [] : [...result.error];
}

describe("recorte por track matte", () => {
  it("origem existente nos quatro modos é aceita", () => {
    for (const mode of ["alpha", "alpha-inverted", "luma", "luma-inverted"] as const) {
      const issues = issuesFor((document) => {
        const node = document.compositions[0]?.nodes["nd_a"];
        if (node !== undefined) {
          (node as { trackMatte: unknown }).trackMatte = { source: "nd_b", mode };
        }
      });
      expect(issues).toEqual([]);
    }
  });

  it("origem inexistente vira diagnóstico apontando o campo", () => {
    const issues = issuesFor((document) => {
      const node = document.compositions[0]?.nodes["nd_a"];
      if (node !== undefined) {
        (node as { trackMatte: unknown }).trackMatte = { source: "nd_fantasma", mode: "alpha" };
      }
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("missing-matte-source");
    expect(issues[0]?.pointer).toBe("/compositions/0/nodes/nd_a/trackMatte/source");
  });

  it("recortar por si mesmo é ciclo, não recorte", () => {
    const issues = issuesFor((document) => {
      const node = document.compositions[0]?.nodes["nd_a"];
      if (node !== undefined) {
        (node as { trackMatte: unknown }).trackMatte = { source: "nd_a", mode: "alpha" };
      }
    });
    expect(issues.map((issue) => issue.code)).toEqual(["matte-cycle"]);
  });

  it("ciclo de dois e de três nós é detectado", () => {
    const pair = issuesFor((document) => {
      const nodes = document.compositions[0]?.nodes;
      if (nodes === undefined) return;
      (nodes["nd_a"] as { trackMatte: unknown }).trackMatte = { source: "nd_b", mode: "alpha" };
      (nodes["nd_b"] as { trackMatte: unknown }).trackMatte = { source: "nd_a", mode: "luma" };
    });
    expect(pair.every((issue) => issue.code === "matte-cycle")).toBe(true);
    expect(pair.length).toBeGreaterThan(0);

    const triple = issuesFor((document) => {
      const nodes = document.compositions[0]?.nodes;
      if (nodes === undefined) return;
      (nodes["nd_a"] as { trackMatte: unknown }).trackMatte = { source: "nd_b", mode: "alpha" };
      (nodes["nd_b"] as { trackMatte: unknown }).trackMatte = { source: "nd_c", mode: "alpha" };
      (nodes["nd_c"] as { trackMatte: unknown }).trackMatte = { source: "nd_a", mode: "alpha" };
    });
    expect(triple.every((issue) => issue.code === "matte-cycle")).toBe(true);
    expect(triple.length).toBeGreaterThan(0);
  });

  it("cadeia longa sem ciclo passa: dois nós podem usar a mesma origem", () => {
    const issues = issuesFor((document) => {
      const nodes = document.compositions[0]?.nodes;
      if (nodes === undefined) return;
      (nodes["nd_a"] as { trackMatte: unknown }).trackMatte = { source: "nd_c", mode: "alpha" };
      (nodes["nd_b"] as { trackMatte: unknown }).trackMatte = { source: "nd_c", mode: "luma" };
    });
    expect(issues).toEqual([]);
  });

  it("a store recusa a mutação que fecharia o ciclo, e o estado não muda", () => {
    const { document } = documentWithNodes();
    const store = createDocumentStore(document);
    const before = store.get();

    store.mutate((draft) => {
      const node = draft.compositions[0]?.nodes["nd_a"];
      if (node !== undefined) node.trackMatte = { source: "nd_b", mode: "alpha" };
    });
    expect(store.get().compositions[0]?.nodes["nd_a"]?.trackMatte?.source).toBe("nd_b");

    expect(() =>
      store.mutate((draft) => {
        const node = draft.compositions[0]?.nodes["nd_b"];
        if (node !== undefined) node.trackMatte = { source: "nd_a", mode: "alpha" };
      }),
    ).toThrow(DocumentValidationError);
    expect(store.get().compositions[0]?.nodes["nd_b"]?.trackMatte).toBeNull();
    expect(before.compositions[0]?.nodes["nd_a"]?.trackMatte).toBeNull();
  });

  it("nó novo nasce sem recorte", () => {
    const document = createEmptyProjectDocument();
    expect(document.compositions[0]?.nodes["nd_root"]?.trackMatte).toBeNull();
  });
});
