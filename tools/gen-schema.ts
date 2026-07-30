import {
  SCENE_SCRIPT_VERSION,
  VERB_CATALOG,
  createProjectDocumentJsonSchema,
  createSceneScriptJsonSchema,
  stableJsonStringify,
} from "@theatrum/schema";
import { generateLlmAuthoringMarkdown, sceneVerbRegistry } from "@theatrum/scripting";
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
    "LLM_AUTHORING.md": generateLlmAuthoringMarkdown(sceneVerbRegistry),
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
