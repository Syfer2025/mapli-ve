/**
 * Prova integrada dos formatos FFmpeg da Fase 8.
 *
 * Usa o mesmo plano puro consumido pelo processo main, codifica cada arquivo
 * duas vezes e inspeciona codec, contagem de frames e plano alfa. Não abre o
 * editor: o pump e o compositor já têm sua prova no `verify:phase8`.
 */

// Verificador executável pelo Node cru; importa o módulo sem depender do resolver do app.
// eslint-disable-next-line theatrum/enforce-barrel-imports
import { planFfmpegExport } from "../packages/export/src/ffmpeg-plan.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";

interface ProcessOutput {
  readonly stdout: Buffer;
  readonly stderr: string;
}

interface ProbeStream {
  readonly codec_name?: string;
  readonly profile?: string;
  readonly pix_fmt?: string;
  readonly nb_frames?: string;
}

const ffmpeg = process.env["THEATRUM_FFMPEG_PATH"] || "ffmpeg";
const ffprobe =
  process.env["THEATRUM_FFPROBE_PATH"] ||
  (ffmpeg.toLowerCase().endsWith("ffmpeg.exe")
    ? join(dirname(ffmpeg), "ffprobe.exe")
    : ffmpeg === "ffmpeg"
      ? "ffprobe"
      : join(dirname(ffmpeg), "ffprobe"));

const workspace = await mkdtemp(join(tmpdir(), "theatrum-phase8-formats-"));
const framesDirectory = join(workspace, "frames");
const framePattern = join(framesDirectory, "Alpha_%04d.png");

try {
  await mkdir(framesDirectory);
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black@0.0:s=96x64:r=12:d=0.5,format=rgba,drawbox=x=12:y=12:w=28:h=28:color=red@0.7:t=fill:replace=1",
    "-frames:v",
    "6",
    "-start_number",
    "0",
    framePattern,
  ]);

  const movHashes: string[] = [];
  const gifHashes: string[] = [];
  for (const attempt of [1, 2]) {
    const mov = join(workspace, `Alpha-${attempt}.mov`);
    const movPlan = planFfmpegExport({
      format: "prores4444",
      fps: 12,
      framePattern,
      outputPath: mov,
    });
    for (const pass of movPlan.passes) await run(ffmpeg, pass);
    movHashes.push(await sha256(mov));

    const gif = join(workspace, `Alpha-${attempt}.gif`);
    const gifPlan = planFfmpegExport({
      format: "gif",
      fps: 12,
      framePattern,
      palettePath: join(workspace, `palette-${attempt}.png`),
      outputPath: gif,
    });
    for (const pass of gifPlan.passes) await run(ffmpeg, pass);
    gifHashes.push(await sha256(gif));
  }

  const mov = join(workspace, "Alpha-1.mov");
  const gif = join(workspace, "Alpha-1.gif");
  const movStream = await probe(mov);
  const gifStream = await probe(gif);
  const alpha = await decodedAlphaRange(mov);

  const checks = [
    check("ProRes repetível", movHashes[0] === movHashes[1], movHashes[0] ?? ""),
    check("GIF repetível", gifHashes[0] === gifHashes[1], gifHashes[0] ?? ""),
    check(
      "ProRes 4444 com alfa",
      movStream.codec_name === "prores" &&
        movStream.profile === "4444" &&
        movStream.pix_fmt?.startsWith("yuva") === true,
      `${movStream.profile ?? "?"} · ${movStream.pix_fmt ?? "?"}`,
    ),
    check(
      "alfa não foi achatado",
      alpha.max > alpha.min,
      `plano decodificado ${alpha.min}–${alpha.max}`,
    ),
    check(
      "GIF animado completo",
      gifStream.codec_name === "gif" && Number(gifStream.nb_frames) === 6,
      `${gifStream.nb_frames ?? "?"} frames`,
    ),
  ];

  for (const [index, item] of checks.entries()) {
    console.log(
      `${item.ok ? "✓" : "✗"} ${index + 1}/${checks.length} ${item.label}: ${item.detail}`,
    );
  }
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
} finally {
  await rm(workspace, { recursive: true, force: true });
}

function check(
  label: string,
  ok: boolean,
  detail: string,
): { readonly label: string; readonly ok: boolean; readonly detail: string } {
  return { label, ok, detail };
}

async function probe(path: string): Promise<ProbeStream> {
  const output = await run(ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name,profile,pix_fmt,nb_frames",
    "-of",
    "json",
    path,
  ]);
  const parsed = JSON.parse(output.stdout.toString("utf8")) as {
    readonly streams?: readonly ProbeStream[];
  };
  return parsed.streams?.[0] ?? {};
}

async function decodedAlphaRange(
  path: string,
): Promise<{ readonly min: number; readonly max: number }> {
  const output = await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    path,
    "-vf",
    "alphaextract",
    "-frames:v",
    "1",
    "-pix_fmt",
    "gray16le",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  let min = 0xffff;
  let max = 0;
  for (let offset = 0; offset + 1 < output.stdout.byteLength; offset += 2) {
    const value = output.stdout.readUInt16LE(offset);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function run(executable: string, args: readonly string[]): Promise<ProcessOutput> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      windowsHide: true,
      shell: false,
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      const errorText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolvePromise({ stdout: Buffer.concat(stdout), stderr: errorText });
      } else {
        reject(
          new Error(
            `${basename(executable)} falhou (${code ?? "sem código"}): ${errorText.trim()}`,
          ),
        );
      }
    });
  });
}
