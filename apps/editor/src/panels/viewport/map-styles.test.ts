import type { GeoJSONSourceSpecification, VectorSourceSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import type { DetailedBasemap } from "./detailed-basemap.js";
import {
  createDetailedMapStyle,
  createMapStyle,
  createSatelliteStyle,
  MAP_STYLE_OPTIONS,
  type MapStyleId,
} from "./map-styles.js";
import type { RasterBasemap } from "./raster-basemap.js";

const EXPECTED_STYLE_IDS: readonly MapStyleId[] = [
  "dark-relief",
  "historical-parchment",
  "minimal-political",
];

const FORBIDDEN_REMOTE_URL = /(?:https?:\/\/|mapbox:\/\/|api\.mapbox|cdn\.)/i;
const LOCAL_DATA_PREFIX = "theatrum-data://local/";
const IRAN_HORMUZ: DetailedBasemap = {
  id: "iran-hormuz",
  label: "Detalhado · Irã e Estreito de Hormuz",
  source: "iran-hormuz.pmtiles",
  bounds: [43, 22, 65, 41],
  focusBounds: [55.6, 25.3, 57.7, 27.8],
  minZoom: 0,
  maxZoom: 15,
  attribution: "Protomaps © OpenStreetMap contributors",
};
const SATELLITE: RasterBasemap = {
  id: "satellite",
  label: "Satélite local",
  source: "hormuz.pmtiles",
  tileSize: 256,
  minZoom: 0,
  maxZoom: 15,
  attribution: "Imagem licenciada local",
};

describe("estilos offline do mapa", () => {
  it("publica exatamente os três estilos da Fase 2", () => {
    expect(MAP_STYLE_OPTIONS.map((option) => option.id)).toEqual(EXPECTED_STYLE_IDS);
    expect(new Set(MAP_STYLE_OPTIONS.map((option) => option.label)).size).toBe(3);
  });

  it.each(EXPECTED_STYLE_IDS)("%s usa somente PMTiles e dados locais", (styleId) => {
    const style = createMapStyle(styleId);
    const serialized = JSON.stringify(style);

    expect(style.version).toBe(8);
    expect(style.sources).toBeDefined();
    expect(serialized).not.toMatch(FORBIDDEN_REMOTE_URL);
    expect(serialized).not.toContain("access_token");

    const basemap = style.sources["natural-earth"] as VectorSourceSpecification;
    expect(basemap).toMatchObject({
      type: "vector",
      url: `pmtiles://${LOCAL_DATA_PREFIX}basemap/natural-earth-world.pmtiles`,
    });

    const localGeoJsonSources = ["places", "lakes", "rivers"] as const;
    for (const sourceId of localGeoJsonSources) {
      const source = style.sources[sourceId] as GeoJSONSourceSpecification;
      expect(source.type).toBe("geojson");
      expect(source.data).toEqual(expect.stringMatching(/^theatrum-data:\/\/local\//));
    }

    expect(style.glyphs).toBe(`${LOCAL_DATA_PREFIX}glyphs/{fontstack}/{range}.pbf`);
  });

  it.each(EXPECTED_STYLE_IDS)("%s só referencia fontes declaradas", (styleId) => {
    const style = createMapStyle(styleId);
    const sourceIds = new Set(Object.keys(style.sources));

    for (const layer of style.layers) {
      if ("source" in layer && typeof layer.source === "string") {
        expect(sourceIds.has(layer.source), `${layer.id} → ${layer.source}`).toBe(true);
      }
    }
  });

  it("gera cópias independentes para o MapLibre anexar estado", () => {
    const first = createMapStyle("dark-relief");
    const second = createMapStyle("dark-relief");

    expect(first).not.toBe(second);
    expect(first.sources).not.toBe(second.sources);
    expect(first.layers).not.toBe(second.layers);
    expect(first.layers[0]).not.toBe(second.layers[0]);
    expect(first).toEqual(second);
  });

  it("o mapa regional detalhado contém a hierarquia urbana até ruas e edifícios", () => {
    const style = createDetailedMapStyle(IRAN_HORMUZ);
    const serialized = JSON.stringify(style);
    const sourceLayers = new Set(
      style.layers.flatMap((layer) =>
        "source-layer" in layer && typeof layer["source-layer"] === "string"
          ? [layer["source-layer"]]
          : [],
      ),
    );

    expect(style.layers.length).toBeGreaterThanOrEqual(70);
    for (const sourceLayer of [
      "boundaries",
      "buildings",
      "landcover",
      "landuse",
      "places",
      "roads",
      "water",
    ]) {
      expect(sourceLayers.has(sourceLayer), sourceLayer).toBe(true);
    }
    expect(style.sources["regional-detail"]).toMatchObject({
      type: "vector",
      url: `pmtiles://${LOCAL_DATA_PREFIX}basemap/iran-hormuz.pmtiles`,
      maxzoom: 15,
    });
    expect(style.glyphs).toBe(`${LOCAL_DATA_PREFIX}glyphs/{fontstack}/{range}.pbf`);
    expect(style.sprite).toBe(`${LOCAL_DATA_PREFIX}sprites/protomaps-light`);
    expect(serialized).not.toContain("access_token");
  });

  it("o híbrido usa os rótulos detalhados sobre a imagem local", () => {
    const style = createSatelliteStyle(SATELLITE, {
      labels: true,
      labelsBasemap: IRAN_HORMUZ,
    });

    expect(style.sources).toHaveProperty("satellite");
    expect(style.sources).toHaveProperty("regional-detail");
    expect(style.sources).not.toHaveProperty("natural-earth");
    expect(style.layers.some((layer) => layer.id === "places_locality")).toBe(true);
    expect(style.layers.some((layer) => layer.id === "roads_labels_major")).toBe(true);
    expect(style.layers.some((layer) => layer.id === "earth")).toBe(false);
  });
});
