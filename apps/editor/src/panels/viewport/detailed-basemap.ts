import { DATA_BASE_URL } from "@theatrum/shell";

const MANIFEST_URL = `${DATA_BASE_URL}/basemap/detailed-basemaps.json`;
const BASEMAP_BASE = `${DATA_BASE_URL}/basemap`;

export type MapBounds = readonly [west: number, south: number, east: number, north: number];

export interface DetailedBasemap {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly bounds: MapBounds;
  readonly focusBounds: MapBounds;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly attribution: string;
}

interface DetailedBasemapManifest {
  readonly version: number;
  readonly basemaps: readonly Partial<DetailedBasemap>[];
}

function isBounds(value: unknown): value is MapBounds {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [west, south, east, north] = value;
  return (
    [west, south, east, north].every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
    ) &&
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west < east &&
    south < north
  );
}

function isSafePmtilesName(source: unknown): source is string {
  return (
    typeof source === "string" &&
    /^[a-z0-9][a-z0-9._-]*\.pmtiles$/i.test(source) &&
    !source.includes("..")
  );
}

function normalize(entry: Partial<DetailedBasemap>): DetailedBasemap | null {
  if (
    typeof entry.id !== "string" ||
    !/^[a-z0-9][a-z0-9_-]*$/i.test(entry.id) ||
    typeof entry.label !== "string" ||
    entry.label.length === 0 ||
    !isSafePmtilesName(entry.source) ||
    !isBounds(entry.bounds)
  ) {
    return null;
  }

  const focusBounds = isBounds(entry.focusBounds) ? entry.focusBounds : entry.bounds;
  const minZoom =
    typeof entry.minZoom === "number" && Number.isFinite(entry.minZoom) ? entry.minZoom : 0;
  const maxZoom =
    typeof entry.maxZoom === "number" && Number.isFinite(entry.maxZoom) ? entry.maxZoom : 15;

  return Object.freeze({
    id: entry.id,
    label: entry.label,
    source: entry.source,
    bounds: Object.freeze([...entry.bounds]) as unknown as MapBounds,
    focusBounds: Object.freeze([...focusBounds]) as unknown as MapBounds,
    minZoom,
    maxZoom,
    attribution:
      typeof entry.attribution === "string" && entry.attribution.length > 0
        ? entry.attribution
        : "Protomaps © OpenStreetMap contributors",
  });
}

export function detailedBasemapFileUrl(basemap: DetailedBasemap): string {
  return `${BASEMAP_BASE}/${basemap.source}`;
}

export function detailedBasemapSourceUrl(basemap: DetailedBasemap): string {
  return `pmtiles://${detailedBasemapFileUrl(basemap)}`;
}

let discovery: Promise<readonly DetailedBasemap[]> | undefined;
let cached: readonly DetailedBasemap[] = Object.freeze([]);

/**
 * O manifesto é versionado, mas um pacote regional de gigabytes é opcional.
 * Só publicamos no seletor as entradas cujo PMTiles realmente existe no disco.
 */
export function discoverDetailedBasemaps(): Promise<readonly DetailedBasemap[]> {
  discovery ??= (async (): Promise<readonly DetailedBasemap[]> => {
    try {
      const response = await fetch(MANIFEST_URL);
      if (!response.ok) return Object.freeze([]);
      const manifest = (await response.json()) as DetailedBasemapManifest;
      if (manifest.version !== 1 || !Array.isArray(manifest.basemaps)) return Object.freeze([]);

      const candidates = manifest.basemaps
        .map((entry) => normalize(entry))
        .filter((entry): entry is DetailedBasemap => entry !== null);
      const available = await Promise.all(
        candidates.map(async (entry) => {
          try {
            const file = await fetch(detailedBasemapFileUrl(entry), { method: "HEAD" });
            return file.ok ? entry : null;
          } catch {
            return null;
          }
        }),
      );
      return Object.freeze(available.filter((entry): entry is DetailedBasemap => entry !== null));
    } catch {
      return Object.freeze([]);
    }
  })();
  return discovery;
}

export function knownDetailedBasemaps(): readonly DetailedBasemap[] {
  return cached;
}

export async function loadDetailedBasemaps(): Promise<readonly DetailedBasemap[]> {
  cached = await discoverDetailedBasemaps();
  return cached;
}

export function detailedBasemapById(id: string): DetailedBasemap | undefined {
  return cached.find((entry) => entry.id === id);
}
