/**
 * Pré-composição aninhada: expansão, herança de transform e `timeRemap`.
 *
 * O critério 6 da Fase 5 pede as duas coisas juntas — a composição interna
 * renderiza e aceita remapeamento de tempo.
 */

import {
  createEmptyProjectDocument,
  type Composition,
  type Node,
  type ProjectDocument,
} from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";

function animatable<T>(value: T) {
  return { value, keyframes: [], expression: null };
}

function node(id: string, overrides: Partial<Node> = {}): Node {
  const base = createEmptyProjectDocument().compositions[0]!;
  const root = base.nodes[base.root]!;
  return {
    ...structuredClone(root),
    id,
    name: id,
    parent: null,
    children: [],
    ...overrides,
  };
}

/** Composição interna: um rótulo que caminha de x=0 a x=100 em 100 frames. */
function innerComposition(): Composition {
  const base = createEmptyProjectDocument({
    id: "prj_inner",
    compositionId: "cmp_inner",
    compositionName: "Interna",
    rootNodeId: "nd_inner_root",
  }).compositions[0]!;
  const root = base.nodes["nd_inner_root"]!;
  const label = node("nd_inner_label", {
    type: "text.label",
    parent: "nd_inner_root",
    anchor: { space: "comp", position: [0, 0] },
    transform: {
      ...structuredClone(root.transform),
      position: {
        value: [0, 0],
        keyframes: [
          {
            id: "kf_start",
            frame: 0,
            value: [0, 0],
            in: { kind: "linear" },
            out: { kind: "linear" },
          },
          {
            id: "kf_end",
            frame: 100,
            value: [100, 0],
            in: { kind: "linear" },
            out: { kind: "linear" },
          },
        ],
        expression: null,
      },
    },
  });
  return {
    ...base,
    duration: 100,
    nodes: {
      [root.id]: { ...root, children: ["nd_inner_label"] },
      nd_inner_label: label,
    },
  };
}

/** Documento com a composição principal contendo um `precomp` da interna. */
function documentWithPrecomp(precompOverrides: Partial<Node> = {}): {
  document: ProjectDocument;
  outerId: string;
} {
  const base = createEmptyProjectDocument();
  const outer = base.compositions[0]!;
  const outerRoot = outer.nodes[outer.root]!;
  const precomp = node("nd_precomp", {
    type: "precomp",
    parent: outer.root,
    anchor: { space: "comp", position: [500, 200] },
    props: { compositionId: animatable("cmp_inner"), freeze: animatable(false) },
    ...precompOverrides,
  });

  return {
    outerId: outer.id,
    document: {
      ...base,
      compositions: [
        {
          ...outer,
          nodes: {
            [outerRoot.id]: { ...outerRoot, children: ["nd_precomp"] },
            nd_precomp: precomp,
          },
        },
        innerComposition(),
      ],
    },
  };
}

