import type { GazetteerPort } from "@theatrum/gis";
import {
  compileScene as compileScenePackage,
  createDefaultSceneGazetteer,
  type CompileSceneResult,
  type SceneDiagnostic,
} from "@theatrum/scripting";
import { loadNaturalEarthGazetteer } from "../panels/viewport/natural-earth-gazetteer.js";

let completeGazetteer: Promise<GazetteerPort> | undefined;

export async function compileScene(input: string | unknown): Promise<CompileSceneResult> {
  const fallback = createDefaultSceneGazetteer();
  try {
    const complete = await loadCompleteGazetteer();
    return compileScenePackage(input, {
      gazetteer: preferCompleteGazetteer(complete, fallback),
    });
  } catch {
    // O dado completo é melhoria de cobertura, não requisito para abrir a UI:
    // o índice essencial/histórico continua totalmente offline.
    return compileScenePackage(input, { gazetteer: fallback });
  }
}

async function loadCompleteGazetteer(): Promise<GazetteerPort> {
  const pending = completeGazetteer ?? loadNaturalEarthGazetteer();
  completeGazetteer = pending;
  try {
    return await pending;
  } catch (error: unknown) {
    // Uma falha transitória não envenena todas as próximas importações.
    if (completeGazetteer === pending) completeGazetteer = undefined;
    throw error;
  }
}

export function formatSceneDiagnostics(diagnostics: readonly SceneDiagnostic[]): string {
  if (diagnostics.length === 0) return "Nenhum diagnóstico.";
  return diagnostics
    .map((entry) => {
      const location = entry.path === "" ? "/" : entry.path;
      const lines = [
        `${entry.severity.toLocaleUpperCase("pt-BR")} ${location} [${entry.code}]`,
        entry.message,
      ];
      if (entry.hint !== undefined) lines.push(`Dica: ${entry.hint}`);
      if (entry.didYouMean !== undefined && entry.didYouMean.length > 0) {
        lines.push(`Você quis dizer: ${entry.didYouMean.join(" | ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function preferCompleteGazetteer(complete: GazetteerPort, fallback: GazetteerPort): GazetteerPort {
  return {
    async resolve(query) {
      const hits = await complete.resolve(query);
      return hits.length > 0 ? hits : fallback.resolve(query);
    },
    resolveExact(query) {
      return complete.resolveExact(query) ?? fallback.resolveExact(query);
    },
  };
}
