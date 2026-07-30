import type { GazetteerPort } from "@theatrum/gis";
import type { CompileSceneOptions, CompileSceneResult, SceneDiagnostic } from "./contracts.js";
import { diagnostic, stableDiagnostics } from "./diagnostics.js";
import { emitProjectDocument } from "./emit.js";
import { createDefaultSceneGazetteer } from "./places.js";
import { sceneVerbRegistry } from "./registry.js";
import { resolveSceneSemantics } from "./semantic.js";
import { decodeSceneInput } from "./structure.js";

export async function compileScene(
  input: string | unknown,
  options: CompileSceneOptions = {},
): Promise<CompileSceneResult> {
  const decoded = decodeSceneInput(input, sceneVerbRegistry);
  const diagnostics: SceneDiagnostic[] = [...decoded.diagnostics];
  if (decoded.scene === null) {
    return { ok: false, diagnostics: stableDiagnostics(diagnostics) };
  }

  const gazetteer: GazetteerPort = options.gazetteer ?? createDefaultSceneGazetteer();
  const resolved = await resolveSceneSemantics(
    decoded.scene,
    gazetteer,
    diagnostics,
    options.semanticWarnings ?? true,
  );
  if (resolved === null || diagnostics.some((entry) => entry.severity === "error")) {
    return { ok: false, diagnostics: stableDiagnostics(diagnostics) };
  }

  try {
    const document = emitProjectDocument(decoded.scene, resolved);
    return {
      ok: true,
      document,
      scene: decoded.scene,
      diagnostics: stableDiagnostics(diagnostics),
    };
  } catch (error: unknown) {
    diagnostics.push(
      diagnostic(
        "error",
        "schema",
        "",
        `o documento emitido não passou na validação: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { hint: "copie os diagnósticos e reporte como erro do compilador" },
      ),
    );
    return { ok: false, diagnostics: stableDiagnostics(diagnostics) };
  }
}
