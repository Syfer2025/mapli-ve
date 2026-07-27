import { err, ok, type Result } from "@theatrum/core-utils";

import { projectError, type ProjectError } from "./errors.js";

export type JsonPatchOperation =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown };

export function diffJson(previous: unknown, next: unknown): readonly JsonPatchOperation[] {
  const operations: JsonPatchOperation[] = [];
  appendDiff(previous, next, "", operations);
  return operations;
}

export function applyJsonPatch(
  document: unknown,
  operations: readonly JsonPatchOperation[],
): Result<unknown, ProjectError> {
  let result = cloneJson(document);

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    if (operation === undefined) continue;

    if (operation.path === "") {
      if (operation.op === "remove") {
        return err(
          projectError("invalid-document", "Um patch não pode remover a raiz.", {
            pointer: `/operations/${index}/path`,
          }),
        );
      }
      result = cloneJson(operation.value);
      continue;
    }

    const segments = parsePointer(operation.path);
    if (!segments.ok) return segments;
    const parent = locateParent(result, segments.value);
    if (!parent.ok) return parent;
    const key = segments.value.at(-1) as string;

    if (Array.isArray(parent.value)) {
      const arrayIndex = key === "-" ? parent.value.length : parseArrayIndex(key);
      if (arrayIndex === null) {
        return err(
          projectError("invalid-document", `Índice de array inválido: "${key}".`, {
            pointer: operation.path,
          }),
        );
      }
      if (operation.op === "add") {
        if (arrayIndex > parent.value.length) return missingPath(operation.path);
        parent.value.splice(arrayIndex, 0, cloneJson(operation.value));
      } else if (operation.op === "remove") {
        if (arrayIndex >= parent.value.length) return missingPath(operation.path);
        parent.value.splice(arrayIndex, 1);
      } else {
        if (arrayIndex >= parent.value.length) return missingPath(operation.path);
        parent.value[arrayIndex] = cloneJson(operation.value);
      }
    } else {
      if (operation.op === "remove") {
        if (!Object.hasOwn(parent.value, key)) return missingPath(operation.path);
        delete parent.value[key];
      } else {
        if (operation.op === "replace" && !Object.hasOwn(parent.value, key)) {
          return missingPath(operation.path);
        }
        parent.value[key] = cloneJson(operation.value);
      }
    }
  }

  return ok(result);
}

function appendDiff(
  previous: unknown,
  next: unknown,
  path: string,
  operations: JsonPatchOperation[],
): void {
  if (Object.is(previous, next)) return;

  if (Array.isArray(previous) && Array.isArray(next)) {
    const commonLength = Math.min(previous.length, next.length);
    for (let index = 0; index < commonLength; index++) {
      appendDiff(previous[index], next[index], `${path}/${index}`, operations);
    }
    for (let index = previous.length - 1; index >= next.length; index--) {
      operations.push({ op: "remove", path: `${path}/${index}` });
    }
    for (let index = commonLength; index < next.length; index++) {
      operations.push({ op: "add", path: `${path}/${index}`, value: cloneJson(next[index]) });
    }
    return;
  }

  if (isRecord(previous) && isRecord(next)) {
    const previousKeys = Object.keys(previous).sort(compareStrings);
    const nextKeys = Object.keys(next).sort(compareStrings);
    const nextSet = new Set(nextKeys);
    const previousSet = new Set(previousKeys);

    for (const key of previousKeys) {
      if (!nextSet.has(key))
        operations.push({ op: "remove", path: `${path}/${escapePointer(key)}` });
    }
    for (const key of nextKeys) {
      const childPath = `${path}/${escapePointer(key)}`;
      if (!previousSet.has(key)) {
        operations.push({ op: "add", path: childPath, value: cloneJson(next[key]) });
      } else {
        appendDiff(previous[key], next[key], childPath, operations);
      }
    }
    return;
  }

  operations.push({ op: "replace", path, value: cloneJson(next) });
}

function locateParent(
  root: unknown,
  segments: readonly string[],
): Result<Record<string, unknown> | unknown[], ProjectError> {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment);
      if (index === null || index >= current.length) return missingPath(`/${segments.join("/")}`);
      current = current[index];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return missingPath(`/${segments.join("/")}`);
    }
  }
  return Array.isArray(current) || isRecord(current)
    ? ok(current)
    : err(
        projectError("invalid-document", "O pai do caminho do patch não é um container.", {
          pointer: `/${segments.join("/")}`,
        }),
      );
}

function parsePointer(pointer: string): Result<readonly string[], ProjectError> {
  if (!pointer.startsWith("/")) {
    return err(
      projectError("invalid-document", `JSON Pointer inválido: "${pointer}".`, {
        pointer,
      }),
    );
  }
  return ok(
    pointer
      .slice(1)
      .split("/")
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~")),
  );
}

function parseArrayIndex(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
    ) as T;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function missingPath(path: string): Result<never, ProjectError> {
  return err(
    projectError("invalid-document", `Caminho de patch inexistente: "${path}".`, {
      pointer: path,
    }),
  );
}
