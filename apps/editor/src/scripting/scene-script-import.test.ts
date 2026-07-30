import { describe, expect, it } from "vitest";
import { formatSceneDiagnostics } from "./scene-script-import.js";

describe("diagnósticos Scene Script na UI", () => {
  it("produz texto copiável com pointer, dica e sugestões", () => {
    expect(
      formatSceneDiagnostics([
        {
          severity: "error",
          code: "unknown-field",
          path: "/timeline/3/durration",
          message: 'campo desconhecido "durration"',
          hint: "use a grafia documentada",
          didYouMean: ["duration"],
        },
      ]),
    ).toBe(
      [
        "ERROR /timeline/3/durration [unknown-field]",
        'campo desconhecido "durration"',
        "Dica: use a grafia documentada",
        "Você quis dizer: duration",
      ].join("\n"),
    );
  });
});
