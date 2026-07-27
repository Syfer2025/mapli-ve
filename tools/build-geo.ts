/**
 * Compila o GeoJSON do Natural Earth na malha binária que o runtime consome.
 *
 * Justificado em [ADR-010](../docs/adr/ADR-010-precompiled-geo-mesh.md): GeoJSON
 * é formato de troca, não de execução — 82 ms de `JSON.parse` e três vezes o
 * disco necessário, para entregar milhares de arrays pequenos no heap.
 *
 * A saída é um par por camada:
 *
 * - `<camada>.bin` — um único bloco com todos os anéis concatenados. Primeiro as
 *   coordenadas em **Int32 escalado por 1e7** (exato para esta fonte, ao contrário
 *   de Float32, que erra 85 cm), depois um byte de significância por vértice.
 * - `<camada>.json` — índice: uma entrada por feição, com deslocamento e
 *   comprimento de cada anel, caixa envolvente e só os campos que a ferramenta
 *   usa. O resto do Natural Earth é descartado.
 *
 * **Significância em vez de níveis duplicados.** Guardar seis simplificações da
 * mesma geometria triplicaria o arquivo. Em vez disso cada vértice carrega a
 * tolerância em que ele desaparece, quantizada num byte. Pedir o nível L é
 * percorrer os vértices cuja significância alcança L — e os níveis ficam
 * aninhados por construção, sem risco de um vértice sumir num nível e voltar no
 * seguinte.
 *
 * Uso:
 *   node tools/build-geo.ts
 *   node tools/build-geo.ts --verify
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = path.join(ROOT, "data", "natural-earth");
const OUTPUT_ROOT = path.join(ROOT, "data", "geo");
const VERIFY_ONLY = process.argv.includes("--verify");

/**
 * Versão do formato. O runtime recusa um par cujo índice não bata com o que ele
 * entende — binário velho ao lado de índice novo tem de falhar alto, não desenhar
 * geometria errada.
 */
const MESH_FORMAT_VERSION = 1;

/** Escala das coordenadas. 180 × 1e7 cabe no teto de Int32 com folga. */
const COORDINATE_SCALE = 1e7;

/**
 * Tolerâncias de simplificação em graus, da mais grosseira à mais fina, medidas
 * para cair perto de um pixel no nível de zoom correspondente. Um vértice com
 * significância abaixo da tolerância do nível não é desenhado nele.
 */
const LEVEL_TOLERANCES: readonly number[] = [0.2, 0.05, 0.012, 0.003, 0.0008];

/** Zoom a partir do qual cada nível passa a valer. Ver `levelForZoom` no runtime. */
const LEVEL_MIN_ZOOM: readonly number[] = [0, 5, 7, 9, 11];

interface LayerSource {
  readonly layer: string;
  readonly file: string;
  /** Como a feição é classificada no documento. */
  readonly kind: "country" | "state" | "river";
  /** Propriedades do Natural Earth que sobrevivem à compilação. */
  readonly keep: readonly string[];
  /** Identidade estável da feição, preferindo código sobre nome. */
  identify(props: Record<string, unknown>): { id: string; name: string } | null;
}

function text(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // O Natural Earth usa "-99" e "" como ausência.
  return trimmed === "" || trimmed === "-99" ? null : trimmed;
}

