/**
 * Prepara o FFmpeg fixado que acompanha o instalador.
 *
 * O export empacotado nunca consulta PATH. Esta etapa copia uma compilação
 * conhecida para `build/ffmpeg` e recusa silenciosamente trocar de versão:
 * codec e bytes de saída não podem depender da máquina que montou o pacote.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_VERSION = "8.1.2-full_build-www.gyan.dev";
const EXPECTED_SHA256 = "ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "build", "ffmpeg", "ffmpeg.exe");

const source = locateFfmpeg();
const version = spawnSync(source, ["-version"], {
  encoding: "utf8",
  windowsHide: true,
  shell: false,
});
if (version.status !== 0 || !version.stdout.includes(EXPECTED_VERSION)) {
  throw new Error(
    `FFmpeg incompatível em ${source}. Esperado ${EXPECTED_VERSION}; use THEATRUM_FFMPEG_PATH para indicar o binário fixado.`,
  );
}

const sourceHash = await sha256(source);
if (sourceHash !== EXPECTED_SHA256) {
  throw new Error(
    `FFmpeg ${EXPECTED_VERSION} tem SHA-256 inesperado (${sourceHash}). O sidecar não foi substituído.`,
  );
}

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
const targetHash = await sha256(target);
if (targetHash !== EXPECTED_SHA256) throw new Error("a cópia do sidecar não passou na verificação");

console.log(`✓ FFmpeg ${EXPECTED_VERSION}`);
console.log(`✓ SHA-256 ${targetHash}`);
console.log(`✓ ${target}`);

function locateFfmpeg(): string {
  const explicit = process.env["THEATRUM_FFMPEG_PATH"];
  if (explicit !== undefined && explicit !== "") return resolve(explicit);
  const localAppData = process.env["LOCALAPPDATA"];
  if (localAppData !== undefined) {
    const wingetLink = join(localAppData, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
    if (existsSync(wingetLink)) return wingetLink;
  }
  const found = spawnSync("where.exe", ["ffmpeg"], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  const first = found.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (found.status !== 0 || first === undefined) {
    throw new Error(
      "FFmpeg não encontrado. Instale a versão fixada ou defina THEATRUM_FFMPEG_PATH.",
    );
  }
  return first;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
