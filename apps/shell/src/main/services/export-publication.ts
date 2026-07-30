/**
 * Publicação transacional de arquivos únicos de exportação.
 *
 * MP4, GIF e ProRes nascem sob um nome reservado. O nome pedido pelo usuário só
 * aparece por `rename` depois de encoder, muxer e escritas terminarem. Como os
 * dois caminhos ficam no mesmo diretório, a troca é atômica no sistema de
 * arquivos: observadores veem o arquivo anterior ou o novo completo, nunca um
 * prefixo reproduzível pela metade.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { ExportFinalizeRequest, ExportFinalizeResult } from "../../ipc/contracts.js";

const TEMPORARY_PREFIX = ".theatrum-";

export async function finalizeExportFile(
  request: ExportFinalizeRequest,
): Promise<ExportFinalizeResult> {
  const checked = validateRequest(request);
  if (!checked.ok) {
    return {
      ok: false,
      filename: "",
      bytes: 0,
      sha256: "",
      temporaryDisposition: "preserved",
      message: checked.message,
    };
  }

  if (request.action === "discard") {
    try {
      await rm(checked.temporaryPath);
      return {
        ok: true,
        filename: basename(checked.temporaryPath),
        bytes: 0,
        sha256: "",
        temporaryDisposition: "removed",
        message: `arquivo temporário removido: ${checked.temporaryPath}`,
      };
    } catch (error: unknown) {
      if (isMissing(error)) {
        return {
          ok: true,
          filename: basename(checked.temporaryPath),
          bytes: 0,
          sha256: "",
          temporaryDisposition: "missing",
          message: "nenhum arquivo temporário existia para remover",
        };
      }
      return {
        ok: false,
        filename: basename(checked.temporaryPath),
        bytes: 0,
        sha256: "",
        temporaryDisposition: "preserved",
        message: `não foi possível remover o temporário; preservado em ${checked.temporaryPath}: ${describeError(error)}`,
      };
    }
  }

  try {
    // Tudo que pode falhar ao ler o arquivo acontece antes do ponto de
    // publicação. Depois do rename não há nova etapa capaz de devolver "falhou"
    // deixando, ao mesmo tempo, um resultado completo já visível.
    const info = await stat(checked.temporaryPath);
    const sha256 = await hashFile(checked.temporaryPath);
    await rename(checked.temporaryPath, checked.finalPath);
    return {
      ok: true,
      filename: basename(checked.finalPath),
      bytes: info.size,
      sha256,
      temporaryDisposition: "published",
    };
  } catch (error: unknown) {
    const temporaryStillExists = await exists(checked.temporaryPath);
    return {
      ok: false,
      filename: basename(checked.finalPath),
      bytes: 0,
      sha256: "",
      temporaryDisposition: temporaryStillExists ? "preserved" : "missing",
      message: temporaryStillExists
        ? `não foi possível publicar; temporário preservado em ${checked.temporaryPath}: ${describeError(error)}`
        : `não foi possível publicar e o temporário não foi encontrado: ${describeError(error)}`,
    };
  }
}

type CheckedRequest =
  | {
      readonly ok: true;
      readonly temporaryPath: string;
      readonly finalPath: string;
    }
  | { readonly ok: false; readonly message: string };

function validateRequest(request: ExportFinalizeRequest): CheckedRequest {
  if (!isAbsolute(request.directory)) {
    return { ok: false, message: "diretório de exportação não é absoluto" };
  }
  const directory = resolve(request.directory);
  if (
    !isSafeSegment(request.temporaryFilename) ||
    !request.temporaryFilename.startsWith(TEMPORARY_PREFIX)
  ) {
    return { ok: false, message: "nome temporário de exportação inválido" };
  }
  const temporaryPath = resolve(directory, request.temporaryFilename);
  if (dirname(temporaryPath) !== directory) {
    return { ok: false, message: "arquivo temporário escaparia da pasta do job" };
  }

  if (request.action === "discard") {
    return { ok: true, temporaryPath, finalPath: temporaryPath };
  }
  if (!isSafeSegment(request.finalFilename) || request.finalFilename.startsWith(TEMPORARY_PREFIX)) {
    return { ok: false, message: "nome final de exportação inválido" };
  }
  const finalPath = resolve(directory, request.finalFilename);
  if (dirname(finalPath) !== directory) {
    return { ok: false, message: "arquivo final escaparia da pasta do job" };
  }
  return { ok: true, temporaryPath, finalPath };
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if (isMissing(error)) return false;
    return true;
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSafeSegment(value: string): boolean {
  return (
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    basename(value) === value &&
    !/[\\/:*?"<>|]/.test(value)
  );
}
