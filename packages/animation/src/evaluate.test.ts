import { createEmptyProjectDocument, type ProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { evaluate, EvaluationError } from "./evaluate.js";

describe("evaluate", () => {
  it("avalia câmera, transform e props sem modificar o documento", () => {
    const document = documentWithAnimatedNode();
    const before = structuredClone(document);
    const scene = evaluate(document, "cmp_main", 30);
    const node = scene.nodes.get("nd_title");

    expect(scene.camera.zoom).toBe(3);
    expect(node?.transform.scale).toEqual([1.5, 1.5]);
    expect(node?.opacity).toBeCloseTo(0.75);
    expect(node?.props).toMatchObject({ text: "Meio" });
    expect(document).toEqual(before);
  });

  it("é independente da ordem de avaliação", () => {
    const document = documentWithAnimatedNode();
    const direct = evaluate(document, "cmp_main", 30);
    for (let frame = 0; frame < 30; frame += 1) {
      evaluate(document, "cmp_main", frame);
    }
    expect(evaluate(document, "cmp_main", 30)).toEqual(direct);
  });

  it("acumula opacidade e visibilidade pela hierarquia", () => {
    const document = documentWithAnimatedNode();
    const composition = document.compositions[0];
    if (composition === undefined) throw new Error("fixture inválida");
    composition.nodes["nd_root"]!.transform.opacity.value = 0.5;

    const node = evaluate(document, "cmp_main", 30).nodes.get("nd_title");
    expect(node?.opacity).toBeCloseTo(0.375);
    expect(node?.visible).toBe(true);

    composition.nodes["nd_root"]!.enabled = false;
    expect(evaluate(document, "cmp_main", 30).nodes.get("nd_title")?.visible).toBe(false);
  });

  it("respeita time range, solo e inclui a subárvore solo", () => {
    const document = documentWithAnimatedNode();
    const composition = document.compositions[0];
    if (composition === undefined) throw new Error("fixture inválida");
    const title = composition.nodes["nd_title"]!;
    title.timeRange = { in: 10, out: 50 };

    expect(evaluate(document, "cmp_main", 5).nodes.get(title.id)?.visible).toBe(false);
    title.solo = true;
    expect(evaluate(document, "cmp_main", 30).nodes.get(title.id)?.visible).toBe(true);
    expect(evaluate(document, "cmp_main", 30).nodes.get("nd_other")?.visible).toBe(false);
    expect(evaluate(document, "cmp_main", 30).nodes.get("nd_root")?.visible).toBe(true);
  });

  it("limita o frame por padrão e informa composição ausente", () => {
    const document = documentWithAnimatedNode();
    expect(evaluate(document, "cmp_main", 100_000).frame).toBe(600);
    expect(evaluate(document, "cmp_main", -10, { clampFrame: false }).frame).toBe(-10);
    expect(() => evaluate(document, "inexistente", 0)).toThrow(EvaluationError);
  });
});

function documentWithAnimatedNode(): ProjectDocument {
  const document = createEmptyProjectDocument();
  const composition = document.compositions[0];
  if (composition === undefined) throw new Error("fixture inválida");
  composition.camera.zoom.keyframes = [keyframe("zoom-a", 0, 2), keyframe("zoom-b", 60, 4)];

  const title = createNode("nd_title", "text.title");
  title.transform.scale.keyframes = [
    keyframe("scale-a", 0, [1, 1]),
    keyframe("scale-b", 60, [2, 2]),
  ];
  title.transform.opacity.keyframes = [keyframe("opacity-a", 0, 1), keyframe("opacity-b", 60, 0.5)];
  title.props = {
    text: {
      value: "Início",
      keyframes: [keyframe("text-a", 0, "Início"), keyframe("text-b", 30, "Meio")],
      expression: null,
    },
  };
  const other = createNode("nd_other", "shape.line");
  composition.nodes["nd_root"]!.children = [title.id, other.id];
  composition.nodes[title.id] = title;
  composition.nodes[other.id] = other;
  return document;
}

function createNode(id: string, type: string) {
  const document = createEmptyProjectDocument();
  const root = structuredClone(document.compositions[0]!.nodes["nd_root"]!);
  root.id = id;
  root.type = type;
  root.name = id;
  root.parent = "nd_root";
  root.children = [];
  root.size = { mode: "screen", size: [200, 100] };
  return root;
}

function keyframe<T>(id: string, frame: number, value: T) {
  return {
    id,
    frame,
    value,
    in: { kind: "linear" as const },
    out: { kind: "linear" as const },
  };
}
