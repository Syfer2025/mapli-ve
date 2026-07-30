/**
 * Adapter do FFmpeg para GIF e ProRes 4444.
 *
 * Os frames chegam como PNGs RGBA determinísticos numa pasta temporária criada
 * pelo próprio main. O FFmpeg é iniciado sem shell e só recebe caminhos
 * validados dentro do diretório do job.
 */

import { planFfmpegExport } from "@theatrum/export";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";
import type { ExportEncodeRequest, ExportEncodeResult } from "../../ipc/contracts.js";
import { finalizeExportFile } from "./export-publication.js";

const STAGING_PREFIX = ".theatrum-frames-";
const MAX_STDERR = 128 * 1024;

export interface EncodeExportDependencies {
  readonly runFfmpeg?: (args: readonly string[]) => Promise<void>;
  readonly temporaryId?: () => string;
  readonly finalize?: typeof finalizeExportFile;
}

/** Codifica e só publica o nome final depois de todos os passes concluírem. */
export async function encodeExportFrames(
  request: ExportEncodeRequest,
  dependencies: EncodeExportDependencies = {},
): Promise<ExportEncodeResult> {
  const checked = validateRequest(request);
  if (!checked.ok) {
    return {
      ok: false,
      filename: request.outputFilename,
      bytes: 0,
      sha256: "",
      message: checked.message,
    };
  }
  const palettePath = join(checked.framesDirectory, "palette.png");
  // Preserva a extensão para o muxer do FFmpeg reconhecer o contêiner, mas não
  // entrega o nome final: uma falha nunca pode deixar um GIF/MOV parcial com o
  // nome que a UI apresentará como concluído.
  const temporaryFilename = `.theatrum-${dependencies.temporaryId?.() ?? randomUUID()}-${request.outputFilename}`;
  const temporaryOutputPath = join(checked.directory, temporaryFilename);
  const executeFfmpeg = dependencies.runFfmpeg ?? runFfmpeg;
  const finalize = dependencies.finalize ?? finalizeExportFile;
  const plan = planFfmpegExport({
    format: request.format,
    fps: request.fps,
    framePattern: join(checked.framesDirectory, `${request.framePrefix}_%0${request.digits}d.png`),
    outputPath: temporaryOutputPath,
    ...(request.format === "gif" ? { palettePath } : {}),
  });

  try {
    for (const args of plan.passes) await executeFfmpeg(args);
    const published = await finalize({
      action: "publish",
      directory: checked.directory,
      temporaryFilename,
      finalFilename: request.outputFilename,
    });
    if (!published.ok) {
      return {
        ok: false,
        filename: basename(checked.outputPath),
        bytes: 0,
        sha256: "",
        message: `${published.message ?? "não foi possível publicar o arquivo final"}. Os PNGs temporários foram preservados em ${checked.framesDirectory}.`,
      };
    }
    // Só apagamos uma pasta que passou por `validateRequest`: filha direta do
    // job e com prefixo reservado. Nunca há glob nem caminho vindo do FFmpeg.
    let stagingMessage: string | undefined;
    try {
      await rm(checked.framesDirectory, { recursive: true, force: true });
    } catch (cleanupError: unknown) {
      // O arquivo já foi publicado por rename. Falhar ao limpar material de
      // diagnóstico não transforma um vídeo completo em falha nem tenta
      // desfazer a publicação.
      stagingMessage = `Arquivo final publicado, mas os PNGs temporários foram preservados em ${checked.framesDirectory}: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`;
    }
    return {
      ok: true,
      filename: published.filename,
      bytes: published.bytes,
      sha256: published.sha256,
      ...(stagingMessage === undefined ? {} : { message: stagingMessage }),
    };
  } catch (error: unknown) {
    const cleanup = await finalize({
      action: "discard",
      directory: checked.directory,
      temporaryFilename,
    });
    const cleanupMessage =
      cleanup.message ??
      (cleanup.temporaryDisposition === "preserved"
        ? "O arquivo temporário de vídeo foi preservado."
        : "O arquivo temporário de vídeo foi removido.");
    return {
      ok: false,
      filename: basename(checked.outputPath),
      bytes: 0,
      sha256: "",
      message:
        error instanceof Error
          ? `${error.message} ${cleanupMessage} Os PNGs temporários foram preservados em ${checked.framesDirectory}.`
          : `${String(error)} ${cleanupMessage}`,
    };
  }
}

function validateRequest(request: ExportEncodeRequest):
  | {
      readonly ok: true;
      readonly directory: string;
      readonly framesDirectory: string;
      readonly outputPath: string;
    }
  | { readonly ok: false; readonly message: string } {
  if (!isAbsolute(request.directory) || !isAbsolute(request.framesDirectory)) {
    return { ok: false, message: "diretório de exportação inválido" };
  }
  const directory = resolve(request.directory);
  const framesDirectory = resolve(request.framesDirectory);
  if (
    dirname(framesDirectory) !== directory ||
    !basename(framesDirectory).startsWith(STAGING_PREFIX)
  ) {
    return { ok: false, message: "pasta temporária não pertence a este job" };
  }
  if (!/^[\p{L}\p{N}._-]{1,64}$/u.test(request.framePrefix)) {
    return { ok: false, message: "prefixo dos frames inválido" };
  }
  if (!Number.isInteger(request.digits) || request.digits < 4 || request.digits > 9) {
    return { ok: false, message: "quantidade de dígitos dos frames inválida" };
  }
  const expectedExtension = request.format === "gif" ? ".gif" : ".mov";
  if (
    safeSegment(request.outputFilename) !== request.outputFilename ||
    extname(request.outputFilename).toLowerCase() !== expectedExtension
  ) {
    return { ok: false, message: `arquivo de saída precisa terminar em ${expectedExtension}` };
  }
  const outputPath = resolve(directory, request.outputFilename);
  if (dirname(outputPath) !== directory) {
    return { ok: false, message: "arquivo de saída escaparia da pasta do job" };
  }
  return { ok: true, directory, framesDirectory, outputPath };
}

async function runFfmpeg(args: readonly string[]): Promise<void> {
  const executable = ffmpegExecutable();
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      windowsHide: true,
      shell: false,
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.slice(0, MAX_STDERR - stderr.length);
    });
    child.once("error", (error) => {
      reject(
        new Error(
          error.message.includes("ENOENT")
            ? "FFmpeg não foi encontrado. Reinstale o aplicativo com o componente de vídeo."
            : `não foi possível iniciar o FFmpeg: ${error.message}`,
        ),
      );
    });
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`FFmpeg falhou (${code ?? "sem código"}): ${stderr.trim()}`));
    });
  });
}

function ffmpegExecutable(): string {
  const explicit = process.env["THEATRUM_FFMPEG_PATH"];
  if (explicit !== undefined && explicit !== "") return explicit;
  if (app.isPackaged) {
    // Em produção o sidecar é parte do aplicativo. Não cair para o PATH:
    // encontrar por acaso outra versão instalada tornaria codec e bytes de
    // saída dependentes da máquina, justamente o que o export não pode fazer.
    return join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
  }
  return "ffmpeg";
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "");
  return cleaned === "" ? "export" : cleaned;
}
