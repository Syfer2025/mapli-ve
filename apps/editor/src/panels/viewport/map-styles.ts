import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import { DATA_BASE_URL } from "@theatrum/shell";
import type {
  LayerSpecification,
  RasterSourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { detailedBasemapSourceUrl, type DetailedBasemap } from "./detailed-basemap.js";
import { rasterSourceUrl, type RasterBasemap } from "./raster-basemap.js";

export type MapStyleId =
  | "dark-relief"
  | "historical-parchment"
  | "minimal-political"
  | "strategic-war-room";

export interface MapStyleOption {
  readonly id: MapStyleId;
  readonly label: string;
}

const MAP_STYLE_LABELS: Readonly<Record<MapStyleId, string>> = {
  "dark-relief": "Relevo escuro",
  "historical-parchment": "Pergaminho histórico",
  "minimal-political": "Político minimalista",
  "strategic-war-room": "Sala de guerra estratégica",
};

export const MAP_STYLE_OPTIONS: readonly MapStyleOption[] = [
  { id: "dark-relief", label: MAP_STYLE_LABELS["dark-relief"] },
  { id: "historical-parchment", label: MAP_STYLE_LABELS["historical-parchment"] },
  { id: "minimal-political", label: MAP_STYLE_LABELS["minimal-political"] },
  { id: "strategic-war-room", label: MAP_STYLE_LABELS["strategic-war-room"] },
];

const BASEMAP_URL = `pmtiles://${DATA_BASE_URL}/basemap/natural-earth-world.pmtiles`;
const PLACES_URL = `${DATA_BASE_URL}/natural-earth/ne_10m_populated_places_simple.geojson`;
const LAKES_URL = `${DATA_BASE_URL}/natural-earth/ne_110m_lakes.geojson`;
const RIVERS_URL = `${DATA_BASE_URL}/natural-earth/ne_110m_rivers_lake_centerlines.geojson`;
const GLYPHS_URL = `${DATA_BASE_URL}/glyphs/{fontstack}/{range}.pbf`;
const PROTOMAPS_SPRITE_URL = `${DATA_BASE_URL}/sprites/protomaps-light`;
const DETAILED_SOURCE_ID = "regional-detail";

interface Palette {
  readonly ocean: string;
  readonly land: string;
  readonly landAlternate: string;
  readonly border: string;
  readonly disputed: string;
  readonly water: string;
  readonly waterLine: string;
  readonly label: string;
  readonly labelHalo: string;
  readonly city: string;
}

const PALETTES: Readonly<Record<MapStyleId, Palette>> = {
  "dark-relief": {
    ocean: "#071119",
    land: "#18241f",
    landAlternate: "#202e27",
    border: "#617466",
    disputed: "#c49b53",
    water: "#102c3a",
    waterLine: "#3e8195",
    label: "#d5ddd4",
    labelHalo: "#0a1210",
    city: "#e5bd75",
  },
  "historical-parchment": {
    ocean: "#8fa79f",
    land: "#d2c29c",
    landAlternate: "#c5b58d",
    border: "#66553e",
    disputed: "#8e3d31",
    water: "#8aa7a1",
    waterLine: "#526f6d",
    label: "#3a3024",
    labelHalo: "#e1d5b4",
    city: "#7f2f26",
  },
  "minimal-political": {
    ocean: "#10171e",
    land: "#252d35",
    landAlternate: "#303943",
    border: "#8b98a5",
    disputed: "#d69c45",
    water: "#162c3d",
    waterLine: "#4e87a8",
    label: "#ecf0f3",
    labelHalo: "#11171d",
    city: "#5bb6aa",
  },
  "strategic-war-room": {
    ocean: "#08111b",
    land: "#1b2530",
    landAlternate: "#222e3a",
    border: "#a9b6c4",
    disputed: "#d1a75b",
    water: "#0e2537",
    waterLine: "#386982",
    label: "#dce5ee",
    labelHalo: "#08111b",
    city: "#dce5ee",
  },
};

function countryFill(palette: Palette): LayerSpecification {
  return {
    id: "countries-fill",
    type: "fill",
    source: "natural-earth",
    "source-layer": "countries",
    paint: {
      "fill-color": [
        "case",
        ["in", ["get", "CONTINENT"], ["literal", ["Europe", "Asia", "Africa"]]],
        palette.land,
        palette.landAlternate,
      ],
      "fill-opacity": 1,
    },
  };
}

function layers(palette: Palette): LayerSpecification[] {
  return [
    {
      id: "ocean",
      type: "background",
      paint: { "background-color": palette.ocean },
    },
    countryFill(palette),
    {
      id: "country-borders",
      type: "line",
      source: "natural-earth",
      "source-layer": "countries",
      paint: {
        "line-color": palette.border,
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.45, 6, 1.2],
        "line-opacity": 0.88,
      },
    },
    {
      id: "geographic-lines",
      type: "line",
      source: "natural-earth",
      "source-layer": "geolines",
      paint: {
        "line-color": palette.disputed,
        "line-width": 0.75,
        "line-dasharray": [3, 3],
        "line-opacity": 0.72,
      },
    },
    {
      id: "lakes",
      type: "fill",
      source: "lakes",
      paint: {
        "fill-color": palette.water,
        "fill-outline-color": palette.waterLine,
      },
    },
    {
      id: "rivers",
      type: "line",
      source: "rivers",
      paint: {
        "line-color": palette.waterLine,
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.25, 6, 1.1],
        "line-opacity": 0.75,
      },
    },
    {
      id: "country-labels",
      type: "symbol",
      source: "natural-earth",
      "source-layer": "centroids",
      minzoom: 1,
      layout: {
        "text-field": ["get", "NAME"],
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 6, 13],
        "text-letter-spacing": 0.08,
        "text-transform": "uppercase",
        "text-max-width": 8,
      },
      paint: {
        "text-color": palette.label,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.2,
        "text-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.72, 4, 0.35],
      },
    },
    {
      id: "cities",
      type: "circle",
      source: "places",
      minzoom: 2,
      filter: ["<=", ["coalesce", ["get", "rank_max"], 10], 10],
      paint: {
        "circle-color": palette.city,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.2, 6, 2.4],
        "circle-stroke-color": palette.labelHalo,
        "circle-stroke-width": 0.8,
        "circle-opacity": 0.9,
      },
    },
    {
      id: "city-labels",
      type: "symbol",
      source: "places",
      minzoom: 3,
      filter: ["<=", ["coalesce", ["get", "rank_max"], 10], 9],
      layout: {
        "text-field": ["coalesce", ["get", "name"], ["get", "NAME"]],
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 7, 12],
        "text-offset": [0, 0.85],
        "text-anchor": "top",
        "text-max-width": 10,
      },
      paint: {
        "text-color": palette.label,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.1,
      },
    },
  ];
}

