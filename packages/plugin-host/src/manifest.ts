import { err, ok, type Result } from "@theatrum/core-utils";

export const PLUGIN_API_VERSION = 1 as const;

export const EXTENSION_POINT_NAMES = [
  "nodeTypes",
  "effects",
  "actions",
  "verbs",
  "exporters",
  "panels",
  "mapStyles",
  "commands",
] as const;

export type ExtensionPointName = (typeof EXTENSION_POINT_NAMES)[number];

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: typeof PLUGIN_API_VERSION;
  readonly entry: string;
  readonly description?: string;
  readonly contributes: Readonly<Partial<Record<ExtensionPointName, readonly string[]>>>;
}

export interface ManifestDiagnostic {
  readonly path: string;
  readonly message: string;
}

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function parsePluginManifest(
  input: unknown,
): Result<PluginManifest, readonly ManifestDiagnostic[]> {
  const diagnostics: ManifestDiagnostic[] = [];
  if (!isRecord(input)) {
    return err([{ path: "", message: "O manifest deve ser um objeto JSON." }]);
  }

  const id = readString(input, "id", diagnostics);
  const name = readString(input, "name", diagnostics);
  const version = readString(input, "version", diagnostics);
  const entry = readString(input, "entry", diagnostics);
  const apiVersion = input["apiVersion"];
  const description = readOptionalString(input, "description", diagnostics);

  if (id !== undefined && !PLUGIN_ID_PATTERN.test(id)) {
    diagnostics.push({
      path: "/id",
      message: 'Use um identificador reverso, por exemplo "com.exemplo.plugin".',
    });
  }
  if (version !== undefined && !SEMVER_PATTERN.test(version)) {
    diagnostics.push({ path: "/version", message: "A versão deve seguir SemVer." });
  }
  if (apiVersion !== PLUGIN_API_VERSION) {
    diagnostics.push({
      path: "/apiVersion",
      message: `A versão de API suportada é ${PLUGIN_API_VERSION}.`,
    });
  }
  if (entry !== undefined && !isSafeRelativePath(entry)) {
    diagnostics.push({
      path: "/entry",
      message: "A entrada deve ser um caminho relativo interno, sem '..'.",
    });
  }

  const contributes = parseContributes(input["contributes"], diagnostics);
  if (
    diagnostics.length > 0 ||
    id === undefined ||
    name === undefined ||
    version === undefined ||
    entry === undefined
  ) {
    return err(Object.freeze(diagnostics));
  }

  const manifest: PluginManifest = {
    id,
    name,
    version,
    apiVersion: PLUGIN_API_VERSION,
    entry,
    contributes,
    ...(description === undefined ? {} : { description }),
  };
  return ok(Object.freeze(manifest));
}

function parseContributes(
  input: unknown,
  diagnostics: ManifestDiagnostic[],
): PluginManifest["contributes"] {
  if (input === undefined) return Object.freeze({});
  if (!isRecord(input)) {
    diagnostics.push({ path: "/contributes", message: "contributes deve ser um objeto." });
    return Object.freeze({});
  }

  const result: Partial<Record<ExtensionPointName, readonly string[]>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isExtensionPointName(key)) {
      diagnostics.push({
        path: `/contributes/${key}`,
        message: `Ponto de extensão desconhecido: "${key}".`,
      });
      continue;
    }
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || item.trim().length === 0)
    ) {
      diagnostics.push({
        path: `/contributes/${key}`,
        message: "A contribuição deve ser uma lista de identificadores não vazios.",
      });
      continue;
    }
    result[key] = Object.freeze(value.map((item) => item.trim()));
  }
  return Object.freeze(result);
}

function isExtensionPointName(value: string): value is ExtensionPointName {
  return (EXTENSION_POINT_NAMES as readonly string[]).includes(value);
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return false;
  }
  return normalized.split("/").every((part) => part !== ".." && part !== "");
}

function readString(
  input: Record<string, unknown>,
  key: string,
  diagnostics: ManifestDiagnostic[],
): string | undefined {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push({ path: `/${key}`, message: `${key} deve ser uma string não vazia.` });
    return undefined;
  }
  return value.trim();
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string,
  diagnostics: ManifestDiagnostic[],
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push({ path: `/${key}`, message: `${key} deve ser uma string não vazia.` });
    return undefined;
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
