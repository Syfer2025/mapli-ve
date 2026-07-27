import { err, ok, type Result } from "@theatrum/core-utils";

import { projectError, type ProjectError } from "./errors.js";
import { sha256 } from "./sha256.js";

export interface ContentAddressedAsset {
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly path: string;
}

export function contentAddressAsset(
  bytes: Uint8Array,
  extension: string,
): Result<ContentAddressedAsset, ProjectError> {
  const normalizedExtension = extension.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,15}$/.test(normalizedExtension)) {
    return err(
      projectError("invalid-document", `Extensão de asset inválida: "${extension}".`, {
        actual: extension,
      }),
    );
  }

  const hash = sha256(bytes);
  return ok({
    bytes,
    hash,
    path: `assets/${hash.slice(0, 2)}/${hash}.${normalizedExtension}`,
  });
}

export function verifyContentAddressedAsset(
  path: string,
  bytes: Uint8Array,
): Result<void, ProjectError> {
  const match = /^assets\/([0-9a-f]{2})\/([0-9a-f]{64})\.[a-z0-9._-]+$/.exec(path);
  if (match === null || match[1] !== match[2]?.slice(0, 2)) {
    return err(projectError("asset-corrupt", `Caminho de asset inválido: "${path}".`, { path }));
  }

  const actual = sha256(bytes);
  const expected = match[2] as string;
  return actual === expected
    ? ok(undefined)
    : err(
        projectError("asset-corrupt", `Asset corrompido: o conteúdo não corresponde a ${path}.`, {
          path,
          expected,
          actual,
        }),
      );
}
