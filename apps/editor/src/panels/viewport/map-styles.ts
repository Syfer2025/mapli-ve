import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import { DATA_BASE_URL } from "@theatrum/shell";
import type {
  FilterSpecification,
  LayerSpecification,
  RasterSourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { detailedBasemapSourceUrl, type DetailedBasemap } from "./detailed-basemap.js";
import { rasterSourceUrl, type RasterBasemap } from "./raster-basemap.js";

export type MapStyleId = "dark-relief" | "historical-parchment" | "minimal-political";

export interface MapStyleOption {
  readonly id: MapStyleId;
  readonly label: string;
}

const MAP_STYLE_LABELS: Readonly<Record<MapStyleId, string>> = {
  "dark-relief": "Relevo escuro",
  "historical-parchment": "Pergaminho histórico",
  "minimal-political": "Político minimalista",
};

export const MAP_STYLE_OPTIONS: readonly MapStyleOption[] = [
  { id: "dark-relief", label: MAP_STYLE_LABELS["dark-relief"] },
  { id: "historical-parchment", label: MAP_STYLE_LABELS["historical-parchment"] },
  { id: "minimal-political", label: MAP_STYLE_LABELS["minimal-political"] },
];

const BASEMAP_URL = `pmtiles://${DATA_BASE_URL}/basemap/natural-earth-world.pmtiles`;
const PLACES_URL = `${DATA_BASE_URL}/natural-earth/ne_10m_populated_places_simple.geojson`;
const LAKES_URL = `${DATA_BASE_URL}/natural-earth/ne_110m_lakes.geojson`;
const RIVERS_URL = `${DATA_BASE_URL}/natural-earth/ne_110m_rivers_lake_centerlines.geojson`;
const GLYPHS_URL = `${DATA_BASE_URL}/glyphs/{fontstack}/{range}.pbf`;
const PROTOMAPS_SPRITE_URL = `${DATA_BASE_URL}/sprites/protomaps-light`;
const UKRAINE_SPRITE_URL = `${DATA_BASE_URL}/sprites/theatrum-ukraine`;
const DETAILED_SOURCE_ID = "regional-detail";
const UKRAINE_FRONTLINE_SOURCE_ID = "ukraine-frontline-2026-07-30";
const UKRAINE_FRONTLINE_URL = `${DATA_BASE_URL}/frontlines/ukraine-liveuamap-2026-07-30-z9.geojson`;
const UKRAINE_POLITICAL_SOURCE_ID = "ukraine-political-control-2026-07-30";
const UKRAINE_POLITICAL_URL = `${DATA_BASE_URL}/territories/ukraine-political-control-2026-07-30.geojson`;
export const UKRAINE_WAR_TIMELINE_SOURCE_ID = "ukraine-war-timeline-2022-2026";
const UKRAINE_WAR_TIMELINE_URL = `${DATA_BASE_URL}/territories/ukraine-war-timeline-2022-2026.geojson`;
export const UKRAINE_WAR_TIMELINE_FRAME_STEP = 2;
export const UKRAINE_WAR_TIMELINE_FINAL_STATE_FRAME = 570;
export const UKRAINE_WAR_TIMELINE_LAST_FRAME = 599;

export type DetailedPoiMode = "strategic" | "all" | "hidden";

export interface DetailedPoiModeOption {
  readonly id: DetailedPoiMode;
  readonly label: string;
}

export const DEFAULT_DETAILED_POI_MODE: DetailedPoiMode = "strategic";

export const DETAILED_POI_MODE_OPTIONS: readonly DetailedPoiModeOption[] = Object.freeze([
  { id: "strategic", label: "Estratégicos" },
  { id: "all", label: "Todos" },
  { id: "hidden", label: "Ocultos" },
]);

/**
 * Categorias que ajudam a ler infraestrutura crítica sem poluir o mapa com
 * alimentação, comércio e lazer. O PMTiles preserva todas as outras feições:
 * trocar o modo para `all` apenas restaura o filtro cartográfico original.
 */
export const STRATEGIC_POI_KINDS: readonly string[] = Object.freeze([
  "aerodrome",
  "airport",
  "airfield",
  "heliport",
  "helipad",
  "townhall",
  "government",
  "government_office",
  "public_service",
  "courthouse",
  "embassy",
  "consulate",
  "police",
  "fire_station",
  "military",
  "barracks",
  "naval_base",
  "air_force",
  "fuel",
  "gas",
  "oil",
  "oil_well",
  "gas_well",
  "petroleum",
  "refinery",
  "pipeline",
  "power_plant",
  "power_station",
  "substation",
  "station",
  "ferry_terminal",
  "port",
  "harbour",
  "hospital",
]);

const STRATEGIC_POI_FILTER: FilterSpecification = [
  "all",
  ["in", ["get", "kind"], ["literal", STRATEGIC_POI_KINDS]],
  [">=", ["zoom"], ["+", ["get", "min_zoom"], 0]],
];

function configureDetailedPoiLayers(
  layers: readonly LayerSpecification[],
  mode: DetailedPoiMode,
): LayerSpecification[] {
  return layers.map((layer) => {
    if (layer.id !== "pois" || layer.type !== "symbol") return layer;
    if (mode === "all") return layer;
    if (mode === "hidden") {
      return {
        ...layer,
        layout: { ...layer.layout, visibility: "none" },
      };
    }
    return {
      ...layer,
      filter: structuredClone(STRATEGIC_POI_FILTER),
      layout: {
        ...layer.layout,
        "icon-image": [
          "match",
          ["get", "kind"],
          "aerodrome",
          "aerodrome",
          "airport",
          "aerodrome",
          "airfield",
          "aerodrome",
          "station",
          "train_station",
          "ferry_terminal",
          "ferry_terminal",
          "building",
        ],
      },
      paint: {
        ...layer.paint,
        "text-color": "#6f2430",
      },
    };
  });
}

const UKRAINE_MAJOR_CITY_NAMES: readonly string[] = Object.freeze([
  "Kyiv",
  "Kharkiv",
  "Odesa",
  "Dnipro",
  "Donetsk",
  "Zaporizhzhia",
  "Lviv",
  "Kryvyi Rih",
  "Mykolaiv",
  "Mariupol",
  "Luhansk",
  "Vinnytsia",
  "Kherson",
  "Poltava",
  "Chernihiv",
  "Sumy",
  "Sevastopol",
  "Simferopol",
]);

const UKRAINE_MAJOR_LOCALITY_FILTER: FilterSpecification = [
  "all",
  ["==", ["get", "kind"], "locality"],
  ["in", ["get", "name:en"], ["literal", UKRAINE_MAJOR_CITY_NAMES]],
];

/**
 * Mantém estados/províncias e as cidades de maior hierarquia, mas remove
 * bairros, distritos e localidades menores em qualquer nível de zoom.
 */
function configureDetailedPlaceLayers(
  layers: readonly LayerSpecification[],
  majorCitiesOnly: boolean,
): LayerSpecification[] {
  if (!majorCitiesOnly) return [...layers];
  return layers.map((layer) => {
    if (layer.id === "places_subplace" && layer.type === "symbol") {
      return {
        ...layer,
        layout: { ...layer.layout, visibility: "none" },
      };
    }
    if (layer.id === "places_locality" && layer.type === "symbol") {
      return {
        ...layer,
        filter: structuredClone(UKRAINE_MAJOR_LOCALITY_FILTER),
      };
    }
    return layer;
  });
}

function detailedLayers(
  poiMode: DetailedPoiMode,
  options: {
    readonly labelsOnly?: boolean;
    readonly majorCitiesOnly?: boolean;
  } = {},
): LayerSpecification[] {
  const { majorCitiesOnly = false, ...layerOptions } = options;
  return configureDetailedPlaceLayers(
    configureDetailedPoiLayers(
      protomapsLayers(DETAILED_SOURCE_ID, namedFlavor("light"), {
        ...layerOptions,
        lang: "pt",
      }) as unknown as LayerSpecification[],
      poiMode,
    ),
    majorCitiesOnly,
  );
}

function ukraineFrontlineLayers(): LayerSpecification[] {
  return [
    {
      id: "ukraine-frontline-casing",
      type: "line",
      source: UKRAINE_FRONTLINE_SOURCE_ID,
      minzoom: 4,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#5c1018",
        "line-opacity": 0,
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 3, 8, 4, 12, 5.5, 15, 7],
        "line-blur": 0.25,
      },
    },
    {
      id: "ukraine-frontline",
      type: "line",
      source: UKRAINE_FRONTLINE_SOURCE_ID,
      minzoom: 4,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#d71920",
        "line-opacity": 0,
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.6, 8, 2.4, 12, 3.5, 15, 4.5],
      },
    },
  ];
}

