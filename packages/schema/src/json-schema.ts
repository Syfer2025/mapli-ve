import { z } from "zod";
import { ProjectDocumentSchema } from "./project-document.js";
import { SceneScriptSchema } from "./scene-script.js";

export type JsonSchemaDocument = Record<string, unknown>;

export function createProjectDocumentJsonSchema(): JsonSchemaDocument {
  return withIdentity(
    z.toJSONSchema(ProjectDocumentSchema, {
      target: "draft-2020-12",
      unrepresentable: "any",
    }),
    "https://theatrum.local/schemas/project-document.schema.json",
    "Theatrum ProjectDocument v1",
  );
}

export function createSceneScriptJsonSchema(): JsonSchemaDocument {
  return withIdentity(
    z.toJSONSchema(SceneScriptSchema, {
      target: "draft-2020-12",
      unrepresentable: "any",
    }),
    "https://theatrum.local/schemas/scene-script.schema.json",
    "Theatrum Scene Script v1",
  );
}

/**
 * Serialização recursiva estável para artefatos gerados. Arrays mantêm ordem;
 * objetos usam ordem lexical e sempre terminam com LF.
 */
export function stableJsonStringify(value: unknown): string {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}

function withIdentity(schema: JsonSchemaDocument, id: string, title: string): JsonSchemaDocument {
  return {
    ...schema,
    $id: id,
    title,
  };
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, nested]) => [key, sortObjectKeys(nested)]),
  );
}