/** Gera uma cópia nova: o MapLibre anexa estado interno ao style em runtime. */
export function createMapStyle(styleId: MapStyleId): StyleSpecification {
  const palette = PALETTES[styleId];
  const styleLayers =
    styleId === "strategic-war-room"
      ? layers(palette).filter(
          (layer) =>
            layer.id !== "country-labels" &&
            layer.id !== "geographic-lines" &&
            layer.id !== "cities" &&
            layer.id !== "city-labels",
        )
      : layers(palette);
  return {
    version: 8,
    name: MAP_STYLE_LABELS[styleId],
    glyphs: GLYPHS_URL,
    sources: {
      "natural-earth": {
        type: "vector",
        url: BASEMAP_URL,
        attribution: "Natural Earth · domínio público",
      },
      places: {
        type: "geojson",
        data: PLACES_URL,
      },
      lakes: {
        type: "geojson",
        data: LAKES_URL,
      },
      rivers: {
        type: "geojson",
        data: RIVERS_URL,
      },
    },
    layers: styleLayers,
  };
}

/**
 * Estilo urbano/regional baseado em OpenStreetMap.
 *
 * Diferente do bootstrap mundial z0–6, este tileset chega a z15 e inclui
 * províncias, cidades, ruas, edifícios, uso do solo, água e pontos de interesse.
 * Fonte, glifos e sprites continuam locais para o export ser reproduzível.
 */
