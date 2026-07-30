import { SCENE_SCRIPT_VERSION, SceneScriptSchema, type SceneScript } from "@theatrum/schema";
import type { SceneDiagnostic, SceneVerbRegistry } from "./contracts.js";
import { diagnostic, pointer, suggest } from "./diagnostics.js";

const ROOT_FIELDS = [
  "format",
  "version",
  "meta",
  "map",
  "defaults",
  "places",
  "paths",
  "factions",
  "units",
  "timeline",
] as const;
const ROOT_REQUIRED = ["format", "version", "meta", "timeline"] as const;
const META_FIELDS = ["title", "fps", "resolution", "duration", "background"] as const;
const META_REQUIRED = ["title", "fps", "resolution", "duration"] as const;
const MAP_FIELDS = ["style", "projection", "terrain"] as const;
const TERRAIN_FIELDS = ["enabled", "exaggeration"] as const;
const DEFAULT_FIELDS = ["unitSize", "textFont", "ease", "labelPosition"] as const;
const PATH_FIELDS = [
  "through",
  "smooth",
  "geodesic",
  "altitude",
  "arc",
  "style",
  "visible",
] as const;
const PATH_STYLE_FIELDS = ["stroke", "width", "dash", "arrow"] as const;
const FACTION_FIELDS = ["color", "label"] as const;
const UNIT_FIELDS = ["id", "kind", "faction", "at", "label", "size", "icon", "bearing"] as const;

export function decodeSceneInput(
  input: string | unknown,
  registry: SceneVerbRegistry,
): { readonly scene: SceneScript | null; readonly diagnostics: readonly SceneDiagnostic[] } {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "JSON inválido";
      return {
        scene: null,
        diagnostics: [
          diagnostic("error", "invalid-json", "", `não foi possível ler o JSON: ${message}`, {
            hint: "corrija vírgulas, aspas e chaves antes de compilar",
          }),
        ],
      };
    }
  }

  const diagnostics: SceneDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      scene: null,
      diagnostics: [
        diagnostic("error", "invalid-type", "", "Scene Script deve ser um objeto JSON"),
      ],
    };
  }

  checkFields(value, [], ROOT_FIELDS, ROOT_REQUIRED, diagnostics);
  if (typeof value["version"] === "number" && value["version"] > SCENE_SCRIPT_VERSION) {
    diagnostics.push(
      diagnostic(
        "error",
        "schema",
        "/version",
        `Scene Script version ${value["version"]} é mais novo que o suportado (${SCENE_SCRIPT_VERSION})`,
        { hint: "use version 1 ou atualize o Theatrum" },
      ),
    );
  }
  if (isRecord(value["meta"])) {
    checkFields(value["meta"], ["meta"], META_FIELDS, META_REQUIRED, diagnostics);
  } else if ("meta" in value) {
    diagnostics.push(diagnostic("error", "invalid-type", "/meta", "meta deve ser um objeto JSON"));
  }
  if (isRecord(value["map"])) {
    checkFields(value["map"], ["map"], MAP_FIELDS, [], diagnostics);
    if (isRecord(value["map"]["terrain"])) {
      checkFields(
        value["map"]["terrain"],
        ["map", "terrain"],
        TERRAIN_FIELDS,
        ["enabled"],
        diagnostics,
      );
    }
  }
  if (isRecord(value["defaults"])) {
    checkFields(value["defaults"], ["defaults"], DEFAULT_FIELDS, [], diagnostics);
  }
  checkRecordValues(value["paths"], "paths", PATH_FIELDS, diagnostics, (path, pathParts) => {
    if (isRecord(path["style"])) {
      checkFields(path["style"], [...pathParts, "style"], PATH_STYLE_FIELDS, [], diagnostics);
    }
  });
  checkRecordValues(value["factions"], "factions", FACTION_FIELDS, diagnostics);

  if (Array.isArray(value["units"])) {
    value["units"].forEach((unit, index) => {
      if (!isRecord(unit)) {
        diagnostics.push(
          diagnostic(
            "error",
            "invalid-type",
            pointer(["units", index]),
            "cada unidade deve ser um objeto",
          ),
        );
        return;
      }
      checkFields(unit, ["units", index], UNIT_FIELDS, ["id", "kind", "at"], diagnostics);
    });
  } else if (value["units"] !== undefined) {
    diagnostics.push(diagnostic("error", "invalid-type", "/units", "units deve ser um array"));
  }

  if (Array.isArray(value["timeline"])) {
    value["timeline"].forEach((entry, index) => {
      const base = ["timeline", index] as const;
      if (!isRecord(entry)) {
        diagnostics.push(
          diagnostic(
            "error",
            "invalid-type",
            pointer(base),
            "cada entrada da timeline deve ser um objeto",
          ),
        );
        return;
      }
      if (typeof entry["do"] !== "string") {
        diagnostics.push(
          diagnostic(
            "error",
            "missing-field",
            pointer([...base, "do"]),
            'campo obrigatório "do" ausente ou inválido',
          ),
        );
        return;
      }
      const definition = registry.get(entry["do"]);
      if (definition === undefined) {
        diagnostics.push(
          diagnostic(
            "error",
            "unknown-verb",
            pointer([...base, "do"]),
            `verbo "${entry["do"]}" desconhecido`,
            {
              hint: "use um verbo documentado no registry Scene Script v1",
              didYouMean: registry.suggest(entry["do"]),
            },
          ),
        );
        if (!("at" in entry)) {
          diagnostics.push(
            diagnostic(
              "error",
              "missing-field",
              pointer([...base, "at"]),
              'campo obrigatório "at" ausente',
            ),
          );
        }
        return;
      }
      checkFields(entry, base, ["do", ...definition.fields], definition.required, diagnostics);
    });
  } else if ("timeline" in value) {
    diagnostics.push(
      diagnostic("error", "invalid-type", "/timeline", "timeline deve ser um array"),
    );
  }

  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { scene: null, diagnostics };
  }

  const parsed = SceneScriptSchema.safeParse(value);
  if (parsed.success) return { scene: parsed.data, diagnostics };
  for (const issue of expandSchemaIssues(parsed.error.issues as readonly RawSchemaIssue[])) {
    diagnostics.push(
      diagnostic("error", "schema", pointer(issue.path), schemaIssueMessage(issue.message), {
        hint: "consulte o tipo e o exemplo desse campo em LLM_AUTHORING.md",
      }),
    );
  }
  return { scene: null, diagnostics };
}