const LAYERS: readonly LayerSource[] = [
  {
    layer: "countries",
    file: "ne_10m_admin_0_countries.geojson",
    kind: "country",
    keep: ["NAME", "NAME_LONG", "ADM0_A3", "ISO_A2", "ISO_A3", "CONTINENT", "REGION_UN"],
    identify(props) {
      const name = text(props, "NAME") ?? text(props, "NAME_LONG");
      const code = text(props, "ADM0_A3") ?? text(props, "ISO_A3");
      if (name === null || code === null) return null;
      return { id: `c:${code}`, name };
    },
  },
  {
    layer: "states",
    file: "ne_10m_admin_1_states_provinces.geojson",
    kind: "state",
    keep: ["name", "name_en", "adm0_a3", "admin", "iso_3166_2", "type_en"],
    identify(props) {
      const name = text(props, "name_en") ?? text(props, "name");
      // `iso_3166_2` é único quando existe; sem ele, país + nome resolve.
      const code = text(props, "iso_3166_2");
      const country = text(props, "adm0_a3");
      if (name === null) return null;
      const id = code !== null ? `s:${code}` : `s:${country ?? "XX"}:${name}`;
      return { id, name };
    },
  },
  {
    layer: "rivers",
    file: "ne_10m_rivers_lake_centerlines.geojson",
    kind: "river",
    keep: ["name", "name_en", "featurecla"],
    identify(props) {
      const name = text(props, "name_en") ?? text(props, "name");
      if (name === null) return null;
      return { id: `r:${name}`, name };
    },
  },
];

interface GeoJsonFeature {
  readonly properties: Record<string, unknown>;
  readonly geometry: { readonly type: string; readonly coordinates: unknown } | null;
}

type Ring = readonly (readonly number[])[];

/** Achata qualquer geometria em anéis de pontos, ignorando a hierarquia. */
function ringsOf(coordinates: unknown): Ring[] {
  const rings: Ring[] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node) || node.length === 0) return;
    const first: unknown = node[0];
    if (typeof first === "number") return;
    if (Array.isArray(first) && typeof first[0] === "number") {
      rings.push(node as Ring);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(coordinates);
  return rings;
}

/**
 * Significância de cada vértice: a distância perpendicular em que ele deixa de
 * ser dispensável.
 *
 * É Douglas–Peucker invertido — em vez de devolver quem fica para uma tolerância,
 * registra para cada vértice a tolerância máxima que ainda o preserva. Extremos
 * de anel têm significância infinita: sem eles a linha deixa de fechar.
 */
function vertexSignificance(ring: Ring): Float64Array {
  const count = ring.length;
  const significance = new Float64Array(count);
  if (count === 0) return significance;
  significance[0] = Infinity;
  significance[count - 1] = Infinity;
  if (count < 3) return significance;

  const stack: [number, number][] = [[0, count - 1]];
  while (stack.length > 0) {
    const segment = stack.pop();
    if (segment === undefined) continue;
    const [first, last] = segment;
    if (last - first < 2) continue;

    const a = ring[first];
    const b = ring[last];
    const ax = a?.[0] ?? 0;
    const ay = a?.[1] ?? 0;
    const dx = (b?.[0] ?? 0) - ax;
    const dy = (b?.[1] ?? 0) - ay;
    const length2 = dx * dx + dy * dy;

    let farthest = -1;
    let maxDistance2 = -1;
    for (let index = first + 1; index < last; index += 1) {
      const point = ring[index];
      const px = point?.[0] ?? 0;
      const py = point?.[1] ?? 0;
      let t = length2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / length2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ox = ax + t * dx - px;
      const oy = ay + t * dy - py;
      const distance2 = ox * ox + oy * oy;
      if (distance2 > maxDistance2) {
        maxDistance2 = distance2;
        farthest = index;
      }
    }
    if (farthest < 0) continue;
    significance[farthest] = Math.sqrt(maxDistance2);
    stack.push([first, farthest], [farthest, last]);
  }
  return significance;
}

/**
 * Quantiza a significância no índice do nível mais grosseiro que ainda desenha o
 * vértice. 0 aparece em todos os níveis; `LEVEL_TOLERANCES.length` só na malha
 * cheia.
 */
function quantizeLevel(significance: number): number {
  for (let level = 0; level < LEVEL_TOLERANCES.length; level += 1) {
    if (significance >= (LEVEL_TOLERANCES[level] ?? 0)) return level;
  }
  return LEVEL_TOLERANCES.length;
}

