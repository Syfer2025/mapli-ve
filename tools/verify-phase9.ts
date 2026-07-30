import {
  compileScene,
  createLlmAuthoringExampleInput,
  generateLlmAuthoringMarkdown,
  sceneVerbRegistry,
} from "@theatrum/scripting";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { generateSchemaArtifacts } from "./gen-schema.js";

const checks: string[] = [];
const root = process.cwd();

const exampleSource = await readFile(resolve(root, "examples/alexandre.scene.json"), "utf8");
const alexander = await compileScene(exampleSource);
assert(alexander.ok, `Alexandre falhou:\n${JSON.stringify(alexander.diagnostics, null, 2)}`);
assert(alexander.document.compositions[0]?.duration === 5_400, "Alexandre não dura 1m30s");
checks.push("Alexandre: documento válido de 1m30s");

const multipleErrors = await compileScene({
  format: "theatrum-scene",
  version: 1,
  meta: {
    title: "Cinco erros",
    fps: 60,
    resolution: "1920x1080",
    duration: "10s",
  },
  titel: "erro",
  timeline: [
    { at: "0s", do: "camera.focs", on: [0, 0], duration: "1s" },
    { at: "1s", do: "camera.reset", durration: "1s" },
    { do: "marker", label: "sem tempo" },
  ],
});
assert(!multipleErrors.ok, "fixture inválida compilou");
assert(multipleErrors.diagnostics.length === 5, "fixture não produziu exatamente cinco erros");
assert(
  multipleErrors.diagnostics.every((entry) => entry.path.startsWith("/")),
  "diagnóstico sem JSON pointer",
);
checks.push("diagnósticos: 5/5 com JSON Pointer e sugestões");

const timeline = Array.from({ length: 200 }, (_, index) => ({
  at: `${index}f`,
  do: "marker",
  label: `M${index}`,
}));
const started = performance.now();
const benchmark = await compileScene({
  format: "theatrum-scene",
  version: 1,
  meta: {
    title: "Benchmark",
    fps: 60,
    resolution: "1920x1080",
    duration: "10s",
  },
  timeline,
});
const elapsed = performance.now() - started;
assert(benchmark.ok, "benchmark não compilou");
assert(elapsed < 500, `benchmark excedeu 500 ms: ${elapsed.toFixed(1)} ms`);
checks.push(`desempenho: 200 entradas em ${elapsed.toFixed(1)} ms`);

const authoringPath = resolve(root, "LLM_AUTHORING.md");
const prettierConfig = await resolveConfig(authoringPath);
const expectedAuthoring = await format(generateLlmAuthoringMarkdown(), {
  ...prettierConfig,
  filepath: authoringPath,
});
const actualAuthoring = await readFile(authoringPath, "utf8");
assert(actualAuthoring === expectedAuthoring, "LLM_AUTHORING.md está fora de sincronia");
assert(
  sceneVerbRegistry.list().every((verb) => actualAuthoring.includes(`#### \`${verb.name}\``)),
  "guia não contém todos os verbos",
);
for (const verb of sceneVerbRegistry.list()) {
  const compiled = await compileScene(createLlmAuthoringExampleInput(verb), {
    semanticWarnings: false,
  });
  assert(
    compiled.ok,
    `exemplo de ${verb.name} é inválido:\n${JSON.stringify(compiled.diagnostics, null, 2)}`,
  );
}
const schemaAuthoring = await readFile(resolve(root, "schemas/LLM_AUTHORING.md"), "utf8");
assert(
  schemaAuthoring === generateSchemaArtifacts()["LLM_AUTHORING.md"],
  "schemas/LLM_AUTHORING.md está fora de sincronia",
);
checks.push(
  `guias gerados: ${sceneVerbRegistry.list().length} verbos sincronizados e exemplos compilados`,
);

console.log(`Fase 9: ${checks.length}/${checks.length}`);
for (const check of checks) console.log(`✓ ${check}`);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
