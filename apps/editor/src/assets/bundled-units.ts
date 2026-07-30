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

/** Só para testes e reload de conteúdo em desenvolvimento. */
export function resetBundledUnitCatalogForTest(): void {
  cached = undefined;
}
