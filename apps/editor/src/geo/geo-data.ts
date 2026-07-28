/**
 * Carga da malha geográfica compilada, no processo do renderer.
 *
 * Três decisões que valem explicar:
 *
 * 1. **Sob demanda, por camada.** As três camadas somam ~20 MB. Carregar tudo na
 *    abertura gastaria orçamento de abertura de projeto por dado que a cena
 *    talvez nem use — a maioria das cenas quer países, não os 4.589 estados do
 *    mundo. Cada camada entra na primeira vez que alguém pede.
 * 2. **Uma promessa por camada, compartilhada.** Dois nós pedindo a mesma camada
 *    no mesmo frame precisam de uma leitura, não duas. O cache guarda a promessa,
 *    não o resultado, então a segunda chamada espera a primeira em vez de abrir
 *    outra requisição.
 * 3. **Falha não derruba o frame.** Malha ausente ou corrompida vira diagnóstico
 *    e o nó desenha nada. O editor tem de continuar usável com o resto da cena.
 */

import {
  createGeoMesh,
  createRegionCatalog,
  type GeoMesh,
  type GeoMeshIndex,
  type RegionCatalog,
} from "@theatrum/gis";

const DATA_BASE = "theatrum-data://local/geo";

/** Camadas compiladas por `tools/build-geo.ts`. */
export const GEO_LAYERS = Object.freeze(["countries", "states", "rivers", "roads"] as const);

export type GeoLayer = (typeof GEO_LAYERS)[number];

/**
 * Prefixo de id por camada, como o compilador escreve: `c:UKR`, `s:BR-PR`,
 * `r:Nile`, `roads:UKR`.
 */
const LAYER_BY_PREFIX: Readonly<Record<string, GeoLayer>> = Object.freeze({
  c: "countries",
  s: "states",
  r: "rivers",
  roads: "roads",
});

/** Descobre a camada a partir do id, sem precisar carregar nada. */
export function layerOfGeoId(geoId: string): GeoLayer | undefined {
  const separator = geoId.indexOf(":");
  if (separator <= 0) return undefined;
  return LAYER_BY_PREFIX[geoId.slice(0, separator)];
}

export interface GeoLayerLoad {
  readonly layer: GeoLayer;
  readonly mesh: GeoMesh | undefined;
  readonly error: string | undefined;
  /** Milissegundos gastos na leitura e indexação. */
  readonly loadMs: number;
  readonly bytes: number;
}

const loads = new Map<GeoLayer, Promise<GeoLayerLoad>>();

async function fetchLayer(layer: GeoLayer): Promise<GeoLayerLoad> {
  const started = performance.now();
  try {
    // As duas requisições em paralelo: índice e geometria são arquivos separados
    // e nenhuma depende da outra.
    const [indexResponse, binaryResponse] = await Promise.all([
      fetch(`${DATA_BASE}/${layer}.json`),
      fetch(`${DATA_BASE}/${layer}.bin`),
    ]);
    if (!indexResponse.ok || !binaryResponse.ok) {
      throw new Error(
        `HTTP ${indexResponse.status}/${binaryResponse.status} — rode \`pnpm geo:build\``,
      );
    }
    const [index, bytes] = await Promise.all([
      indexResponse.json() as Promise<GeoMeshIndex>,
      binaryResponse.arrayBuffer(),
    ]);
    const mesh = createGeoMesh(index, bytes);
    return {
      layer,
      mesh,
      error: undefined,
      loadMs: performance.now() - started,
      bytes: bytes.byteLength,
    };
  } catch (error: unknown) {
    return {
      layer,
      mesh: undefined,
      error: error instanceof Error ? error.message : String(error),
      loadMs: performance.now() - started,
      bytes: 0,
    };
  }
}

/** Garante a camada carregada. Chamadas concorrentes compartilham a leitura. */
export function loadGeoLayer(layer: GeoLayer): Promise<GeoLayerLoad> {
  const existing = loads.get(layer);
  if (existing !== undefined) return existing;
  const promise = fetchLayer(layer);
  loads.set(layer, promise);
  return promise;
}

/** Malha já carregada, ou `undefined` se ainda não chegou. Não dispara carga. */
export function loadedGeoMesh(layer: GeoLayer): GeoMesh | undefined {
  return resolved.get(layer)?.mesh;
}

/** Espelho síncrono das cargas concluídas, para o caminho de render por frame. */
const resolved = new Map<GeoLayer, GeoLayerLoad>();

/**
 * Pede a camada de um id e devolve a malha se já estiver em memória.
 *
 * Síncrono de propósito: o passe de render não pode esperar. Na primeira chamada
 * dispara a carga e devolve `undefined`; o nó desenha nada nesse frame e aparece
 * no seguinte. É o mesmo comportamento de textura que ainda não decodificou.
 */
export function geoMeshFor(geoId: string): GeoMesh | undefined {
  const layer = layerOfGeoId(geoId);
  if (layer === undefined) return undefined;
  const already = resolved.get(layer);
  if (already !== undefined) return already.mesh;
  void loadGeoLayer(layer).then((load) => {
    resolved.set(layer, load);
    for (const listener of listeners) listener(load);
  });
  return undefined;
}

type LoadListener = (load: GeoLayerLoad) => void;
const listeners = new Set<LoadListener>();

/** Avisa quando uma camada termina de carregar, para redesenhar o frame. */
export function onGeoLayerLoaded(listener: LoadListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Estado das cargas, para o painel de depuração e o verificador. */
export function geoLoadStatus(): readonly GeoLayerLoad[] {
  return Object.freeze([...resolved.values()]);
}

let catalogCache: { readonly key: string; readonly catalog: RegionCatalog } | undefined;

/**
 * Catálogo de busca sobre as camadas já carregadas.
 *
 * Reindexar 6.000 feições a cada tecla digitada seria desperdício, então o
 * resultado é cacheado pela combinação de camadas presentes — que muda no máximo
 * três vezes por sessão.
 */
export function regionCatalog(): RegionCatalog {
  const meshes = GEO_LAYERS.map((layer) => resolved.get(layer)?.mesh).filter(
    (mesh): mesh is GeoMesh => mesh !== undefined,
  );
  const key = meshes.map((mesh) => mesh.layer).join(",");
  if (catalogCache?.key === key) return catalogCache.catalog;
  const catalog = createRegionCatalog(meshes);
  catalogCache = { key, catalog };
  return catalog;
}

/** Garante as camadas de busca carregadas. Chamado quando o painel abre. */
export async function ensureSearchableLayers(
  layers: readonly GeoLayer[] = GEO_LAYERS,
): Promise<readonly GeoLayerLoad[]> {
  const results = await Promise.all(layers.map((layer) => loadGeoLayer(layer)));
  for (const load of results) resolved.set(load.layer, load);
  catalogCache = undefined;
  return Object.freeze(results);
}
