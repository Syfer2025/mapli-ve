/**
 * Baixa e verifica os dados cartográficos pequenos usados pelo viewport.
 *
 * O app nunca chama este script em runtime. Depois do bootstrap, todos os
 * arquivos são locais e o editor funciona sem rede. Cada origem é fixada por
 * URL, tamanho e SHA-256 para que uma atualização upstream nunca altere um
 * frame silenciosamente.
 *
 * Uso:
 *   node tools/fetch-data.ts
 *   node tools/fetch-data.ts --verify
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface RemoteAsset {
  readonly relativePath: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = path.join(ROOT, "data");
const VERIFY_ONLY = process.argv.includes("--verify");

const NATURAL_EARTH_COUNTRIES_COMMIT = "9380cca83db5f9aef52d5e762765100745f84b27";
const NATURAL_EARTH_PHYSICAL_COMMIT = "b70b7b8766c3c83d5f5145cb6f1c93921d383d3f";
const NATURAL_EARTH_PLACES_COMMIT = "f1890d9f152c896d250a77557a5751a93d494776";
const DEMOTILES_DATA_COMMIT = "ef4389e954d46e97cd9d3b0130881d9fb789ae2e";
const DEMOTILES_LICENSE_COMMIT = "0343c3fd0b6b82c53ec876b90679242d937e075d";
const NATURAL_EARTH_RAW = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector";
const DEMOTILES_RAW = "https://raw.githubusercontent.com/maplibre/demotiles";
const PROTOMAPS_ASSETS_BASE = "https://protomaps.github.io/basemaps-assets";

function protomapsAsset(
  relativePath: string,
  upstreamPath: string,
  bytes: number,
  sha256: string,
): RemoteAsset {
  const encodedPath = upstreamPath.split("/").map(encodeURIComponent).join("/");
  return {
    relativePath,
    url: `${PROTOMAPS_ASSETS_BASE}/${encodedPath}`,
    bytes,
    sha256,
  };
}

const PROTOMAPS_REMOTE_ASSETS: readonly RemoteAsset[] = [
  protomapsAsset(
    "glyphs/Noto Sans Regular/0-255.pbf",
    "fonts/Noto Sans Regular/0-255.pbf",
    76_044,
    "62c6d49b15fa836eb6aa45e259c7ca6762f44b011b09e47776efbe4a6db1b397",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Regular/256-511.pbf",
    "fonts/Noto Sans Regular/256-511.pbf",
    127_726,
    "2eca7561f9f566bcacfda5dd04fb5880baec1328ec0f5484678289a13994de8a",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Regular/1024-1279.pbf",
    "fonts/Noto Sans Regular/1024-1279.pbf",
    125_320,
    "302231023f7048d9694a7b3f3b737c8bc378f5af0175aed5bb4f2f3b6188919a",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Regular/1536-1791.pbf",
    "fonts/Noto Sans Regular/1536-1791.pbf",
    110_716,
    "f46850e6574d817d58d96b91196739c77c1b570a7b4f992ff1380d2b4d5d631f",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Regular/1792-2047.pbf",
    "fonts/Noto Sans Regular/1792-2047.pbf",
    93_383,
    "43ed9f47288d5b73aef7a2bba7599c1ce0bb3de66a2038cb91506eb7af206faf",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Medium/0-255.pbf",
    "fonts/Noto Sans Medium/0-255.pbf",
    77_628,
    "ba2f0118dd024e3041b158e5f9eb49bc0a658019f53f458e9f5c0b8efcd79b91",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Medium/256-511.pbf",
    "fonts/Noto Sans Medium/256-511.pbf",
    129_635,
    "d5e801a1a5b1d409d3298c3a1e1ca76328e2314a751078833a618620e8e66e4d",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Medium/1024-1279.pbf",
    "fonts/Noto Sans Medium/1024-1279.pbf",
    128_608,
    "1fd3385560bae824ee48de8c920412ca3a75cabe5ada5ea67d8d188787018319",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Medium/1536-1791.pbf",
    "fonts/Noto Sans Medium/1536-1791.pbf",
    115_002,
    "e998806d6e6b4c03950564e64be0d91c0cfc576c886d698953a42d33f2ccc099",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Medium/1792-2047.pbf",
    "fonts/Noto Sans Medium/1792-2047.pbf",
    49_721,
    "220dc297746615eb947c2f3db297fa7b6c5a321f0a0b7fa2a72b177965b63d13",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Italic/0-255.pbf",
    "fonts/Noto Sans Italic/0-255.pbf",
    79_344,
    "43edfca91c285ba1226f09d5e74d68e1473a088c517f02a5212ff6ccb10037dc",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Italic/256-511.pbf",
    "fonts/Noto Sans Italic/256-511.pbf",
    132_976,
    "a6f9f6574c86a4a28aba630ca1017857ceadd2370ed32a1293c35f819ab9bd60",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Italic/1024-1279.pbf",
    "fonts/Noto Sans Italic/1024-1279.pbf",
    128_015,
    "9c3f67dce1f538ee635405a5562c364c95ba4db06a6b312a45c84ad6edf4c28a",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Italic/1536-1791.pbf",
    "fonts/Noto Sans Italic/1536-1791.pbf",
    26,
    "130f950ea1de60403501b681f786514f3a57a06b2304dd77400634a8ddfd8a83",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Italic/1792-2047.pbf",
    "fonts/Noto Sans Italic/1792-2047.pbf",
    26,
    "64efeb5aafbe4c9bf7480434622e094df7be95c37f8f09137cb6b37bb70075c3",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Devanagari Regular v1/0-255.pbf",
    "fonts/Noto Sans Devanagari Regular v1/0-255.pbf",
    76_044,
    "62c6d49b15fa836eb6aa45e259c7ca6762f44b011b09e47776efbe4a6db1b397",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Devanagari Regular v1/256-511.pbf",
    "fonts/Noto Sans Devanagari Regular v1/256-511.pbf",
    127_726,
    "2eca7561f9f566bcacfda5dd04fb5880baec1328ec0f5484678289a13994de8a",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Devanagari Regular v1/1024-1279.pbf",
    "fonts/Noto Sans Devanagari Regular v1/1024-1279.pbf",
    125_320,
    "302231023f7048d9694a7b3f3b737c8bc378f5af0175aed5bb4f2f3b6188919a",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Devanagari Regular v1/1536-1791.pbf",
    "fonts/Noto Sans Devanagari Regular v1/1536-1791.pbf",
    110_716,
    "f46850e6574d817d58d96b91196739c77c1b570a7b4f992ff1380d2b4d5d631f",
  ),
  protomapsAsset(
    "glyphs/Noto Sans Devanagari Regular v1/1792-2047.pbf",
    "fonts/Noto Sans Devanagari Regular v1/1792-2047.pbf",
    93_383,
    "43ed9f47288d5b73aef7a2bba7599c1ce0bb3de66a2038cb91506eb7af206faf",
  ),
  protomapsAsset(
    "sprites/protomaps-light.json",
    "sprites/v4/light.json",
    3_549,
    "bfac76cf7ed5c2aa2992695904056a1c6b07785b7fd20e6c640cb44fd6244a2e",
  ),
  protomapsAsset(
    "sprites/protomaps-light.png",
    "sprites/v4/light.png",
    16_174,
    "b6a34640917bdc57d0bd080836db33376371a3312ebe7b849045268015de3481",
  ),
  protomapsAsset(
    "sprites/protomaps-light@2x.json",
    "sprites/v4/light@2x.json",
    3_579,
    "1fb5b123fbe35d2e1f6ac171513ce01df89e671273a417ee89c44886a4c132f0",
  ),
  protomapsAsset(
    "sprites/protomaps-light@2x.png",
    "sprites/v4/light@2x.png",
    28_852,
    "23f6e9df27c2e9a14385763980a24e3608966bfc8192a106058bc2ca959ab563",
  ),
];

const REMOTE_ASSETS: readonly RemoteAsset[] = [
  {
    relativePath: "natural-earth/ne_110m_admin_0_countries.geojson",
    url:
      `${NATURAL_EARTH_RAW}/${NATURAL_EARTH_COUNTRIES_COMMIT}/geojson/` +
      "ne_110m_admin_0_countries.geojson",
    bytes: 838_726,
    sha256: "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
  },
  /**
   * Malhas finas do bloco 7B. A 110m acima continua servindo o basemap e as
   * provas antigas; estas três alimentam os nós `geo.*`, que precisam de contorno
   * correto em zoom de cidade — 93 pontos para a Ucrânia inteira, que é o que a
   * 110m dá, sai visivelmente poligonal. Ver ADR-009.
   */
  {
    relativePath: "natural-earth/ne_10m_admin_0_countries.geojson",
    url:
      `${NATURAL_EARTH_RAW}/${NATURAL_EARTH_COUNTRIES_COMMIT}/geojson/` +
      "ne_10m_admin_0_countries.geojson",
    bytes: 13_287_234,
    sha256: "239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255",
  },
  {
    relativePath: "natural-earth/ne_10m_admin_1_states_provinces.geojson",
    url:
      `${NATURAL_EARTH_RAW}/${NATURAL_EARTH_COUNTRIES_COMMIT}/geojson/` +
      "ne_10m_admin_1_states_provinces.geojson",
    bytes: 40_726_851,
    sha256: "22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5",
  },
  {
    relativePath: "natural-earth/ne_10m_rivers_lake_centerlines.geojson",
    url:
      `${NATURAL_EARTH_RAW}/${NATURAL_EARTH_PHYSICAL_COMMIT}/geojson/` +
      "ne_10m_rivers_lake_centerlines.geojson",
    bytes: 7_307_743,
    sha256: "bb854a900ecbd3b408df46d5e16e3e0f974ba55993f9d8b5c26e855273c0905a",
  },
  {
    /**
     * Estradas do bloco 7B. Quatro vezes o arquivo de países — a decisão de
     * agrupar por país via junção espacial, e a medição que a sustenta, estão
     * no ADR-011.
     */
    relativePath: "natural-earth/ne_10m_roads.geojson",
    url: `${NATURAL_EARTH_RAW}/${NATURAL_EARTH_PHYSICAL_COMMIT}/geojson/` + "ne_10m_roads.geojson",
    bytes: 50_474_096,
    sha256: "66a0c7b438e92fd124822cc5921cfa11042f48c294ade5e0f03f2c6640fd0248",
  },
  {
    relativePath: "natural-earth/ne_10m_populated_places_simple.geojson",
    url:
      `${NATURAL_EARTH_RAW}/${NATURAL_EARTH_PLACES_COMMIT}/geojson/` +
      "ne_10m_populated_places_simple.geojson",
    bytes: 4_932_147,
    sha256: "fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f",
  },
  {
    relativePath: "natural-earth/ne_110m_lakes.geojson",
    url: `${NATURAL_EARTH_RAW}/${NATURAL_EARTH_PHYSICAL_COMMIT}/geojson/` + "ne_110m_lakes.geojson",
    bytes: 36_648,
    sha256: "eb02ecc86c82004fccbf979058bfabbbd6c2d07968c7844d38eb1c9152d2ffc9",
  },
  {
    relativePath: "natural-earth/ne_110m_rivers_lake_centerlines.geojson",
    url:
      `${NATURAL_EARTH_RAW}/${NATURAL_EARTH_PHYSICAL_COMMIT}/geojson/` +
      "ne_110m_rivers_lake_centerlines.geojson",
    bytes: 38_087,
    sha256: "55aa4497405afc07cdc931b7fbe062c4d6693ba2a550c0d24899953f5d507c8d",
  },
  {
    relativePath: "basemap/natural-earth-world.pmtiles",
    url: `${DEMOTILES_RAW}/${DEMOTILES_DATA_COMMIT}/pmtiles/vector/world.pmtiles`,
    bytes: 3_829_650,
    sha256: "9a4f4369aa49590f890b49b4885017d3623c29399c16654c2bd27238d964ae6d",
  },
  {
    relativePath: "glyphs/Open Sans Semibold/0-255.pbf",
    url: `${DEMOTILES_RAW}/${DEMOTILES_DATA_COMMIT}/font/` + "Open%20Sans%20Semibold/0-255.pbf",
    bytes: 77_571,
    sha256: "64da7011e07531351a249a3d26aad76e2f22e4e321e50833f742697b453e8365",
  },
  {
    relativePath: "glyphs/Open Sans Semibold/256-511.pbf",
    url: `${DEMOTILES_RAW}/${DEMOTILES_DATA_COMMIT}/font/` + "Open%20Sans%20Semibold/256-511.pbf",
    bytes: 68_869,
    sha256: "78298bbd8198c117ccdffe66bf9bbf646fdc1210b7e1bf222f5a9b29b366d7a5",
  },
  {
    relativePath: "glyphs/Open Sans Semibold/1024-1279.pbf",
    url: `${DEMOTILES_RAW}/${DEMOTILES_DATA_COMMIT}/font/` + "Open%20Sans%20Semibold/1024-1279.pbf",
    bytes: 128_493,
    sha256: "0354f1c092e3604b09177de773f84caa1ca6d4f17a8099e4787fcba8e7282907",
  },
  ...PROTOMAPS_REMOTE_ASSETS,
  {
    relativePath: "licenses/maplibre-demotiles-LICENSE.txt",
    url: `${DEMOTILES_RAW}/${DEMOTILES_LICENSE_COMMIT}/LICENSE`,
    bytes: 1_516,
    sha256: "5dd1cfc5b6f7bef1363ba3f79d7c11c04b12ea1782d8b8d0f3c4366b60640eb2",
  },
];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readAndVerify(
  absolutePath: string,
  expectedBytes: number,
  expectedHash: string,
): Promise<boolean> {
  try {
    const bytes = await readFile(absolutePath);
    return bytes.byteLength === expectedBytes && sha256(bytes) === expectedHash;
  } catch {
    return false;
  }
}