function ukrainePoliticalFillLayers(): LayerSpecification[] {
  return [
    {
      id: "ukraine-russia-fill",
      type: "fill",
      source: UKRAINE_POLITICAL_SOURCE_ID,
      filter: ["all", ["==", ["get", "kind"], "country"], ["==", ["get", "code"], "RUS"]],
      paint: {
        "fill-color": "#ef9999",
        "fill-opacity": 0.72,
      },
    },
    {
      id: "ukraine-national-fill",
      type: "fill",
      source: UKRAINE_POLITICAL_SOURCE_ID,
      filter: ["all", ["==", ["get", "kind"], "country"], ["==", ["get", "code"], "UKR"]],
      paint: {
        "fill-color": "#f8e69a",
        "fill-opacity": 0.74,
      },
    },
    {
      id: "ukraine-invaded-regions-fill",
      type: "fill",
      source: UKRAINE_POLITICAL_SOURCE_ID,
      filter: ["==", ["get", "kind"], "invaded_region"],
      paint: {
        "fill-color": "#e58f92",
        "fill-opacity": 1,
        "fill-outline-color": "#a84f58",
      },
    },
    {
      id: "ukraine-occupied-fill",
      type: "fill",
      source: UKRAINE_WAR_TIMELINE_SOURCE_ID,
      filter: [
        "all",
        ["==", ["get", "kind"], "occupied_timeline"],
        ["==", ["get", "frame"], 0],
      ],
      paint: {
        "fill-color": "#d64c54",
        "fill-opacity": 0.78,
        "fill-outline-color": "#a62a32",
      },
    },
    {
      id: "ukraine-occupied-stripes",
      type: "fill",
      source: UKRAINE_WAR_TIMELINE_SOURCE_ID,
      filter: [
        "all",
        ["==", ["get", "kind"], "occupied_timeline"],
        ["==", ["get", "frame"], 0],
      ],
      paint: {
        "fill-pattern": "occupation-stripes",
        "fill-opacity": 0.88,
      },
    },
  ];
}