interface RingEntry {
  readonly offset: number;
  readonly count: number;
  /**
   * Caixa do anel, `[oeste, sul, leste, norte]`.
   *
   * Existe porque a caixa da **feição** é inútil para descarte quando ela cruza o
   * antimeridiano: a da Rússia vai de −180 a 180, então ela nunca seria
   * descartada e um zoom sobre Kiev projetaria trinta e cinco mil vértices
   * siberianos fora da tela. Por anel, a Chukotka sai sem levar o continente.
   */
  readonly bbox: readonly number[];
}

interface FeatureEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly props: Record<string, string>;
  readonly bbox: readonly number[];
  /**
   * Ponto representativo em graus — a âncora do nó que usa a feição.
   *
   * **Não é o centro da caixa envolvente.** A Rússia tem caixa de −180 a 180
   * porque a Chukotka cruza o antimeridiano, e o centro dessa caixa cai na
   * longitude 0, no Atlântico. Estados Unidos e Fiji têm o mesmo problema. Aqui é
   * a média dos vértices do **maior anel**, que cai na massa continental — o que
   * mantém as coordenadas locais pequenas e a âncora perto do que se vê.
   */
  readonly center: readonly number[];
  readonly rings: readonly RingEntry[];
  /** Vértices que sobrevivem em cada nível, do mais grosseiro ao mais fino. */
  readonly levelCounts: readonly number[];
}

interface CompiledLayer {
  readonly index: {
    readonly version: number;
    readonly layer: string;
    readonly kind: string;
    readonly coordinateScale: number;
    readonly levelTolerances: readonly number[];
    readonly levelMinZoom: readonly number[];
    readonly vertexCount: number;
    readonly features: readonly FeatureEntry[];
  };
  readonly binary: Buffer;
}

