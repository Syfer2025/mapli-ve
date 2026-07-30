import { err, ok, type Result } from "@theatrum/core-utils";

export const UNIT_ERAS = ["wwi", "wwii", "cold-war", "modern"] as const;
export type UnitEra = (typeof UNIT_ERAS)[number];

export const UNIT_CATEGORIES = [
  "armor",
  "infantry",
  "artillery",
  "air",
  "naval",
  "support",
] as const;
export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

export interface UnitDefinition {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly era: UnitEra;
  readonly nation: string;
  readonly nationAliases: readonly string[];
  readonly category: UnitCategory;
  readonly serviceFrom: number;
  readonly serviceTo: number;
  readonly svg: string;
  readonly app6?: string;
  readonly tags: readonly string[];
}

export interface UnitCatalogDiagnostic {
  readonly path: string;
  readonly message: string;
}

export interface UnitSearchOptions {
  readonly era?: UnitEra;
  readonly nation?: string;
  readonly category?: UnitCategory;
  readonly limit?: number;
}

export interface UnitSearchResult {
  readonly unit: UnitDefinition;
  readonly score: number;
}

export interface UnitCatalog {
  readonly size: number;
  get(id: string): UnitDefinition | undefined;
  list(): readonly UnitDefinition[];
  search(query: string, options?: UnitSearchOptions): readonly UnitSearchResult[];
}

const UNIT_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const MIN_SERVICE_YEAR = 1850;
const MAX_SERVICE_YEAR = 2200;

const QUERY_SYNONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  tanque: ["armor", "tank", "blindado"],
  tank: ["armor", "tanque", "blindado"],
  blindado: ["armor", "tanque", "tank"],
  sovietico: ["soviet", "urss", "ussr", "sovietica"],
  sovietica: ["soviet", "urss", "ussr", "sovietico"],
  alemao: ["german", "germany", "alemanha"],
  alema: ["german", "germany", "alemanha"],
  aviao: ["air", "aircraft", "aeronave"],
  navio: ["naval", "ship", "embarcacao"],
  infantaria: ["infantry"],
  artilharia: ["artillery"],
});

export function parseUnitCatalog(
  input: unknown,
): Result<readonly UnitDefinition[], readonly UnitCatalogDiagnostic[]> {
  if (!Array.isArray(input)) {
    return err([{ path: "", message: "O catálogo deve ser uma lista JSON." }]);
  }

  const diagnostics: UnitCatalogDiagnostic[] = [];
  const units: UnitDefinition[] = [];
  const ids = new Set<string>();
  input.forEach((raw, index) => {
    const path = `/${index}`;
    const parsed = parseUnit(raw, path, diagnostics);
    if (parsed === undefined) return;
    if (ids.has(parsed.id)) {
      diagnostics.push({ path: `${path}/id`, message: `ID duplicado: "${parsed.id}".` });
      return;
    }
    ids.add(parsed.id);
    units.push(parsed);
  });
  return diagnostics.length > 0 ? err(Object.freeze(diagnostics)) : ok(Object.freeze(units));
}

