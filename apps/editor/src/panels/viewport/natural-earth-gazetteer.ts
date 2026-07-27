import {
  BUILTIN_GAZETTEER_PLACES,
  OfflineGazetteer,
  type GazetteerPlace,
  type PlaceKind,
} from "@theatrum/gis";
import { DATA_BASE_URL } from "@theatrum/shell";

const PLACES_URL = `${DATA_BASE_URL}/natural-earth/ne_10m_populated_places_simple.geojson`;

interface GeoJsonFeature {
  readonly id?: string | number;
  readonly geometry?: {
    readonly type?: string;
    readonly coordinates?: unknown;
  };
  readonly properties?: Readonly<Record<string, unknown>>;
}

interface GeoJsonFeatureCollection {
  readonly type?: string;
  readonly features?: readonly GeoJsonFeature[];
}

function stringProperty(
  properties: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim().length > 0 && value !== "-99") {
      return value.trim();
    }
  }
  return undefined;
}

function numberProperty(
  properties: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function placeKind(properties: Readonly<Record<string, unknown>>): PlaceKind {
  const featureClass = stringProperty(properties, "featurecla", "FEATURECLA")?.toLowerCase() ?? "";
  if (featureClass.includes("capital")) return "capital";
  if (featureClass.includes("village")) return "village";
  if (featureClass.includes("town")) return "town";
  return "city";
}

function featureToPlace(feature: GeoJsonFeature, index: number): GazetteerPlace | undefined {
  const properties = feature.properties;
  const coordinates = feature.geometry?.coordinates;
  if (
    properties === undefined ||
    feature.geometry?.type !== "Point" ||
    !Array.isArray(coordinates) ||
    typeof coordinates[0] !== "number" ||
    typeof coordinates[1] !== "number" ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1])
  ) {
    return undefined;
  }

  const name = stringProperty(properties, "name", "NAME", "nameascii", "NAMEASCII");
  if (name === undefined) return undefined;

  const country =
    stringProperty(properties, "iso_a2", "ISO_A2", "adm0_a3", "ADM0_A3", "sov_a3", "SOV_A3") ?? "—";
  const admin1 = stringProperty(properties, "adm1name", "ADM1NAME");
  const population = numberProperty(properties, "pop_max", "POP_MAX");
  const rawId =
    stringProperty(properties, "ne_id", "NE_ID", "wikidataid", "WIKIDATAID") ??
    String(feature.id ?? index);

  return {
    id: `natural_earth_${rawId}_${index}`,
    name,
    country,
    kind: placeKind(properties),
    lngLat: [coordinates[0], coordinates[1]],
    ...(admin1 === undefined ? {} : { admin1 }),
    ...(population === undefined ? {} : { population }),
  };
}

/**
 * Carrega o índice grande na borda do app. O pacote GIS continua puro e pode
 * ser testado sem DOM, fetch ou conhecimento do formato GeoJSON.
 */
export async function loadNaturalEarthGazetteer(signal?: AbortSignal): Promise<OfflineGazetteer> {
  const response = await fetch(PLACES_URL, signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error(`gazetteer local respondeu ${response.status}`);

  const collection = (await response.json()) as GeoJsonFeatureCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new TypeError("gazetteer local não é um FeatureCollection");
  }

  const places = collection.features
    .map(featureToPlace)
    .filter((place): place is GazetteerPlace => place !== undefined);

  const essentialFallbacks = BUILTIN_GAZETTEER_PLACES.filter(
    (fallback) =>
      !places.some(
        (place) =>
          place.name.toLocaleLowerCase("en-US") === fallback.name.toLocaleLowerCase("en-US") &&
          place.country === fallback.country &&
          Math.abs(place.lngLat[0] - fallback.lngLat[0]) < 0.2 &&
          Math.abs(place.lngLat[1] - fallback.lngLat[1]) < 0.2,
      ),
  );

  return new OfflineGazetteer([...essentialFallbacks, ...places]);
}
