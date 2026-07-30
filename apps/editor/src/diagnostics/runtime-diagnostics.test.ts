import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeExpressionDiagnostics,
  getRuntimeDiagnosticsSnapshot,
  publishRuntimeExpressionDiagnostics,
  runtimeExpressionDiagnosticsAt,
  subscribeRuntimeDiagnostics,
} from "./runtime-diagnostics.js";

const DIAGNOSTIC = {
  code: "expression.divide-by-zero" as const,
  message: "divisão por zero",
  start: 3,
  end: 4,
  propertyPath: "compositions.cmp.nodes.nd.props.value",
};

beforeEach(() => {
  clearRuntimeExpressionDiagnostics("map");
  clearRuntimeExpressionDiagnostics("studio");
});

describe("runtime diagnostics", () => {
  it("deduplica vistas e consulta pelo frame exato", () => {
    publishRuntimeExpressionDiagnostics("map", "cmp", 10, [DIAGNOSTIC]);
    publishRuntimeExpressionDiagnostics("studio", "cmp", 10, [DIAGNOSTIC]);

    expect(getRuntimeDiagnosticsSnapshot().diagnostics).toEqual([DIAGNOSTIC]);
    expect(runtimeExpressionDiagnosticsAt("cmp", 10)).toEqual([DIAGNOSTIC]);
    expect(runtimeExpressionDiagnosticsAt("cmp", 11)).toEqual([]);
  });

  it("notifica somente quando o quadro ou os diagnósticos mudam", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRuntimeDiagnostics(listener);
    publishRuntimeExpressionDiagnostics("map", "cmp", 1, []);
    publishRuntimeExpressionDiagnostics("map", "cmp", 1, []);
    publishRuntimeExpressionDiagnostics("map", "cmp", 2, [DIAGNOSTIC]);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
