/**
 * Descoberta de imagens de satélite locais.
 *
 * **Por que não vem embutido.** O projeto é offline e fixa cada origem por hash
 * ([ADR-006](../../../../../docs/adr/ADR-006-maplibre.md)). Imagem de satélite de
 * resolução útil não é redistribuível — a do Natural Earth é domínio público mas
 * para em ~500 m/pixel, e qualquer coisa melhor tem licença que proíbe embutir.
 * Ignorar isso e chamar um servidor de tiles em runtime quebraria as duas coisas
 * que sustentam o projeto: funcionar sem rede e exportar de forma determinística.
 *
 * Então a imagem é **do usuário**, declarada como raiz nomeada em
 * `data/library-roots.json` — o mesmo mecanismo da biblioteca 3D:
 *
 *     { "raster": "C:/caminho/para/tiles" }
 *
 * A pasta pode conter um `.pmtiles` raster (preferido: um arquivo, HTTP Range) ou
 * uma pirâmide `{z}/{x}/{y}.png` já extraída. O manifesto opcional
 * `basemap.json` na raiz nomeia e configura cada fonte; sem ele, o módulo
 * descobre pelo que existe.
 *
 * Nada disso é obrigatório: máquina sem imagem simplesmente não mostra os estilos
 * de satélite, exatamente como a biblioteca 3D some quando não há modelos.
 */

const MANIFEST_URL = "theatrum-data://local/raster/basemap.json";
const RASTER_BASE = "theatrum-data://local/raster";

export interface RasterBasemap {
  /** Identidade estável, usada no id do estilo de mapa. */
  readonly id: string;
  readonly label: string;
  /** Arquivo `.pmtiles` na raiz, ou padrão `{z}/{x}/{y}.ext` de pirâmide. */
  readonly source: string;
  readonly tileSize: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly attribution: string;
}

interface RasterManifest {
  readonly version: number;
  readonly basemaps: readonly Partial<RasterBasemap>[];
}

/** Preenche o que o manifesto omitiu com padrões de pirâmide comum. */
function normalize(entry: Partial<RasterBasemap>, index: number): RasterBasemap | null {
  const source = entry.source;
  if (typeof source !== "string" || source.length === 0) return null;
  const id = entry.id ?? `raster-${index}`;
  return Object.freeze({
    id,
    label: entry.label ?? "Satélite",
    source,
    tileSize: typeof entry.tileSize === "number" ? entry.tileSize : 256,
    minZoom: typeof entry.minZoom === "number" ? entry.minZoom : 0,
    maxZoom: typeof entry.maxZoom === "number" ? entry.maxZoom : 14,
    attribution: entry.attribution ?? "Imagem local do usuário",
  });
}

/**
 * URL que o MapLibre consome.
 *
 * `.pmtiles` vira `url` com o protocolo registrado; pirâmide vira `tiles`. A
 * distinção existe porque são campos diferentes na especificação de estilo, e
 * confundi-los produz um mapa cinza sem erro no console.
 */
export function rasterSourceUrl(basemap: RasterBasemap): {
  readonly kind: "pmtiles" | "tiles";
  readonly url: string;
} {
  return basemap.source.toLowerCase().endsWith(".pmtiles")
    ? { kind: "pmtiles", url: `pmtiles://${RASTER_BASE}/${basemap.source}` }
    : { kind: "tiles", url: `${RASTER_BASE}/${basemap.source}` };
}

let discovery: Promise<readonly RasterBasemap[]> | undefined;

/**
 * Lê o manifesto uma vez por sessão.
 *
 * Lista vazia significa "esta máquina não tem imagem de satélite" — não é falha,
 * e quem chama esconde a opção em vez de mostrar erro.
 */
export function discoverRasterBasemaps(): Promise<readonly RasterBasemap[]> {
  discovery ??= (async (): Promise<readonly RasterBasemap[]> => {
    try {
      const response = await fetch(MANIFEST_URL);
      if (!response.ok) return Object.freeze([]);
      const manifest = (await response.json()) as RasterManifest;
      if (!Array.isArray(manifest.basemaps)) return Object.freeze([]);
      const list = manifest.basemaps
        .map((entry, index) => normalize(entry, index))
        .filter((entry): entry is RasterBasemap => entry !== null);
      return Object.freeze(list);
    } catch {
      return Object.freeze([]);
    }
  })();
  return discovery;
}

/** Espelho síncrono, para o caminho que monta o estilo sem poder esperar. */
let cached: readonly RasterBasemap[] = Object.freeze([]);

export function knownRasterBasemaps(): readonly RasterBasemap[] {
  return cached;
}

export async function loadRasterBasemaps(): Promise<readonly RasterBasemap[]> {
  cached = await discoverRasterBasemaps();
  return cached;
}

export function rasterBasemapById(id: string): RasterBasemap | undefined {
  return cached.find((entry) => entry.id === id);
}

/**
 * Escolha de estilo no seletor.
 *
 * Estilos vetoriais são ids fixos; os de satélite dependem do que a máquina tem,
 * então carregam o id da imagem no valor: `sat:<id>` sem rótulos, `sat+:<id>` com.
 * Prefixo em vez de objeto porque o valor vive num `<option>`, que só guarda
 * string.
 */
export type StyleChoice = string;

export interface ParsedStyleChoice {
  readonly kind: "vector" | "satellite";
  readonly id: string;
  readonly labels: boolean;
}

export function parseStyleChoice(choice: StyleChoice): ParsedStyleChoice {
  if (choice.startsWith("sat+:")) {
    return { kind: "satellite", id: choice.slice(5), labels: true };
  }
  if (choice.startsWith("sat:")) {
    return { kind: "satellite", id: choice.slice(4), labels: false };
  }
  return { kind: "vector", id: choice, labels: true };
}
