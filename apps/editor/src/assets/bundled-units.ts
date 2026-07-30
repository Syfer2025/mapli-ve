import { DATA_BASE_URL } from "@theatrum/shell";
import {
  createUnitCatalog,
  parseUnitCatalog,
  type UnitCatalog,
  type UnitDefinition,
} from "@theatrum/plugin-host";

const CATALOG_URL = `${DATA_BASE_URL}/plugin-content/unit-library.json`;
const CONTENT_BASE_URL = `${DATA_BASE_URL}/`;

let cached: Promise<UnitCatalog | null> | undefined;
const unitSvgCache = new Map<string, Promise<string | null>>();

export function loadBundledUnitCatalog(): Promise<UnitCatalog | null> {
  cached ??= fetch(CATALOG_URL)
    .then(async (response) => {
      if (!response.ok) return null;
      const parsed = parseUnitCatalog((await response.json()) as unknown);
      return parsed.ok ? createUnitCatalog(parsed.value) : null;
    })
    .catch(() => null);
  return cached;
}

export function bundledUnitSvgUrl(unit: UnitDefinition): string {
  return `${CONTENT_BASE_URL}${unit.svg}`;
}

export function loadStandaloneBundledUnitSvg(unit: UnitDefinition): Promise<string | null> {
  const existing = unitSvgCache.get(unit.id);
  if (existing !== undefined) return existing;

  const [spritePath, symbolId] = unit.svg.split("#", 2);
  if (spritePath === undefined || spritePath.length === 0 || symbolId !== unit.id) {
    return Promise.resolve(null);
  }
  const pending = fetch(`${CONTENT_BASE_URL}${spritePath}`)
    .then(async (response) =>
      response.ok ? materializeUnitSvg(await response.text(), symbolId) : null,
    )
    .catch(() => null);
  unitSvgCache.set(unit.id, pending);
  return pending;
}

/**
 * Converte o símbolo do sprite empacotado em um SVG autônomo. O resultado pode
 * entrar no AssetStore do projeto e não depende do catálogo na reabertura.
 */
export function materializeUnitSvg(sprite: string, id: string): string | null {
  if (!/^[a-z][a-z0-9.-]*$/.test(id)) return null;
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<symbol\\b([^>]*\\bid=["']${escapedId}["'][^>]*)>([\\s\\S]*?)<\\/symbol>`,
    "i",
  ).exec(sprite);
  if (match === null) return null;

  const attributes = match[1] ?? "";
  const content = match[2] ?? "";
  const viewBox = /\bviewBox=["']([^"']+)["']/i.exec(attributes)?.[1]?.trim() ?? "0 0 96 64";
  if (!/^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){3}$/.test(viewBox)) return null;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
    `width="960" height="640" role="img">${content}</svg>\n`
  );
}

/** Só para testes e reload de conteúdo em desenvolvimento. */
export function resetBundledUnitCatalogForTest(): void {
  cached = undefined;
  unitSvgCache.clear();
}
