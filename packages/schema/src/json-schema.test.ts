import { describe, expect, it } from "vitest";
import {
  VERB_CATALOG,
  createProjectDocumentJsonSchema,
  createSceneScriptJsonSchema,
  stableJsonStringify,
} from "./index.js";

describe("JSON Schema", () => {
  it("gera draft 2020-12 determinístico para os dois formatos", () => {
    const projectFirst = stableJsonStringify(createProjectDocumentJsonSchema());
    const projectSecond = stableJsonStringify(createProjectDocumentJsonSchema());
    const sceneFirst = stableJsonStringify(createSceneScriptJsonSchema());
    const sceneSecond = stableJsonStringify(createSceneScriptJsonSchema());

    expect(projectFirst).toBe(projectSecond);
    expect(sceneFirst).toBe(sceneSecond);
    expect(projectFirst.endsWith("\n")).toBe(true);
    expect(sceneFirst.endsWith("\n")).toBe(true);
    expect(JSON.parse(projectFirst)).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://theatrum.local/schemas/project-document.schema.json",
      title: "Theatrum ProjectDocument v1",
    });
    expect(JSON.parse(sceneFirst)).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://theatrum.local/schemas/scene-script.schema.json",
      title: "Theatrum Scene Script v1",
    });
  });

  it("inclui todo o catálogo de verbos no contrato gerado", () => {
    const constants = collectDoConstants(createSceneScriptJsonSchema());
    expect([...constants].sort()).toEqual(VERB_CATALOG.map((entry) => entry.name).sort());
  });

  it("ordena chaves recursivamente sem reordenar arrays", () => {
    expect(stableJsonStringify({ z: 1, a: { y: 2, b: 3 }, list: [{ z: 1, a: 2 }] })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "list": [\n    {\n      "a": 2,\n      "z": 1\n    }\n  ],\n  "z": 1\n}\n',
    );
  });
});

function collectDoConstants(value: unknown): Set<string> {
  const result = new Set<string>();
  visit(value);
  return result;

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current !== "object" || current === null) return;
    const object = current as Record<string, unknown>;
    const properties = object["properties"];
    if (typeof properties === "object" && properties !== null) {
      const doProperty = (properties as Record<string, unknown>)["do"];
      if (typeof doProperty === "object" && doProperty !== null) {
        const constant = (doProperty as Record<string, unknown>)["const"];
        if (typeof constant === "string") result.add(constant);
      }
    }
    Object.values(object).forEach(visit);
  }
}
