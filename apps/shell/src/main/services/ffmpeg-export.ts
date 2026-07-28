/**
 * Adapter do FFmpeg para GIF e ProRes 4444.
 *
 * Os frames chegam como PNGs RGBA determinísticos numa pasta temporária criada
 * pelo próprio main. O FFmpeg é iniciado sem shell e só recebe caminhos
 * validados dentro do diretório do job.
 */

import { planFfmpegExport } from "@theatrum/export";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";
import type { ExportEncodeRequest, ExportEncodeResult } from "../../ipc/contracts.js";

const STAGING_PREFIX = ".theatrum-frames-";
const MAX_STDERR = 128 * 1024;

export async function encodeExportFrames(
  request: ExportEncodeRequest,
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
  const plan = planFfmpegExport({
    format: request.format,
    fps: request.fps,
    framePattern: join(checked.framesDirectory, `${request.framePrefix}_%0${request.digits}d.png`),
    outputPath: checked.outputPath,
    ...(request.format === "gif" ? { palettePath } : {}),
  });

  try {
    for (const args of plan.passes) await runFfmpeg(args);
    const info = await stat(checked.outputPath);
    const sha256 = await hashFile(checked.outputPath);
    // Só apagamos uma pasta que passou por `validateRequest`: filha direta do
    // job e com prefixo reservado. Nunca há glob nem caminho vindo do FFmpeg.
    await rm(checked.framesDirectory, { recursive: true, force: true });
    return {
      ok: true,
      filename: basename(checked.outputPath),
      bytes: info.size,
      sha256,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      filename: basename(checked.outputPath),
      bytes: 0,
      sha256: "",
      message:
        error instanceof Error
          ? `${error.message} Os PNGs temporários foram preservados em ${checked.framesDirectory}.`
          : String(error),
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

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "");
  return cleaned === "" ? "export" : cleaned;
}