export function createDetailedMapStyle(basemap: DetailedBasemap): StyleSpecification {
  return {
    version: 8,
    name: basemap.label,
    glyphs: GLYPHS_URL,
    sprite: PROTOMAPS_SPRITE_URL,
    sources: {
      [DETAILED_SOURCE_ID]: {
        type: "vector",
        url: detailedBasemapSourceUrl(basemap),
        minzoom: basemap.minZoom,
        maxzoom: basemap.maxZoom,
        attribution: basemap.attribution,
      },
    },
    layers: protomapsLayers(DETAILED_SOURCE_ID, namedFlavor("light"), {
      lang: "en",
    }) as unknown as LayerSpecification[],
  };
}

/**
 * Estilo com imagem de satélite por baixo.
 *
 * Duas variantes, e a diferença entre elas é o que a AiTelly usa nas cenas:
 * satélite **puro** para o plano geral, e satélite **com rótulos** quando a cena
 * precisa nomear cidades e países. A segunda reaproveita as camadas de rótulo do
 * estilo vetorial — não há um segundo conjunto de tipografia para manter.
 *
 * A opacidade entra como parâmetro porque o documento pode animá-la: é o que
 * permite dissolver de vetorial para satélite dentro de uma animação, em vez de
 * trocar de estilo no meio e piscar.
 */
export function createSatelliteStyle(
  basemap: RasterBasemap,
  options: {
    readonly labels: boolean;
    readonly opacity?: number;
    /** Quando cobre a mesma região, fornece ruas, províncias e cidades ao híbrido. */
    readonly labelsBasemap?: DetailedBasemap;
  } = { labels: true },
): StyleSpecification {
  const palette = PALETTES["dark-relief"];
  const source = rasterSourceUrl(basemap);
  const raster: RasterSourceSpecification = {
    type: "raster",
    tileSize: basemap.tileSize,
    minzoom: basemap.minZoom,
    maxzoom: basemap.maxZoom,
    attribution: basemap.attribution,
    ...(source.kind === "pmtiles" ? { url: source.url } : { tiles: [source.url] }),
  };

  /**
   * Só rótulo e fronteira sobrevivem por cima da imagem. Preenchimento de país e
   * cor de oceano tapariam justamente o que a imagem tem a dizer.
   */
  const detailedLabels = options.labels ? options.labelsBasemap : undefined;
  const overlays =
    detailedLabels !== undefined
      ? (protomapsLayers(DETAILED_SOURCE_ID, namedFlavor("light"), {
          labelsOnly: true,
          lang: "en",
        }) as unknown as LayerSpecification[])
      : options.labels
        ? layers(palette).filter((layer) =>
            ["country-borders", "country-labels", "cities", "city-labels"].includes(layer.id),
          )
        : [];

  const overlaySources =
    detailedLabels !== undefined
      ? {
          [DETAILED_SOURCE_ID]: {
            type: "vector" as const,
            url: detailedBasemapSourceUrl(detailedLabels),
            minzoom: detailedLabels.minZoom,
            maxzoom: detailedLabels.maxZoom,
            attribution: detailedLabels.attribution,
          },
        }
      : options.labels
        ? {
            "natural-earth": {
              type: "vector" as const,
              url: BASEMAP_URL,
              attribution: "Natural Earth · domínio público",
            },
            places: { type: "geojson" as const, data: PLACES_URL },
          }
        : {};

  return {
    version: 8,
    name: `${basemap.label}${options.labels ? " com rótulos" : ""}`,
    glyphs: GLYPHS_URL,
    ...(detailedLabels === undefined ? {} : { sprite: PROTOMAPS_SPRITE_URL }),
    sources: {
      satellite: raster,
      ...overlaySources,
    },
    layers: [
      // Fundo escuro por baixo: enquanto um tile não chega, buraco preto é menos
      // ruim que o cinza padrão do MapLibre, que parece terreno.
      { id: "void", type: "background", paint: { "background-color": "#05070a" } },
      {
        id: SATELLITE_LAYER_ID,
        type: "raster",
        source: "satellite",
        paint: { "raster-opacity": options.opacity ?? 1 },
      },
      ...overlays,
    ],
  };
}

/** Id da camada raster, para animar a opacidade sem recriar o estilo. */
export const SATELLITE_LAYER_ID = "satellite-imagery";
