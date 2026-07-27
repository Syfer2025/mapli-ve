import {
  APP_NAME,
  SCENE_FORMAT_ID,
  SCENE_SCRIPT_VERSION,
  VERB_CATALOG,
  createProjectDocumentJsonSchema,
  createSceneScriptJsonSchema,
  stableJsonStringify,
} from "@theatrum/schema";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SchemaArtifacts {
  readonly "project-document.schema.json": string;
  readonly "scene-script.schema.json": string;
  readonly "verbs.json": string;
  readonly "LLM_AUTHORING.md": string;
}

export function generateSchemaArtifacts(): SchemaArtifacts {
  const verbs = VERB_CATALOG.map(({ name, category, description, required, example }) => ({
    name,
    category,
    description,
    required: [...required],
    example,
  }));

  return {
    "project-document.schema.json": stableJsonStringify(createProjectDocumentJsonSchema()),
    "scene-script.schema.json": stableJsonStringify(createSceneScriptJsonSchema()),
    "verbs.json": stableJsonStringify({
      format: "theatrum-verb-catalog",
      version: SCENE_SCRIPT_VERSION,
      verbs,
    }),
    "LLM_AUTHORING.md": generateLlmAuthoringMarkdown(verbs),
  };
}

export async function writeSchemaArtifacts(outputDirectory: string): Promise<void> {
  const artifacts = generateSchemaArtifacts();
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    Object.entries(artifacts).map(async ([name, contents]) => {
      await writeFile(resolve(outputDirectory, name), contents, "utf8");
    }),
  );
}

function generateLlmAuthoringMarkdown(
  verbs: readonly {
    readonly name: string;
    readonly category: string;
    readonly description: string;
    readonly required: readonly string[];
    readonly example: Readonly<Record<string, unknown>>;
  }[],
): string {
  const groups = new Map<string, (typeof verbs)[number][]>();
  for (const entry of verbs) {
    const group = groups.get(entry.category);
    if (group === undefined) groups.set(entry.category, [entry]);
    else group.push(entry);
  }
  const lines = [
    `# Autoria de Scene Script — ${APP_NAME}`,
    "",
    "Produza somente JSON válido no formato `theatrum-scene`, versão 1.",
    "Os únicos campos obrigatórios na raiz são `format`, `version`, `meta` e `timeline`.",
    "Tempo numérico significa segundos. Prefira strings como `4s`, `90f` ou `1m30s`.",
    "Use coordenadas como `[longitude, latitude]`. Nunca invente uma cidade ambígua.",
    "Campos desconhecidos são erro; use apenas os verbos e campos do catálogo abaixo.",
    "",
    "## Estrutura mínima",
    "",
    "```json",
    stableJsonStringify({
      format: SCENE_FORMAT_ID,
      version: SCENE_SCRIPT_VERSION,
      meta: {
        title: "Título da cena",
        fps: 60,
        resolution: "1920x1080",
        duration: "10s",
      },
      timeline: [],
    }).trimEnd(),
    "```",
    "",
  ];

  for (const [category, entries] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  )) {
    lines.push(`## ${category}`, "");
    for (const entry of entries) {
      lines.push(
        `### \`${entry.name}\``,
        "",
        entry.description,
        "",
        `Obrigatórios: ${entry.required.map((field) => `\`${field}\``).join(", ")}.`,
        "",
        "```json",
        stableJsonStringify(entry.example).trimEnd(),
        "```",
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function readOutputDirectory(arguments_: readonly string[]): string {
  const outputIndex = arguments_.indexOf("--out");
  if (outputIndex === -1) return resolve(process.cwd(), "schemas");
  const value = arguments_[outputIndex + 1];
  if (value === undefined || value.length === 0) {
    throw new Error("Use --out <diretório>.");
  }
  return resolve(process.cwd(), value);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedFile === currentFile) {
  const outputDirectory = readOutputDirectory(process.argv.slice(2));
  await writeSchemaArtifacts(outputDirectory);
  process.stdout.write(`Schemas gerados em ${outputDirectory}\n`);
}
