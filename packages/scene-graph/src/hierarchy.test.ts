import { createEmptyProjectDocument, type Composition, type Node } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { SceneGraphInvariantError } from "./errors.js";
import {
  ancestorIds,
  assertValidHierarchy,
  descendantIds,
  isAncestor,
  orderedChildren,
  topologicalOrder,
  validateHierarchy,
} from "./hierarchy.js";

function composition(): Composition {
  const document = createEmptyProjectDocument();
  const source = document.compositions[0];
  if (source === undefined) throw new Error("fixture sem composição");
  return structuredClone(source);
}

function childNode(base: Node, id: string, parent: string, children: string[] = []): Node {
  return {
    ...structuredClone(base),
    id,
    name: id,
    parent,
    children,
    props: {},
  };
}

function validTree(): Composition {
  const result = composition();
  const root = result.nodes[result.root];
  if (root === undefined) throw new Error("fixture sem raiz");
  root.children = ["nd_back", "nd_front"];
  result.nodes["nd_back"] = childNode(root, "nd_back", root.id, ["nd_nested"]);
  result.nodes["nd_nested"] = childNode(root, "nd_nested", "nd_back");
  result.nodes["nd_front"] = childNode(root, "nd_front", root.id);
  return result;
}

describe("hierarchy invariants", () => {
  it("aceita a composição mínima canônica", () => {
    const result = composition();
    expect(validateHierarchy(result)).toEqual([]);
    expect(() => assertValidHierarchy(result)).not.toThrow();
  });

  it("preserva a ordem de desenho de children[] em pré-ordem", () => {
    const result = validTree();
    expect(topologicalOrder(result)).toEqual([result.root, "nd_back", "nd_nested", "nd_front"]);
    expect(topologicalOrder(result)).toEqual(topologicalOrder(structuredClone(result)));
    expect(Object.isFrozen(topologicalOrder(result))).toBe(true);
  });

  it("nunca usa a ordem das chaves do mapa como ordem de desenho", () => {
    const result = validTree();
    result.nodes = Object.fromEntries(Object.entries(result.nodes).reverse());
    expect(topologicalOrder(result)).toEqual([result.root, "nd_back", "nd_nested", "nd_front"]);
  });

  it("não guarda em cache uma composição mutável", () => {
    const result = validTree();
    expect(topologicalOrder(result)).toHaveLength(4);
    const root = result.nodes[result.root];
    if (root === undefined) throw new Error("fixture sem raiz");
    root.children.push("nd_after");
    result.nodes["nd_after"] = childNode(root, "nd_after", root.id);
    expect(topologicalOrder(result).at(-1)).toBe("nd_after");
  });

  it("reporta raiz ausente sem lançar durante a validação", () => {
    const result = composition();
    result.root = "nd_missing";
    expect(validateHierarchy(result)).toContainEqual(
      expect.objectContaining({ code: "root-missing", nodeId: "nd_missing" }),
    );
  });

  it("reporta raiz com pai", () => {
    const result = composition();
    const root = result.nodes[result.root];
    if (root === undefined) throw new Error("fixture sem raiz");
    root.parent = "nd_parent";
    result.nodes["nd_parent"] = childNode(root, "nd_parent", result.root, [result.root]);
    expect(validateHierarchy(result)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "root-parent" })]),
    );
  });

  it("reporta divergência entre chave e id", () => {
    const result = composition();
    const root = result.nodes[result.root];
    if (root === undefined) throw new Error("fixture sem raiz");
    root.id = "nd_other";
    expect(validateHierarchy(result)).toContainEqual(
      expect.objectContaining({ code: "node-key-mismatch", relatedId: result.root }),
    );
  });

  it("reporta pai e filho ausentes", () => {
    const result = composition();
    const root = result.nodes[result.root];
    if (root === undefined) throw new Error("fixture sem raiz");
    root.children = ["nd_missing_child"];
    result.nodes["nd_orphan"] = childNode(root, "nd_orphan", "nd_missing_parent");
    const codes = validateHierarchy(result).map((issue) => issue.code);
    expect(codes).toContain("missing-child");
    expect(codes).toContain("missing-parent");
    expect(codes).toContain("unreachable");
  });

  it("reporta filho duplicado e parent bidirecional divergente", () => {
    const result = composition();
    const root = result.nodes[result.root];
    if (root === undefined) throw new Error("fixture sem raiz");
    root.children = ["nd_child", "nd_child"];
    result.nodes["nd_child"] = childNode(root, "nd_child", "nd_other");
    const issues = validateHierarchy(result);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-child", relatedId: "nd_child" }),
        expect.objectContaining({ code: "child-parent-mismatch", relatedId: "nd_child" }),
      ]),
    );
  });

  it("reporta nó que declara pai mas não consta em children[]", () => {
    const result = composition();
    const root = result.nodes[result.root];
    if (root === undefined) throw new Error("fixture sem raiz");
    result.nodes["nd_hidden"] = childNode(root, "nd_hidden", root.id);
    expect(validateHierarchy(result)).toContainEqual(
      expect.objectContaining({ code: "child-not-listed", nodeId: "nd_hidden" }),
    );
  });

  it("detecta um ciclo uma única vez em ordem determinística", () => {
    const result = composition();
    const root = result.nodes[result.root];
    if (root === undefined) throw new Error("fixture sem raiz");
    result.nodes["nd_a"] = childNode(root, "nd_a", "nd_b", ["nd_b"]);
    result.nodes["nd_b"] = childNode(root, "nd_b", "nd_a", ["nd_a"]);
    const cycles = validateHierarchy(result).filter((issue) => issue.code === "cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.nodeId).toBe("nd_a");
  });

  it("topologicalOrder rejeita estrutura inválida com todos os diagnósticos", () => {
    const result = composition();
    result.root = "nd_missing";
    expect(() => topologicalOrder(result)).toThrow(SceneGraphInvariantError);
    try {
      topologicalOrder(result);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SceneGraphInvariantError);
      expect((error as SceneGraphInvariantError).issues[0]?.code).toBe("root-missing");
    }
  });
});

