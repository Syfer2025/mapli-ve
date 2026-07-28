/**
 * Baixa a pirâmide raster offline do Estreito de Hormuz.
 *
 * A fonte é o EOxCloudless Sentinel-2 de 2016, CC BY 4.0. O recorte pequeno
 * evita transformar o bootstrap comum em um download de vários gigabytes e
 * mantém a resolução nativa do mosaico no zoom 14.
 *
 * Uso:
 *   pnpm satellite:hormuz
 *   pnpm satellite:hormuz:verify
 */

import { mkdir, open, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.join(ROOT, "data", "raster", "eox-s2cloudless-2016-hormuz");
const MANIFEST_PATH = path.join(ROOT, "data", "raster", "basemap.json");
const BOUNDS = [54, 24.2, 58.8, 28.1] as const;
const MIN_ZOOM = 0;
const MAX_ZOOM = 13;
const CONCURRENCY = 6;
const VERIFY_ONLY = process.argv.includes("--verify");
const SOURCE_BASE = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g";

interface Tile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

function tileCoordinate(
  longitude: number,
  latitude: number,
  zoom: number,
): readonly [number, number] {
  const dimension = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * dimension);
  const latitudeRadians = (latitude * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * dimension);
  return [x, y];
}

function tilesInBounds(): readonly Tile[] {
  const tiles: Tile[] = [];
  const [west, south, east, north] = BOUNDS;
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    const [minX, minY] = tileCoordinate(west, north, z);
    const [maxX, maxY] = tileCoordinate(east, south, z);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) tiles.push({ z, x, y });
    }
  }
  return tiles;
}

function targetPath(tile: Tile): string {
  return path.join(OUTPUT_ROOT, String(tile.z), String(tile.x), `${tile.y}.jpg`);
}

async function isUsable(target: string): Promise<boolean> {
  try {
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size < 100) return false;
    const handle = await open(target, "r");
    try {
      const header = Buffer.alloc(4);
      await handle.read(header, 0, header.length, 0);
      const jpeg = header[0] === 0xff && header[1] === 0xd8;
      const png =
        header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
      return jpeg || png;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function sourceUrl(tile: Tile): string {
  // WMTS é linha/coluna; a pirâmide local é XYZ coluna/linha.
  return `${SOURCE_BASE}/${tile.z}/${tile.y}/${tile.x}.jpg`;
}

async function fetchTile(tile: Tile): Promise<"cached" | "downloaded"> {
  const target = targetPath(tile);
  if (await isUsable(target)) return "cached";
  if (VERIFY_ONLY) throw new Error(`tile ausente: ${path.relative(ROOT, target)}`);

  let lastFailure = "falha desconhecida";
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(sourceUrl(tile), {
        headers: { "User-Agent": "Theatrum-regional-satellite/0.1" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      const isJpeg = contentType.includes("image/jpeg");
      const isPng = contentType.includes("image/png");
      if (!isJpeg && !isPng) throw new Error(`tipo ${contentType || "ausente"}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const validJpeg =
        isJpeg &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[bytes.length - 2] === 0xff &&
        bytes[bytes.length - 1] === 0xd9;
      const validPng =
        isPng && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (bytes.byteLength < 100 || (!validJpeg && !validPng)) {
        throw new Error("imagem inválida");
      }

      await mkdir(path.dirname(target), { recursive: true });
      // A EOX devolve pequenos PNGs sólidos para áreas sem cena (principalmente
      // oceano), mesmo quando o endpoint termina em .jpg. Chromium identifica a
      // imagem pelo conteúdo; manter um padrão único permite uma pirâmide XYZ.
      const temporary = `${target}.download`;
      await writeFile(temporary, bytes);
      try {
        await rename(temporary, target);
      } catch (error: unknown) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      return "downloaded";
    } catch (error: unknown) {
      lastFailure = error instanceof Error ? error.message : String(error);
      if (attempt < 5) {
        const throttled = /HTTP (?:403|429)/.test(lastFailure);
        await new Promise((resolve) =>
          setTimeout(resolve, throttled ? attempt * 1_500 : attempt * 350),
        );
      }
    }
  }
  throw new Error(`${tile.z}/${tile.x}/${tile.y}: ${lastFailure}`);
}

async function writeManifest(): Promise<void> {
  const manifest = {
    version: 1,
    basemaps: [
      {
        id: "eox-s2cloudless-2016-hormuz",
        label: "Satélite · Estreito de Hormuz (Sentinel-2)",
        source: "eox-s2cloudless-2016-hormuz/{z}/{x}/{y}.jpg",
        tileSize: 256,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        bounds: BOUNDS,
        attribution:
          '<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016) · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
      },
    ],
  };
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const tiles = tilesInBounds();
  let next = 0;
  let cached = 0;
  let downloaded = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      const tile = tiles[index];
      if (tile === undefined) return;
      const result = await fetchTile(tile);
      if (result === "cached") cached++;
      else downloaded++;
      const done = cached + downloaded;
      if (done % 500 === 0 || done === tiles.length) {
        console.log(`${done}/${tiles.length} tiles · ${downloaded} baixados · ${cached} em cache`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await writeManifest();
  console.log(
    VERIFY_ONLY
      ? `\n${tiles.length} tiles íntegros; manifesto atualizado.`
      : `\n${downloaded} tiles baixados; ${cached} reaproveitados; manifesto atualizado.`,
  );
}

await main();
