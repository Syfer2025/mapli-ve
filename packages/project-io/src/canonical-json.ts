import { err, ok, type Result } from "@theatrum/core-utils";

import { projectError, type ProjectError } from "./errors.js";
import { decodeUtf8, encodeUtf8 } from "./utf8.js";

const IDENTITY_KEYS = ["id", "type", "name"] as const;

export function stringifyCanonicalJson(value: unknown): Result<string, ProjectError> {
  const invalid = validateJsonValue(value, "");
  if (invalid !== null) return err(invalid);

  return ok(`${render(value, 0)}\n`);
}

export function encodeCanonicalJson(value: unknown): Result<Uint8Array, ProjectError> {
  const serialized = stringifyCanonicalJson(value);
  return serialized.ok ? ok(encodeUtf8(serialized.value)) : serialized;
}

export function parseJsonBytes(bytes: Uint8Array, entry: string): Result<unknown, ProjectError> {
  const decoded = decodeUtf8(bytes);
  if (typeof decoded !== "string") return err(decoded);

  try {
    return ok(JSON.parse(decoded) as unknown);
  } catch (cause) {
    return err(
      projectError("invalid-document", `${entry} não contém JSON válido.`, {
        path: entry,
        cause,
      }),
    );
  }
}

function render(value: unknown, depth: number, geoContext = false): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && geoContext) {
      return JSON.stringify(Math.round(value * 10_000_000) / 10_000_000);
    }
    if (typeof value === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) {
      return JSON.stringify(value.toLowerCase());
    }
    return JSON.stringify(value) ?? "null";
  }

  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value
      .map((item) => `${childIndent}${render(item, depth + 1, geoContext)}`)
      .join(",\n")}\n${indent}]`;
  }

  const object = value as Record<string, unknown>;
  const objectIsGeographic = geoContext || object["space"] === "geo";
  const keys = Object.keys(object).sort(compareKeys);
  if (keys.length === 0) return "{}";

  return `{\n${keys
    .map((key) => {
      const childIsGeographic =
        objectIsGeographic || key === "lngLat" || key === "center" || key === "coordinates";
      return `${childIndent}${JSON.stringify(key)}: ${render(
        object[key],
        depth + 1,
        childIsGeographic,
      )}`;
    })
    .join(",\n")}\n${indent}}`;
}

function compareKeys(left: string, right: string): number {
  const leftIdentity = IDENTITY_KEYS.indexOf(left as (typeof IDENTITY_KEYS)[number]);
  const rightIdentity = IDENTITY_KEYS.indexOf(right as (typeof IDENTITY_KEYS)[number]);

  if (leftIdentity !== -1 || rightIdentity !== -1) {
    if (leftIdentity === -1) return 1;
    if (rightIdentity === -1) return -1;
    return leftIdentity - rightIdentity;
  }

  return left < right ? -1 : left > right ? 1 : 0;
}

function validateJsonValue(value: unknown, pointer: string): ProjectError | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? null
      : projectError("invalid-document", `Número não finito em ${pointer || "/"}.`, {
          pointer: pointer || "/",
        });
  }

  if (typeof value !== "object") {
    return projectError(
      "invalid-document",
      `Valor ${typeof value} não é serializável em ${pointer || "/"}.`,
      { pointer: pointer || "/" },
    );
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const error = validateJsonValue(value[index], `${pointer}/${index}`);
      if (error !== null) return error;
    }
    return null;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return projectError("invalid-document", `Objeto não simples em ${pointer || "/"}.`, {
      pointer: pointer || "/",
    });
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPointer = `${pointer}/${escapePointer(key)}`;
    if (child === undefined) {
      return projectError("invalid-document", `undefined não é permitido em ${childPointer}.`, {
        pointer: childPointer,
      });
    }
    const error = validateJsonValue(child, childPointer);
    if (error !== null) return error;
  }

  return null;
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