export function createUnitCatalog(units: readonly UnitDefinition[]): UnitCatalog {
  const byId = new Map<string, UnitDefinition>();
  for (const unit of units) {
    if (byId.has(unit.id)) throw new Error(`Unidade duplicada: "${unit.id}".`);
    byId.set(unit.id, deepFreezeUnit(unit));
  }
  const ordered = Object.freeze([...byId.values()]);

  return Object.freeze({
    size: ordered.length,
    get(id: string): UnitDefinition | undefined {
      return byId.get(id);
    },
    list(): readonly UnitDefinition[] {
      return ordered;
    },
    search(query: string, options?: UnitSearchOptions): readonly UnitSearchResult[] {
      const normalizedQuery = normalizeSearchText(query);
      const rawTokens = normalizedQuery.split(/\s+/u).filter(Boolean);
      const yearTokens = rawTokens
        .filter((token) => /^\d{4}$/.test(token))
        .map((token) => Number(token));
      const textTokens = rawTokens.filter((token) => !/^\d{4}$/.test(token));
      const expandedTokens = textTokens.map((token) => [token, ...(QUERY_SYNONYMS[token] ?? [])]);
      const nationFilter =
        options?.nation === undefined ? undefined : normalizeSearchText(options.nation);
      const limit = Math.max(0, Math.floor(options?.limit ?? 50));

      const matches: UnitSearchResult[] = [];
      for (const unit of ordered) {
        if (options?.era !== undefined && unit.era !== options.era) continue;
        if (options?.category !== undefined && unit.category !== options.category) continue;
        const nationText = normalizeSearchText([unit.nation, ...unit.nationAliases].join(" "));
        if (nationFilter !== undefined && !nationText.includes(nationFilter)) continue;
        if (yearTokens.some((year) => year < unit.serviceFrom || year > unit.serviceTo)) {
          continue;
        }

        const fields = searchableFields(unit);
        let score = yearTokens.length * 12;
        let allTextTokensMatch = true;
        for (const alternatives of expandedTokens) {
          let tokenScore = 0;
          for (const alternative of alternatives) {
            tokenScore = Math.max(tokenScore, scoreToken(alternative, fields));
          }
          if (tokenScore === 0) {
            allTextTokensMatch = false;
            break;
          }
          score += tokenScore;
        }
        if (!allTextTokensMatch) continue;
        if (normalizedQuery.length > 0 && fields.full.includes(normalizedQuery)) score += 25;
        if (normalizedQuery.length === 0 && options === undefined) score = 1;
        matches.push(Object.freeze({ unit, score }));
      }
      matches.sort(
        (left, right) =>
          right.score - left.score ||
          left.unit.serviceFrom - right.unit.serviceFrom ||
          left.unit.name.localeCompare(right.unit.name),
      );
      return Object.freeze(matches.slice(0, limit));
    },
  });
}

export async function missingUnitAssets(
  units: readonly UnitDefinition[],
  exists: (path: string) => Promise<boolean>,
): Promise<readonly string[]> {
  const paths = [...new Set(units.map(({ svg }) => svg.split("#", 1)[0] ?? svg))].sort();
  const missing: string[] = [];
  for (const path of paths) {
    if (!(await exists(path))) missing.push(path);
  }
  return Object.freeze(missing);
}