interface RawSchemaIssue {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly errors?: readonly (readonly RawSchemaIssue[])[];
}

function expandSchemaIssues(
  issues: readonly RawSchemaIssue[],
  prefix: readonly (string | number)[] = [],
): readonly RawSchemaIssue[] {
  const expanded: RawSchemaIssue[] = [];
  for (const issue of issues) {
    const path = [...prefix, ...issue.path];
    if (issue.code !== "invalid_union" || issue.errors === undefined) {
      expanded.push({ ...issue, path });
      continue;
    }
    const matchingBranch = issue.errors.find(
      (branch) =>
        !branch.some(
          (candidate) => candidate.path[0] === "do" && candidate.code === "invalid_value",
        ),
    );
    if (matchingBranch === undefined) {
      expanded.push({ ...issue, path });
    } else {
      expanded.push(...expandSchemaIssues(matchingBranch, path));
    }
  }
  return expanded;
}

function checkRecordValues(
  value: unknown,
  field: string,
  fields: readonly string[],
  diagnostics: SceneDiagnostic[],
  visit?: (value: Record<string, unknown>, parts: readonly (string | number)[]) => void,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic("error", "invalid-type", pointer([field]), `${field} deve ser um objeto`),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const parts = [field, key] as const;
    if (!isRecord(child)) {
      diagnostics.push(
        diagnostic("error", "invalid-type", pointer(parts), `${field}/${key} deve ser um objeto`),
      );
      continue;
    }
    checkFields(child, parts, fields, [], diagnostics);
    visit?.(child, parts);
  }
}

function checkFields(
  value: Record<string, unknown>,
  parts: readonly (string | number)[],
  allowed: readonly string[],
  required: readonly string[],
  diagnostics: SceneDiagnostic[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (allowedSet.has(key)) continue;
    diagnostics.push(
      diagnostic(
        "error",
        "unknown-field",
        pointer([...parts, key]),
        `campo desconhecido "${key}"`,
        {
          hint: "remova o campo ou use a grafia documentada",
          didYouMean: suggest(key, allowed),
        },
      ),
    );
  }
  for (const key of required) {
    if (key in value) continue;
    diagnostics.push(
      diagnostic(
        "error",
        "missing-field",
        pointer([...parts, key]),
        `campo obrigatório "${key}" ausente`,
      ),
    );
  }
}

function schemaIssueMessage(message: string): string {
  return message === "Invalid input" ? "valor não corresponde ao tipo esperado" : message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
