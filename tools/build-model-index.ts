/**
 * Indexa a biblioteca 3D local do usuário.
 *
 * `data/models/` é uma **junção** para uma pasta fora do repositório, não uma
 * cópia: os modelos somam gigabytes e o projeto vive dentro de uma pasta
 * sincronizada, então copiar duplicaria o tráfego de nuvem sem ganho nenhum. A
 * junção é criada uma vez, à mão:
 *
 *   mklink /J "data\models" "C:\caminho\para\seus\modelos"
 *
 * Este script varre o que estiver lá e escreve `data/models-index.json`, que o
 * painel Biblioteca lê para listar sem tocar em um byte de geometria. Nada aqui
 * entra no controle de versão — índice e junção são locais da máquina.
 *
 * O nome de arquivo é a única fonte de metadados que existe, então a
 * categorização é heurística e **declaradamente falível**: ela ordena a lista, não
 * decide nada. Um modelo mal classificado ainda importa e funciona.
 *
 * Uso:
 *   node tools/build-model-index.ts
 *   node tools/build-model-index.ts --verify
 */

import { readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS_ROOT = path.join(ROOT, "data", "models");
const INDEX_PATH = path.join(ROOT, "data", "models-index.json");
const VERIFY_ONLY = process.argv.includes("--verify");

const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);

/**
 * Categorias reconhecidas por palavra no nome do arquivo, da mais específica para
 * a mais genérica — a primeira que casar ganha.
 */
const CATEGORIES: readonly (readonly [string, readonly string[]])[] = [
  [
    "helicoptero",
    ["ah-1", "ah-64", "apache", "cobra", "ka-52", "mi-8", "mi-28", "z-10", "alligator"],
  ],
  ["drone", ["uav", "drone", "predator", "orion", "fpv"]],
  ["missil", ["missile", "tochka", "9m79"]],
  ["antiaereo", ["sam_", "s-125", "pvo", "low_blow", "derivation"]],
  ["artilharia", ["sph", "shp", "msta", "akatsia", "paladin", "plz", "sholef", "m109"]],
  [
    "blindado",
    [
      "abrams",
      "m1a2",
      "leopard",
      "challenger",
      "merkava",
      "t-90",
      "ariete",
      "m60",
      "bmpt",
      "typhoon",
      "armored",
    ],
  ],
  ["navio", ["ssbn", "washington", "frigate", "destroyer"]],
  ["transporte", ["truck", "c-4310"]],
  [
    "aviao",
    [
      "f-1",
      "f-2",
      "f-4",
      "f-5",
      "f-8",
      "fa-18",
      "a-10",
      "a-4",
      "a-7",
      "mig",
      "su-",
      "mirage",
      "tornado",
      "harrier",
      "viggen",
      "jaguar",
      "hawk",
      "kfir",
      "yak",
      "j-8",
      "jh-7",
      "l-39",
      "e-2",
      "tupolev",
      "tu-22",
      "nighthawk",
      "aardvark",
      "phantom",
      "tomcat",
      "skyhawk",
      "corsair",
    ],
  ],
];

function categoryOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const [category, needles] of CATEGORIES) {
    if (needles.some((needle) => lower.includes(needle))) return category;
  }
  return "outro";
}

/**
 * Nome legível a partir do arquivo.
 *
 * `f-14b_tomcat_with_aim-54_phoenix (2).glb` vira
 * `F-14B Tomcat With Aim-54 Phoenix · variação 2`. O sufixo entre parênteses é
 * preservado como variação em vez de descartado: o dono do projeto avisou que as
 * duplicatas são versões diferentes do mesmo equipamento, não repetição.
 */
function labelOf(fileName: string): { label: string; variant: number | null } {
  const base = fileName.replace(/\.(glb|gltf)$/i, "");
  const match = /^(.*?)\s*\((\d+)\)$/.exec(base);
  const stem = match?.[1] ?? base;
  const variant = match?.[2] === undefined ? null : Number.parseInt(match[2], 10);
  const words = stem
    .replace(/[_]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) =>
      word.length <= 3 ? word.toUpperCase() : word[0]?.toUpperCase() + word.slice(1),
    );
  return { label: words.join(" "), variant };
}

interface ModelEntry {
  readonly file: string;
  readonly label: string;
  readonly category: string;
  readonly bytes: number;
  /** Número da variação quando o nome traz `(n)`; `null` quando é o principal. */
  readonly variant: number | null;
}

async function collect(): Promise<readonly ModelEntry[]> {
  let names: string[];
  try {
    names = await readdir(MODELS_ROOT);
  } catch {
    return [];
  }

  const entries: ModelEntry[] = [];
  for (const name of names) {
    if (!MODEL_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
    const info = await stat(path.join(MODELS_ROOT, name));
    if (!info.isFile()) continue;
    const { label, variant } = labelOf(name);
    entries.push({ file: name, label, category: categoryOf(name), bytes: info.size, variant });
  }
  // Ordem estável: categoria, nome, variação. Lista que dança entre execuções é
  // ruído para quem procura um modelo.
  entries.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label) ||
      (a.variant ?? 0) - (b.variant ?? 0),
  );
  return entries;
}

async function main(): Promise<void> {
  const models = await collect();
  const payload = `${JSON.stringify({ version: 1, root: "models", models }, null, 1)}\n`;

  if (models.length === 0) {
    const message =
      `Nenhum modelo em data/models. Crie a junção para a sua pasta de modelos:\n` +
      `  mklink /J "data\\models" "C:\\caminho\\para\\seus\\modelos"`;
    if (VERIFY_ONLY) {
      console.log(`— ${message}`);
      return;
    }
    throw new Error(message);
  }

  if (VERIFY_ONLY) {
    console.log(`✓ data/models-index.json · ${models.length} modelos`);
    return;
  }

  const temporary = `${INDEX_PATH}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, payload);
    await rename(temporary, INDEX_PATH);
  } catch (error: unknown) {
    await unlink(temporary).catch(() => {});
    throw error;
  }

  const byCategory = new Map<string, number>();
  let bytes = 0;
  for (const model of models) {
    byCategory.set(model.category, (byCategory.get(model.category) ?? 0) + 1);
    bytes += model.bytes;
  }
  console.log(
    `↓ data/models-index.json · ${models.length} modelos · ` +
      `${(bytes / 1_073_741_824).toFixed(1)} GB no disco`,
  );
  console.log(
    `  ${[...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => `${category}=${count}`)
      .join(" · ")}`,
  );
  const variantes = models.filter((model) => model.variant !== null).length;
  if (variantes > 0) {
    console.log(`  ${variantes} variações reconhecidas por sufixo "(n)" no nome`);
  }
}

await main();