function parseUnit(
  raw: unknown,
  path: string,
  diagnostics: UnitCatalogDiagnostic[],
): UnitDefinition | undefined {
  if (!isRecord(raw)) {
    diagnostics.push({ path, message: "A unidade deve ser um objeto." });
    return undefined;
  }
  const before = diagnostics.length;
  const id = stringField(raw, "id", path, diagnostics);
  const name = stringField(raw, "name", path, diagnostics);
  const aliases = stringListField(raw, "aliases", path, diagnostics);
  const era = enumField(raw, "era", UNIT_ERAS, path, diagnostics);
  const nation = stringField(raw, "nation", path, diagnostics);
  const nationAliases = stringListField(raw, "nationAliases", path, diagnostics);
  const category = enumField(raw, "category", UNIT_CATEGORIES, path, diagnostics);
  const serviceFrom = yearField(raw, "serviceFrom", path, diagnostics);
  const serviceTo = yearField(raw, "serviceTo", path, diagnostics);
  const svg = stringField(raw, "svg", path, diagnostics);
  const app6 = optionalStringField(raw, "app6", path, diagnostics);
  const tags = stringListField(raw, "tags", path, diagnostics);

  if (id !== undefined && !UNIT_ID_PATTERN.test(id)) {
    diagnostics.push({
      path: `${path}/id`,
      message: "O ID deve usar segmentos minúsculos separados por ponto.",
    });
  }
  if (serviceFrom !== undefined && serviceTo !== undefined && serviceFrom > serviceTo) {
    diagnostics.push({
      path: `${path}/serviceTo`,
      message: "serviceTo deve ser igual ou posterior a serviceFrom.",
    });
  }
  if (svg !== undefined && !/\.svg(?:#[A-Za-z][\w.-]*)?$/i.test(svg)) {
    diagnostics.push({
      path: `${path}/svg`,
      message: "svg deve apontar para um arquivo .svg, opcionalmente com #símbolo.",
    });
  }
  if (
    diagnostics.length !== before ||
    id === undefined ||
    name === undefined ||
    aliases === undefined ||
    era === undefined ||
    nation === undefined ||
    nationAliases === undefined ||
    category === undefined ||
    serviceFrom === undefined ||
    serviceTo === undefined ||
    svg === undefined ||
    tags === undefined
  ) {
    return undefined;
  }

  return deepFreezeUnit({
    id,
    name,
    aliases,
    era,
    nation,
    nationAliases,
    category,
    serviceFrom,
    serviceTo,
    svg,
    tags,
    ...(app6 === undefined ? {} : { app6 }),
  });
}

function searchableFields(unit: UnitDefinition): {
  readonly name: string;
  readonly aliases: string;
  readonly nation: string;
  readonly tags: string;
  readonly category: string;
  readonly app6: string;
  readonly full: string;
} {
  const fields = {
    name: normalizeSearchText(unit.name),
    aliases: normalizeSearchText(unit.aliases.join(" ")),
    nation: normalizeSearchText([unit.nation, ...unit.nationAliases].join(" ")),
    tags: normalizeSearchText(unit.tags.join(" ")),
    category: normalizeSearchText(unit.category),
    app6: normalizeSearchText(unit.app6 ?? ""),
  };
  return { ...fields, full: Object.values(fields).join(" ") };
}

function scoreToken(token: string, fields: ReturnType<typeof searchableFields>): number {
  if (fields.name.includes(token)) return 12;
  if (fields.aliases.includes(token)) return 11;
  if (fields.nation.includes(token)) return 10;
  if (fields.category.includes(token)) return 9;
  if (fields.app6.includes(token)) return 8;
  if (fields.tags.includes(token)) return 7;
  return 0;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function deepFreezeUnit(unit: UnitDefinition): UnitDefinition {
  return Object.freeze({
    ...unit,
    aliases: Object.freeze([...unit.aliases]),
    nationAliases: Object.freeze([...unit.nationAliases]),
    tags: Object.freeze([...unit.tags]),
  });
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: UnitCatalogDiagnostic[],
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push({
      path: `${path}/${key}`,
      message: `${key} deve ser uma string não vazia.`,
    });
    return undefined;
  }
  return value.trim();
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: UnitCatalogDiagnostic[],
): string | undefined {
  if (record[key] === undefined) return undefined;
  return stringField(record, key, path, diagnostics);
}

function stringListField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: UnitCatalogDiagnostic[],
): readonly string[] | undefined {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    diagnostics.push({
      path: `${path}/${key}`,
      message: `${key} deve ser uma lista de strings não vazias.`,
    });
    return undefined;
  }
  return Object.freeze(value.map((item) => item.trim()));
}

function yearField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: UnitCatalogDiagnostic[],
): number | undefined {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_SERVICE_YEAR ||
    value > MAX_SERVICE_YEAR
  ) {
    diagnostics.push({
      path: `${path}/${key}`,
      message: `${key} deve ser um ano inteiro entre ${MIN_SERVICE_YEAR} e ${MAX_SERVICE_YEAR}.`,
    });
    return undefined;
  }
  return value;
}

function enumField<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  values: T,
  path: string,
  diagnostics: UnitCatalogDiagnostic[],
): T[number] | undefined {
  const value = record[key];
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    diagnostics.push({
      path: `${path}/${key}`,
      message: `${key} deve ser um de: ${values.join(", ")}.`,
    });
    return undefined;
  }
  return value as T[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