function ukraineFlagLayers(): LayerSpecification[] {
  return [
    {
      id: "ukraine-country-flags",
      type: "symbol",
      source: UKRAINE_POLITICAL_SOURCE_ID,
      filter: ["==", ["get", "kind"], "flag"],
      minzoom: 4,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.88, 8, 1.05, 12, 1.24],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
  ];
}

function insertBeforeLabels(
  layers: readonly LayerSpecification[],
  overlay: readonly LayerSpecification[],
): LayerSpecification[] {
  const firstSymbol = layers.findIndex((layer) => layer.type === "symbol");
  if (firstSymbol < 0) return [...layers, ...overlay];
  return [...layers.slice(0, firstSymbol), ...overlay, ...layers.slice(firstSymbol)];
}

function insertBeforeLayer(
  layers: readonly LayerSpecification[],
  overlay: readonly LayerSpecification[],
  beforeLayerId: string,
): LayerSpecification[] {
  const index = layers.findIndex((layer) => layer.id === beforeLayerId);
  if (index < 0) return [...layers, ...overlay];
  return [...layers.slice(0, index), ...overlay, ...layers.slice(index)];
}

function detailedSources(basemap: DetailedBasemap) {
  return {
    [DETAILED_SOURCE_ID]: {
      type: "vector" as const,
      url: detailedBasemapSourceUrl(basemap),
      minzoom: basemap.minZoom,
      maxzoom: basemap.maxZoom,
      attribution: basemap.attribution,
    },
    ...(basemap.id === "ukraine"
      ? {
          [UKRAINE_FRONTLINE_SOURCE_ID]: {
            type: "geojson" as const,
            data: UKRAINE_FRONTLINE_URL,
            attribution:
              'Linha de frente aproximada, recorte de 30/07/2026 baseado em <a href="https://liveuamap.com/">Liveuamap</a>',
          },
          [UKRAINE_POLITICAL_SOURCE_ID]: {
            type: "geojson" as const,
            data: UKRAINE_POLITICAL_URL,
            attribution:
              'Controle territorial aproximado de 30/07/2026 baseado em <a href="https://liveuamap.com/">Liveuamap</a> · limites administrativos do Natural Earth',
          },
          [UKRAINE_WAR_TIMELINE_SOURCE_ID]: {
            type: "geojson" as const,
            data: UKRAINE_WAR_TIMELINE_URL,
            attribution:
              'Progressão territorial histórica baseada nos mapas temporais do <a href="https://www.understandingwar.org/">Institute for the Study of War</a> · estado final baseado no Liveuamap',
          },
        }
      : {}),
  };
}

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
    layers: layers(palette),
  };
}

