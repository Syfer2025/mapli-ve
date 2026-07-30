import {
  BUILTIN_GAZETTEER_PLACES,
  OfflineGazetteer,
  classifyGazetteerHits,
  type GazetteerHit,
  type GazetteerPlace,
  type GazetteerPort,
  type LngLat,
} from "@theatrum/gis";
import type { ScenePlace, SceneScript } from "@theatrum/schema";
import type { SceneDiagnostic } from "./contracts.js";
import { diagnostic, pointer, suggest } from "./diagnostics.js";

const HISTORICAL_PLACES: readonly GazetteerPlace[] = Object.freeze([
  {
    id: "pella-gr",
    name: "Pella",
    country: "GR",
    countryAliases: ["Greece"],
    kind: "town",
    lngLat: [22.519, 40.761],
  },
  {
    id: "tyre-lb",
    name: "Tyre",
    country: "LB",
    countryAliases: ["Lebanon"],
    aliases: ["Sour"],
    kind: "city",
    lngLat: [35.196, 33.271],
  },
]);

export function createDefaultSceneGazetteer(): GazetteerPort {
  return new OfflineGazetteer([...BUILTIN_GAZETTEER_PLACES, ...HISTORICAL_PLACES]);
}

export class ScenePlaceResolver {
  readonly #scene: SceneScript;
  readonly #gazetteer: GazetteerPort;
  readonly #diagnostics: SceneDiagnostic[];
  readonly #named = new Map<string, LngLat>();
  readonly #queryCache = new Map<string, Promise<readonly GazetteerHit[]>>();

  constructor(scene: SceneScript, gazetteer: GazetteerPort, diagnostics: SceneDiagnostic[]) {
    this.#scene = scene;
    this.#gazetteer = gazetteer;
    this.#diagnostics = diagnostics;
  }

  async resolveDeclarations(): Promise<ReadonlyMap<string, LngLat>> {
    const declarations = Object.entries(this.#scene.places ?? {}).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    );
    const resolved = await Promise.all(
      declarations.map(async ([name, place]) => {
        const coordinate = await this.#resolveExternal(place, ["places", name]);
        return coordinate === null ? null : ([name, coordinate] as const);
      }),
    );
    for (const entry of resolved) {
      if (entry !== null) this.#named.set(entry[0], entry[1]);
    }
    return this.#named;
  }

  async resolve(place: ScenePlace, parts: readonly (string | number)[]): Promise<LngLat | null> {
    if (typeof place === "string") {
      const named = this.#named.get(place);
      if (named !== undefined) return named;
      return this.#resolveQuery(place, parts, true);
    }
    return coordinate(place);
  }

  named(): ReadonlyMap<string, LngLat> {
    return this.#named;
  }

  async #resolveExternal(
    place: ScenePlace,
    parts: readonly (string | number)[],
  ): Promise<LngLat | null> {
    if (typeof place !== "string") return coordinate(place);
    return this.#resolveQuery(place, parts, false);
  }

  async #resolveQuery(
    query: string,
    parts: readonly (string | number)[],
    suggestNamed: boolean,
  ): Promise<LngLat | null> {
    let pending = this.#queryCache.get(query);
    if (pending === undefined) {
      pending = this.#gazetteer.resolve(query);
      this.#queryCache.set(query, pending);
    }
    let hits: readonly GazetteerHit[];
    try {
      hits = await pending;
    } catch (error: unknown) {
      this.#diagnostics.push(
        diagnostic(
          "error",
          "place-not-found",
          pointer(parts),
          `gazetteer falhou ao resolver "${query}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      return null;
    }

    const resolution = classifyGazetteerHits(query, hits);
    if (resolution.status === "resolved") return resolution.hit.lngLat;
    if (resolution.status === "not-found") {
      this.#diagnostics.push(
        diagnostic("error", "place-not-found", pointer(parts), `lugar "${query}" não encontrado`, {
          hint: "declare coordenadas em places ou qualifique com país/estado",
          didYouMean: suggestNamed ? suggest(query, [...this.#named.keys()]) : [],
        }),
      );
      return null;
    }
    const candidates = resolution.hits.slice(0, 8).map(formatHit);
    this.#diagnostics.push(
      diagnostic(
        "error",
        "place-ambiguous",
        pointer(parts),
        `"${query}" é ambíguo (${resolution.hits.length} resultados)`,
        {
          hint: `qualifique o lugar, por exemplo: ${candidates.join(" | ")}`,
          didYouMean: candidates,
        },
      ),
    );
    return null;
  }
}

function coordinate(place: Exclude<ScenePlace, string>): LngLat {
  return Array.isArray(place)
    ? Object.freeze([place[0], place[1]])
    : Object.freeze([place.lng, place.lat]);
}

function formatHit(hit: GazetteerHit): string {
  return hit.admin1 === undefined
    ? `${hit.name}, ${hit.country}`
    : `${hit.name}, ${hit.admin1}, ${hit.country}`;
}