describe("pré-composição", () => {
  it("expande os nós internos com id prefixado e pai correto", () => {
    const { document, outerId } = documentWithPrecomp();
    const scene = evaluate(document, outerId, 50);

    expect([...scene.nodes.keys()]).toEqual([
      "nd_root",
      "nd_precomp",
      "nd_precomp/nd_inner_root",
      "nd_precomp/nd_inner_label",
    ]);
    // A raiz interna passa a ter o nó de pré-composição como pai.
    expect(scene.nodes.get("nd_precomp/nd_inner_root")?.parent).toBe("nd_precomp");
    expect(scene.nodes.get("nd_precomp/nd_inner_label")?.parent).toBe("nd_precomp/nd_inner_root");
    // Ordem de desenho: o nó da pré-composição vem antes do conteúdo dela.
    expect(scene.drawOrder.indexOf("nd_precomp")).toBeLessThan(
      scene.drawOrder.indexOf("nd_precomp/nd_inner_label"),
    );
  });

  it("sem timeRemap o tempo interno acompanha o externo", () => {
    const { document, outerId } = documentWithPrecomp();
    const at = (frame: number): number =>
      evaluate(document, outerId, frame).nodes.get("nd_precomp/nd_inner_label")?.transform
        .position[0] ?? -1;

    expect(at(0)).toBeCloseTo(0, 9);
    expect(at(25)).toBeCloseTo(25, 9);
    expect(at(100)).toBeCloseTo(100, 9);
  });

  it("timeRemap congela, atrasa e inverte o conteúdo interno", () => {
    const frozen = documentWithPrecomp({
      timeRemap: animatable(40),
    });
    expect(
      evaluate(frozen.document, frozen.outerId, 0).nodes.get("nd_precomp/nd_inner_label")?.transform
        .position[0],
    ).toBeCloseTo(40, 9);
    expect(
      evaluate(frozen.document, frozen.outerId, 90).nodes.get("nd_precomp/nd_inner_label")
        ?.transform.position[0],
    ).toBeCloseTo(40, 9);

    const reversed = documentWithPrecomp({
      timeRemap: {
        value: 0,
        keyframes: [
          { id: "kf_a", frame: 0, value: 100, in: { kind: "linear" }, out: { kind: "linear" } },
          { id: "kf_b", frame: 100, value: 0, in: { kind: "linear" }, out: { kind: "linear" } },
        ],
        expression: null,
      },
    });
    const at = (frame: number): number =>
      evaluate(reversed.document, reversed.outerId, frame).nodes.get("nd_precomp/nd_inner_label")
        ?.transform.position[0] ?? -1;
    expect(at(0)).toBeCloseTo(100, 9);
    expect(at(75)).toBeCloseTo(25, 9);
    expect(at(100)).toBeCloseTo(0, 9);
  });

  it("opacidade e visibilidade do nó atravessam para dentro", () => {
    const half = documentWithPrecomp({
      transform: {
        ...structuredClone(node("tmp").transform),
        opacity: animatable(0.5),
      },
    });
    const scene = evaluate(half.document, half.outerId, 10);
    expect(scene.nodes.get("nd_precomp/nd_inner_label")?.opacity).toBeCloseTo(0.5, 9);

    const hidden = documentWithPrecomp({ enabled: false });
    const hiddenScene = evaluate(hidden.document, hidden.outerId, 10);
    expect(hiddenScene.nodes.get("nd_precomp/nd_inner_label")?.visible).toBe(false);
  });

  it("referência inexistente ou cíclica não derruba a avaliação", () => {
    const missing = documentWithPrecomp({
      props: { compositionId: animatable("cmp_fantasma"), freeze: animatable(false) },
    });
    const scene = evaluate(missing.document, missing.outerId, 10);
    expect(scene.nodes.has("nd_precomp")).toBe(true);
    expect([...scene.nodes.keys()].some((id) => id.includes("/"))).toBe(false);

    // Auto-referência: a composição principal aninhada em si mesma.
    const selfReference = documentWithPrecomp({
      props: { compositionId: animatable("cmp_main"), freeze: animatable(false) },
    });
    const selfScene = evaluate(selfReference.document, selfReference.outerId, 5);
    expect(selfScene.nodes.has("nd_precomp")).toBe(true);
    expect([...selfScene.nodes.keys()].some((id) => id.includes("/"))).toBe(false);
  });

  it("a mesma composição pode ser aninhada duas vezes sem colidir id", () => {
    const { document, outerId } = documentWithPrecomp();
    const outer = document.compositions[0]!;
    const first = outer.nodes["nd_precomp"]!;
    const second: Node = { ...structuredClone(first), id: "nd_precomp_2" };
    const twice: ProjectDocument = {
      ...document,
      compositions: [
        {
          ...outer,
          nodes: {
            ...outer.nodes,
            [outer.root]: { ...outer.nodes[outer.root]!, children: ["nd_precomp", "nd_precomp_2"] },
            nd_precomp_2: second,
          },
        },
        document.compositions[1]!,
      ],
    };

    const scene = evaluate(twice, outerId, 30);
    expect(scene.nodes.has("nd_precomp/nd_inner_label")).toBe(true);
    expect(scene.nodes.has("nd_precomp_2/nd_inner_label")).toBe(true);
    // Raiz externa + dois nós de pré-composição + duas cópias (raiz + rótulo).
    expect(scene.nodes.size).toBe(7);
  });

  it("origem de recorte dentro da pré-composição leva o mesmo prefixo", () => {
    const { document, outerId } = documentWithPrecomp();
    const inner = document.compositions[1]!;
    const label = inner.nodes["nd_inner_label"]!;
    const withMatte: ProjectDocument = {
      ...document,
      compositions: [
        document.compositions[0]!,
        {
          ...inner,
          nodes: {
            ...inner.nodes,
            nd_inner_label: {
              ...label,
              trackMatte: { source: "nd_inner_root", mode: "luma" },
            },
          },
        },
      ],
    };

    const scene = evaluate(withMatte, outerId, 30);
    // Sem o prefixo a origem apontaria para um id que não existe na cena, e o
    // recorte simplesmente desapareceria dentro da pré-composição.
    expect(scene.nodes.get("nd_precomp/nd_inner_label")?.trackMatte).toEqual({
      source: "nd_precomp/nd_inner_root",
      mode: "luma",
    });
    // Fora de pré-composição o prefixo é vazio, então o id fica intacto.
    expect(scene.nodes.get("nd_precomp")?.trackMatte).toBeNull();
  });
});