/**
 * Estilo urbano/regional baseado em OpenStreetMap.
 *
 * Diferente do bootstrap mundial z0–6, este tileset chega a z15 e inclui
 * províncias, cidades, ruas, edifícios, uso do solo, água e pontos de interesse.
 * Fonte, glifos e sprites continuam locais para o export ser reproduzível.
 */
export function createDetailedMapStyle(
  basemap: DetailedBasemap,
  options: { readonly poiMode?: DetailedPoiMode } = {},
): StyleSpecification {
  const poiMode = options.poiMode ?? DEFAULT_DETAILED_POI_MODE;
  const baseLayers = detailedLayers(poiMode, {
    majorCitiesOnly: basemap.id === "ukraine",
  });
  const regionalLayers =
    basemap.id === "ukraine"
      ? insertBeforeLayer(baseLayers, ukrainePoliticalFillLayers(), "roads_runway")
      : baseLayers;
  return {
    version: 8,
    name: basemap.label,
    glyphs: GLYPHS_URL,
    sprite: basemap.id === "ukraine" ? UKRAINE_SPRITE_URL : PROTOMAPS_SPRITE_URL,
    sources: detailedSources(basemap),
    layers:
      basemap.id === "ukraine"
        ? insertBeforeLabels(regionalLayers, [...ukraineFrontlineLayers(), ...ukraineFlagLayers()])
        : regionalLayers,
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
    readonly poiMode?: DetailedPoiMode;
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
      ? detailedLabels.id === "ukraine"
        ? insertBeforeLabels(
            detailedLayers(options.poiMode ?? DEFAULT_DETAILED_POI_MODE, {
              labelsOnly: true,
              majorCitiesOnly: true,
            }),
            ukraineFrontlineLayers(),
          )
        : detailedLayers(options.poiMode ?? DEFAULT_DETAILED_POI_MODE, {
            labelsOnly: true,
          })
      : options.labels
        ? layers(palette).filter((layer) =>
            ["country-borders", "country-labels", "cities", "city-labels"].includes(layer.id),
          )
        : [];

  const overlaySources =
    detailedLabels !== undefined
      ? detailedSources(detailedLabels)
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