async function compileLayer(source: LayerSource): Promise<CompiledLayer> {
  const raw = await readFile(path.join(SOURCE_ROOT, source.file), "utf8");
  const parsed = JSON.parse(raw) as { readonly features: readonly GeoJsonFeature[] };

  const coordinates: number[] = [];
  const levels: number[] = [];
  const features: FeatureEntry[] = [];
  let offset = 0;

  for (const feature of parsed.features) {
    if (feature.geometry === null) continue;
    const identity = source.identify(feature.properties);
    if (identity === null) continue;
    const rings = ringsOf(feature.geometry.coordinates);
    if (rings.length === 0) continue;

    const props: Record<string, string> = {};
    for (const key of source.keep) {
      const value = text(feature.properties, key);
      if (value !== null) props[key] = value;
    }

    const entries: RingEntry[] = [];
    const levelCounts = new Array<number>(LEVEL_TOLERANCES.length + 1).fill(0);
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    // Maior anel = massa continental. É dele que sai o ponto representativo.
    let largestRingSize = 0;
    let centerLng = 0;
    let centerLat = 0;

    for (const ring of rings) {
      const significance = vertexSignificance(ring);
      let ringW = Infinity;
      let ringS = Infinity;
      let ringE = -Infinity;
      let ringN = -Infinity;
      for (const point of ring) {
        const lng = point[0] ?? 0;
        const lat = point[1] ?? 0;
        if (lng < ringW) ringW = lng;
        if (lat < ringS) ringS = lat;
        if (lng > ringE) ringE = lng;
        if (lat > ringN) ringN = lat;
      }
      entries.push({
        offset,
        count: ring.length,
        bbox: [ringW, ringS, ringE, ringN].map((value) => Math.round(value * 1e5) / 1e5),
      });
      if (ring.length > largestRingSize) {
        largestRingSize = ring.length;
        let sumLng = 0;
        let sumLat = 0;
        for (const point of ring) {
          sumLng += point[0] ?? 0;
          sumLat += point[1] ?? 0;
        }
        centerLng = sumLng / ring.length;
        centerLat = sumLat / ring.length;
      }
      for (let index = 0; index < ring.length; index += 1) {
        const point = ring[index];
        const lng = point?.[0] ?? 0;
        const lat = point?.[1] ?? 0;
        coordinates.push(Math.round(lng * COORDINATE_SCALE), Math.round(lat * COORDINATE_SCALE));
        const level = quantizeLevel(significance[index] ?? 0);
        levels.push(level);
        for (let l = level; l < levelCounts.length; l += 1) {
          levelCounts[l] = (levelCounts[l] ?? 0) + 1;
        }
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
      offset += ring.length;
    }

    features.push({
      id: identity.id,
      name: identity.name,
      kind: source.kind,
      props,
      bbox: [minLng, minLat, maxLng, maxLat].map((value) => Math.round(value * 1e6) / 1e6),
      center: [centerLng, centerLat].map((value) => Math.round(value * 1e6) / 1e6),
      rings: entries,
      levelCounts,
    });
  }

  const vertexCount = coordinates.length / 2;
  const binary = Buffer.alloc(vertexCount * 8 + vertexCount);
  for (let index = 0; index < coordinates.length; index += 1) {
    binary.writeInt32LE(coordinates[index] ?? 0, index * 4);
  }
  for (let index = 0; index < vertexCount; index += 1) {
    binary.writeUInt8(levels[index] ?? 0, vertexCount * 8 + index);
  }

  return {
    binary,
    index: {
      version: MESH_FORMAT_VERSION,
      layer: source.layer,
      kind: source.kind,
      coordinateScale: COORDINATE_SCALE,
      levelTolerances: LEVEL_TOLERANCES,
      levelMinZoom: LEVEL_MIN_ZOOM,
      vertexCount,
      features,
    },
  };
}

async function writeAtomic(target: string, bytes: Buffer | string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } catch (error: unknown) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function formatBytes(value: number): string {
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  let totalOut = 0;
  for (const source of LAYERS) {
    const started = process.hrtime.bigint();
    const compiled = await compileLayer(source);
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    const binaryPath = path.join(OUTPUT_ROOT, `${source.layer}.bin`);
    const indexPath = path.join(OUTPUT_ROOT, `${source.layer}.json`);
    const indexText = JSON.stringify(compiled.index);

    if (VERIFY_ONLY) {
      const [binaryOnDisk, indexOnDisk] = await Promise.all([
        readFile(binaryPath).catch(() => null),
        readFile(indexPath, "utf8").catch(() => null),
      ]);
      const same =
        binaryOnDisk !== null && indexOnDisk === indexText && binaryOnDisk.equals(compiled.binary);
      if (!same) {
        throw new Error(
          `data/geo/${source.layer} está ausente ou desatualizado. Rode \`pnpm geo:build\`.`,
        );
      }
      console.log(`✓ data/geo/${source.layer} · ${compiled.index.features.length} feições`);
      continue;
    }

    await writeAtomic(binaryPath, compiled.binary);
    await writeAtomic(indexPath, indexText);
    totalOut += compiled.binary.byteLength + Buffer.byteLength(indexText);
    const counts = compiled.index.features.reduce<number[]>((acc, feature) => {
      feature.levelCounts.forEach((value, level) => {
        acc[level] = (acc[level] ?? 0) + value;
      });
      return acc;
    }, []);
    console.log(
      `↓ data/geo/${source.layer} · ${compiled.index.features.length} feições · ` +
        `${compiled.index.vertexCount.toLocaleString("pt-BR")} vértices · ` +
        `${formatBytes(compiled.binary.byteLength)} + ${formatBytes(Buffer.byteLength(indexText))} índice · ` +
        `${elapsed.toFixed(0)} ms`,
    );
    console.log(
      `  vértices por nível: ${counts.map((value, level) => `z${LEVEL_MIN_ZOOM[level] ?? "+"}=${value.toLocaleString("pt-BR")}`).join(" · ")}`,
    );
  }

  if (!VERIFY_ONLY) console.log(`\nTotal compilado: ${formatBytes(totalOut)}`);
}

await main();
