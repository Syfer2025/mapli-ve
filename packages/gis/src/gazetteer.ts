import { BUILTIN_GAZETTEER_PLACES } from "./gazetteer-data.js";
import type { GazetteerHit, GazetteerPlace, GazetteerPort, GazetteerResolution } from "./types.js";

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/** Normalização compartilhada pelo índice e pela consulta. */
export function normalizePlaceQuery(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLocaleLowerCase("en-US")
    .replace(NON_ALPHANUMERIC, " ")
    .trim()
    .replace(/\s+/g, " ");
}

interface IndexedPlace {
  readonly place: GazetteerPlace;
  readonly bareKeys: readonly string[];
  readonly qualifiedKeys: readonly string[];
  readonly searchTokens: ReadonlySet<string>;
}

function normalizedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizePlaceQuery).filter((value) => value.length > 0))];
}

function combine(parts: readonly string[]): string {
  return normalizePlaceQuery(parts.join(" "));
}

function snapshotPlace(place: GazetteerPlace): GazetteerPlace {
  const optionalAdmin = place.admin1 === undefined ? {} : { admin1: place.admin1 };
  const optionalPopulation = place.population === undefined ? {} : { population: place.population };
  const optionalAliases =
    place.aliases === undefined ? {} : { aliases: Object.freeze([...place.aliases]) };
  const optionalCountryAliases =
    place.countryAliases === undefined
      ? {}
      : { countryAliases: Object.freeze([...place.countryAliases]) };
  const optionalAdminAliases =
    place.admin1Aliases === undefined
      ? {}
      : { admin1Aliases: Object.freeze([...place.admin1Aliases]) };
  return Object.freeze({
    id: place.id,
    name: place.name,
    country: place.country,
    kind: place.kind,
    lngLat: Object.freeze([place.lngLat[0], place.lngLat[1]] as const),
    ...optionalAdmin,
    ...optionalPopulation,
    ...optionalAliases,
    ...optionalCountryAliases,
    ...optionalAdminAliases,
  });
}

function indexPlace(place: GazetteerPlace): IndexedPlace {
  const names = normalizedUnique([place.name, ...(place.aliases ?? [])]);
  const countries = normalizedUnique([place.country, ...(place.countryAliases ?? [])]);
  const adminAreas = normalizedUnique(
    place.admin1 === undefined
      ? [...(place.admin1Aliases ?? [])]
      : [place.admin1, ...(place.admin1Aliases ?? [])],
  );

  const qualifiedKeys: string[] = [];
  for (const name of names) {
    for (const country of countries) qualifiedKeys.push(combine([name, country]));
    for (const admin of adminAreas) {
      qualifiedKeys.push(combine([name, admin]));
      for (const country of countries) qualifiedKeys.push(combine([name, admin, country]));
    }
  }

  const allKeys = normalizedUnique([...names, ...qualifiedKeys]);
  return {
    place,
    bareKeys: names,
    qualifiedKeys: normalizedUnique(qualifiedKeys),
    searchTokens: new Set(allKeys.flatMap((key) => key.split(" "))),
  };
}

function hitFromPlace(place: GazetteerPlace, score: number): GazetteerHit {
  const optionalAdmin = place.admin1 === undefined ? {} : { admin1: place.admin1 };
  const optionalPopulation = place.population === undefined ? {} : { population: place.population };
  return Object.freeze({
    id: place.id,
    name: place.name,
    country: place.country,
    kind: place.kind,
    lngLat: Object.freeze([place.lngLat[0], place.lngLat[1]] as const),
    ...optionalAdmin,
    ...optionalPopulation,
    score,
  });
}

function matchScore(indexed: IndexedPlace, query: string): number | undefined {
  if (indexed.qualifiedKeys.includes(query)) return 1;
  if (indexed.bareKeys.includes(query)) return 0.95;

  const allKeys = [...indexed.bareKeys, ...indexed.qualifiedKeys];
  if (allKeys.some((key) => key.startsWith(query))) return 0.8;

  const queryTokens = query.split(" ");
  if (
    queryTokens.length > 0 &&
    queryTokens.every((token) =>
      [...indexed.searchTokens].some((candidate) => candidate.startsWith(token)),
    )
  ) {
    return 0.65;
  }
  return undefined;
}

function compareHits(a: GazetteerHit, b: GazetteerHit): number {
  if (a.score !== b.score) return b.score - a.score;
  const populationDifference = (b.population ?? -1) - (a.population ?? -1);
  if (populationDifference !== 0) return populationDifference;
  return a.id.localeCompare(b.id, "en");
}

/**
 * Gazetteer em memória, puro e sem I/O.
 *
 * O construtor recebe dados já carregados; ler Natural Earth/PMTiles é
 * responsabilidade da borda da aplicação.
 */
export class OfflineGazetteer implements GazetteerPort {
  readonly #places: readonly IndexedPlace[];

  constructor(places: readonly GazetteerPlace[] = BUILTIN_GAZETTEER_PLACES) {
    const ids = new Set<string>();
    this.#places = Object.freeze(
      places.map((place) => {
        if (ids.has(place.id)) throw new RangeError(`duplicate gazetteer id: ${place.id}`);
        ids.add(place.id);
        if (normalizePlaceQuery(place.name).length === 0) {
          throw new RangeError(`gazetteer place ${place.id} has an empty name`);
        }
        if (!Number.isFinite(place.lngLat[0]) || !Number.isFinite(place.lngLat[1])) {
          throw new RangeError(`gazetteer place ${place.id} has invalid coordinates`);
        }
        return indexPlace(snapshotPlace(place));
      }),
    );
  }

  search(query: string): readonly GazetteerHit[] {
    const normalizedQuery = normalizePlaceQuery(query);
    if (normalizedQuery.length === 0) return Object.freeze([]);

    const hits: GazetteerHit[] = [];
    for (const indexed of this.#places) {
      const score = matchScore(indexed, normalizedQuery);
      if (score !== undefined) hits.push(hitFromPlace(indexed.place, score));
    }
    hits.sort(compareHits);
    return Object.freeze(hits);
  }

  async resolve(query: string): Promise<readonly GazetteerHit[]> {
    return this.search(query);
  }

  resolveExact(query: string): GazetteerHit | undefined {
    const normalizedQuery = normalizePlaceQuery(query);
    if (normalizedQuery.length === 0) return undefined;

    const matches: GazetteerHit[] = [];
    for (const indexed of this.#places) {
      if (
        indexed.bareKeys.includes(normalizedQuery) ||
        indexed.qualifiedKeys.includes(normalizedQuery)
      ) {
        matches.push(
          hitFromPlace(indexed.place, indexed.qualifiedKeys.includes(normalizedQuery) ? 1 : 0.95),
        );
      }
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  resolveResult(query: string): GazetteerResolution {
    return classifyGazetteerHits(query, this.search(query));
  }
}

export function classifyGazetteerHits(
  query: string,
  hits: readonly GazetteerHit[],
): GazetteerResolution {
  const ranked = [...hits].sort(compareHits);
  const best = ranked[0];
  if (best === undefined) return { status: "not-found", query, hits: [] };

  const equallyGood = ranked.filter((hit) => Math.abs(hit.score - best.score) <= 1e-12);
  if (equallyGood.length > 1) {
    return { status: "ambiguous", query, hits: Object.freeze(equallyGood) };
  }
  return { status: "resolved", query, hit: best };
}

export async function resolvePlace(
  gazetteer: GazetteerPort,
  query: string,
): Promise<GazetteerResolution> {
  return classifyGazetteerHits(query, await gazetteer.resolve(query));
}