describe("hierarchy navigation", () => {
  it("devolve filhos, ancestrais e descendentes na ordem persistida", () => {
    const result = validTree();
    expect(orderedChildren(result, result.root).map((node) => node.id)).toEqual([
      "nd_back",
      "nd_front",
    ]);
    expect(ancestorIds(result, "nd_nested")).toEqual(["nd_back", result.root]);
    expect(descendantIds(result, result.root)).toEqual(["nd_back", "nd_nested", "nd_front"]);
    expect(isAncestor(result, result.root, "nd_nested")).toBe(true);
    expect(isAncestor(result, "nd_front", "nd_nested")).toBe(false);
  });

  it("rejeita ids inexistentes", () => {
    const result = validTree();
    expect(() => orderedChildren(result, "nd_absent")).toThrow(/não encontrado/i);
    expect(() => ancestorIds(result, "nd_absent")).toThrow(/não encontrado/i);
    expect(() => descendantIds(result, "nd_absent")).toThrow(/não encontrado/i);
  });

  it("rejeita ciclo e referência quebrada também nas rotas defensivas", () => {
    const result = validTree();
    const nested = result.nodes["nd_nested"];
    const back = result.nodes["nd_back"];
    if (nested === undefined || back === undefined) throw new Error("fixture incompleta");
    back.parent = nested.id;
    nested.children = [back.id];
    expect(() => ancestorIds(result, nested.id)).toThrow(/ciclo/i);
    expect(() => descendantIds(result, back.id)).toThrow(/ciclo|duplicado/i);

    const broken = validTree();
    const brokenRoot = broken.nodes[broken.root];
    if (brokenRoot === undefined) throw new Error("fixture sem raiz");
    brokenRoot.children.push("nd_absent");
    expect(() => orderedChildren(broken, broken.root)).toThrow(/inexistente/i);
    expect(() => descendantIds(broken, broken.root)).toThrow(/não encontrado/i);

    const missingParent = validTree();
    const nestedWithMissingParent = missingParent.nodes["nd_nested"];
    if (nestedWithMissingParent === undefined) throw new Error("fixture incompleta");
    nestedWithMissingParent.parent = "nd_absent";
    expect(() => ancestorIds(missingParent, nestedWithMissingParent.id)).toThrow(
      /pai não encontrado/i,
    );
  });
});
