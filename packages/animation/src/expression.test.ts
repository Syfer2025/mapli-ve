import { describe, expect, it } from "vitest";
import {
  compileExpression,
  evaluateExpression,
  evaluateExpressionSource,
  type ExpressionValue,
} from "./expression.js";

function valueOf(source: string, value: ExpressionValue = 0, frame = 0): ExpressionValue {
  const result = evaluateExpressionSource(source, { value, frame });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((entry) => entry.message).join("\n"));
  }
  return result.value;
}

describe("expressões seguras", () => {
  it("respeita precedência, potência associativa à direita e constantes", () => {
    expect(valueOf("1 + 2 * 3")).toBe(7);
    expect(valueOf("2 ** 3 ** 2")).toBe(512);
    expect(valueOf("round(cos(pi) + e - e)")).toBe(-1);
  });

  it("aplica a expressão sobre o valor interpolado e o frame fracionário", () => {
    expect(valueOf("value + sin(frame * pi / 2) * 10", 5, 1)).toBe(15);
    expect(valueOf("value + frame", 2, 0.25)).toBe(2.25);
  });

  it("opera vetores componente a componente, com broadcast e índice seguro", () => {
    expect(valueOf("value * 2 + [1, -1]", [2, 4])).toEqual([5, 7]);
    expect(valueOf("clamp(value + [8, -8], [0, 0], [10, 10])", [5, 5])).toEqual([10, 0]);
    expect(valueOf("value[0] + value[1]", [3, 7])).toBe(10);
    expect(valueOf("length([3, 4])")).toBe(5);
  });

  it("oferece condicionais, booleanos, strings e curto-circuito", () => {
    expect(valueOf('frame < 10 ? "entrada" : "saída"', 0, 9)).toBe("entrada");
    expect(valueOf('frame < 10 ? "entrada" : "saída"', 0, 10)).toBe("saída");
    expect(valueOf("false && 1 / 0 == 0")).toBe(false);
    expect(valueOf('true ? "A\\n" + "B" : "C"')).toBe("A\nB");
  });

  it("compila uma vez e avalia deterministicamente em qualquer ordem", () => {
    const compiled = compileExpression("lerp(value, value + 100, frame / 100)");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const direct = evaluateExpression(compiled.program, { value: 10, frame: 37.5 });
    for (let frame = 100; frame >= 0; frame -= 1) {
      evaluateExpression(compiled.program, { value: 10, frame });
    }
    expect(evaluateExpression(compiled.program, { value: 10, frame: 37.5 })).toEqual(direct);
    expect(Object.isFrozen(compiled.program)).toBe(true);
  });

  it("rejeita acesso ao host, atribuição e funções fora da lista fechada", () => {
    expect(compileExpression("globalThis").diagnostics[0]?.code).toBe(
      "expression.unknown-identifier",
    );
    expect(compileExpression("value.constructor").diagnostics[0]?.code).toBe(
      "expression.invalid-token",
    );
    expect(compileExpression("random()").diagnostics[0]?.code).toBe("expression.unknown-function");
    expect(compileExpression("frame = 10").diagnostics[0]?.code).toBe("expression.invalid-token");
  });

  it("transforma falhas de domínio, tipo e índice em diagnósticos", () => {
    expect(evaluateExpressionSource("1 / 0", { value: 0, frame: 0 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "expression.divide-by-zero" }],
    });
    expect(evaluateExpressionSource("sqrt(-1)", { value: 0, frame: 0 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "expression.non-finite" }],
    });
    expect(evaluateExpressionSource("value[2]", { value: [1, 2], frame: 0 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "expression.index" }],
    });
    expect(evaluateExpressionSource("true + 1", { value: 0, frame: 0 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "expression.type" }],
    });
    expect(evaluateExpressionSource('min("x")', { value: 0, frame: 0 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "expression.type" }],
    });
  });

  it("impõe limites de texto e complexidade antes de avaliar", () => {
    expect(compileExpression("1".repeat(4_097)).diagnostics[0]?.code).toBe(
      "expression.source-too-long",
    );
    expect(compileExpression(`${"1 + ".repeat(300)}1`).diagnostics[0]?.code).toBe(
      "expression.too-complex",
    );
    expect(compileExpression("  \n\t").diagnostics[0]?.code).toBe("expression.empty");
  });
});