async function ensureRemote(asset: RemoteAsset): Promise<"cached" | "downloaded"> {
  const target = path.join(DATA_ROOT, asset.relativePath);
  if (await readAndVerify(target, asset.bytes, asset.sha256)) return "cached";

  if (VERIFY_ONLY) {
    throw new Error(`ausente ou inválido: data/${asset.relativePath}`);
  }

  // Se já existe mas não confere, não sobrescrevemos: isso pode ser uma edição
  // local valiosa ou corrupção a investigar. Remova o arquivo conscientemente.
  try {
    await readFile(target);
    throw new Error(
      `checksum divergente: data/${asset.relativePath}. Remova o arquivo para baixar novamente.`,
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("checksum divergente:")) throw error;
  }

  const response = await fetch(asset.url, {
    headers: { "User-Agent": "Theatrum-data-fetch/0.1" },
  });
  if (!response.ok) throw new Error(`${asset.url} respondeu HTTP ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualHash = sha256(bytes);
  if (bytes.byteLength !== asset.bytes || actualHash !== asset.sha256) {
    throw new Error(
      `integridade falhou em ${asset.relativePath}: ` + `${bytes.byteLength} bytes / ${actualHash}`,
    );
  }

  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.download`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } catch (error: unknown) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return "downloaded";
}

async function main(): Promise<void> {
  let downloaded = 0;
  for (const asset of REMOTE_ASSETS) {
    const result = await ensureRemote(asset);
    if (result === "downloaded") downloaded++;
    console.log(`${result === "cached" ? "✓" : "↓"} data/${asset.relativePath}`);
  }

  console.log(
    VERIFY_ONLY
      ? `\n${REMOTE_ASSETS.length} assets íntegros.`
      : `\n${downloaded} baixados; ${REMOTE_ASSETS.length} verificados.`,
  );
}

await main();
