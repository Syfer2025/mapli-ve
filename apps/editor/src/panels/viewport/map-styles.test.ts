import type { GeoJSONSourceSpecification, VectorSourceSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { createMapStyle, MAP_STYLE_OPTIONS, type MapStyleId } from "./map-styles.js";

const EXPECTED_STYLE_IDS: readonly MapStyleId[] = [
  "dark-relief",
  "historical-parchment",
  "minimal-political",
];

const FORBIDDEN_REMOTE_URL = /(?:https?:\/\/|mapbox:\/\/|api\.mapbox|cdn\.)/i;
const LOCAL_DATA_PREFIX = "theatrum-data://local/";

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
});
