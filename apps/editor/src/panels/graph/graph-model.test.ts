import type { AnimatableProperty, Keyframe } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import {
  buildGraphModel,
  findHandleAt,
  frameToX,
  handleFromScreen,
  valueToY,
  xToFrame,
  yToValue,
  type GraphViewport,
} from "./graph-model.js";

const VIEWPORT: GraphViewport = {
  width: 600,
  height: 300,
  startFrame: 0,
  endFrame: 60,
  padding: 20,
};

function keyframe(id: string, frame: number, value: number, easing?: Partial<Keyframe<number>>) {
  return {
    id,
    frame,
    value,
    in: { kind: "linear" as const },
    out: { kind: "linear" as const },
    ...easing,
  };
}

function property(keyframes: readonly Keyframe<number>[]): AnimatableProperty<number> {
  return { value: 0, keyframes: [...keyframes], expression: null };
}

describe("modelo do editor de curvas", () => {
  it("mapeia frame e valor para tela e volta", () => {
    expect(frameToX(0, VIEWPORT)).toBe(0);
    expect(frameToX(60, VIEWPORT)).toBe(600);
    expect(frameToX(30, VIEWPORT)).toBe(300);
    expect(xToFrame(300, VIEWPORT)).toBe(30);

    const range = { min: 0, max: 1 };
    // Valor maior fica mais alto na tela: y menor.
    expect(valueToY(1, range, VIEWPORT)).toBeLessThan(valueToY(0, range, VIEWPORT));
    expect(yToValue(valueToY(0.42, range, VIEWPORT), range, VIEWPORT)).toBeCloseTo(0.42, 9);
  });

  it("curva de valor cobre o intervalo e a de velocidade acompanha", () => {
    const model = buildGraphModel(
      property([keyframe("a", 0, 0), keyframe("b", 60, 1)]),
      VIEWPORT,
      60,
    );
    expect(model.value.points[0]?.frame).toBe(0);
    expect(model.value.points.at(-1)?.frame).toBe(60);
    expect(model.value.points[0]?.value).toBe(0);
    expect(model.value.points.at(-1)?.value).toBe(1);
    // Linear: velocidade constante de 1 unidade por segundo.
    const speeds = model.speed.points.slice(1, -1).map((point) => point.value);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(1e-9);
  });

  it("ease-in/out aparece como velocidade com pico no meio", () => {
    const eased = property([
      { ...keyframe("a", 0, 0), out: { kind: "bezier", handle: [0.42, 0] } },
      { ...keyframe("b", 60, 1), in: { kind: "bezier", handle: [0.58, 1] } },
    ]);
    const model = buildGraphModel(eased, VIEWPORT, 60);
    const middle = model.speed.points.find((point) => point.frame === 30)?.value ?? 0;
    const early = model.speed.points.find((point) => point.frame === 3)?.value ?? 0;
    expect(middle).toBeGreaterThan(early);
  });

  it("handles bezier só existem com segmento vizinho", () => {
    const eased = property([
      { ...keyframe("a", 0, 0), out: { kind: "bezier", handle: [0.42, 0] } },
      { ...keyframe("b", 60, 1), in: { kind: "bezier", handle: [0.58, 1] } },
    ]);
    const model = buildGraphModel(eased, VIEWPORT, 60);
    expect(model.handles.map((handle) => `${handle.keyframeId}:${handle.side}`)).toEqual([
      "a:out",
      "b:in",
    ]);
    // Handle de saída em x=0.42 do segmento 0..60 → frame 25,2 → 252 px.
    const out = model.handles.find((handle) => handle.side === "out");
    expect(out?.x).toBeCloseTo(252, 6);

    const linear = buildGraphModel(
      property([keyframe("a", 0, 0), keyframe("b", 60, 1)]),
      VIEWPORT,
      60,
    );
    expect(linear.handles).toHaveLength(0);
  });

  it("clique perto pega o handle e longe não pega", () => {
    const model = buildGraphModel(
      property([
        { ...keyframe("a", 0, 0), out: { kind: "bezier", handle: [0.5, 0] } },
        { ...keyframe("b", 60, 1), in: { kind: "bezier", handle: [0.5, 1] } },
      ]),
      VIEWPORT,
      60,
    );
    const target = model.handles[0];
    if (target === undefined) throw new Error("handle esperado");
    expect(findHandleAt(model, target.x + 2, target.y + 2)?.side).toBe(target.side);
    expect(findHandleAt(model, target.x + 40, target.y + 40)).toBeNull();
  });

  it("arrastar handle devolve coordenadas normalizadas presas em x", () => {
    const left = keyframe("a", 0, 0);
    const right = keyframe("b", 60, 1);
    const range = { min: 0, max: 1 };

    const middle = handleFromScreen(
      { x: frameToX(30, VIEWPORT), y: valueToY(0.5, range, VIEWPORT) },
      left,
      right,
      VIEWPORT,
      range,
    );
    expect(middle[0]).toBeCloseTo(0.5, 9);
    expect(middle[1]).toBeCloseTo(0.5, 9);

    // Fora da faixa temporal do segmento: x satura, y continua livre.
    const beyond = handleFromScreen(
      { x: frameToX(200, VIEWPORT), y: valueToY(1.6, range, VIEWPORT) },
      left,
      right,
      VIEWPORT,
      range,
    );
    expect(beyond[0]).toBe(1);
    expect(beyond[1]).toBeGreaterThan(1);
  });

  it("propriedade vetorial entra pela magnitude e trilha vazia não quebra", () => {
    const position: AnimatableProperty<readonly [number, number]> = {
      value: [0, 0],
      keyframes: [
        { id: "a", frame: 0, value: [0, 0], in: { kind: "linear" }, out: { kind: "linear" } },
        { id: "b", frame: 60, value: [30, 40], in: { kind: "linear" }, out: { kind: "linear" } },
      ],
      expression: null,
    };
    const model = buildGraphModel(position, VIEWPORT, 60);
    expect(model.value.points.at(-1)?.value).toBeCloseTo(50, 9);

    const empty = buildGraphModel(property([]), VIEWPORT, 60);
    expect(empty.keyframes).toHaveLength(0);
    expect(empty.value.range.max).toBeGreaterThan(empty.value.range.min);
  });

  it("valor constante ainda produz faixa utilizável", () => {
    const flat = buildGraphModel(
      property([keyframe("a", 0, 5), keyframe("b", 60, 5)]),
      VIEWPORT,
      60,
    );
    expect(flat.value.range.min).toBeLessThan(5);
    expect(flat.value.range.max).toBeGreaterThan(5);
    expect(flat.value.points.every((point) => Number.isFinite(point.y))).toBe(true);
  });
});
