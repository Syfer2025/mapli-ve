import type { Vec2 } from "@theatrum/core-math";

/** Coordenada geográfica em graus, sempre na ordem `[longitude, latitude]`. */
export type LngLat = Vec2;

/** Coordenada em pixels de tela, na ordem `[x, y]`. */
export type ScreenPoint = Vec2;

/** Coordenada Web Mercator normalizada; o mundo ocupa `[0, 1] × [0, 1]`. */
export type MercatorPoint = Vec2;

/**
 * Estado mínimo necessário para reconstruir um projetor Mercator plano.
 *
 * É deliberadamente composto apenas por dados: pode ser congelado, serializado e
 * guardado junto do frame sem carregar uma referência viva para o mapa.
 */
export interface ProjectorSnapshot {
  readonly projection: "mercator";
  readonly center: LngLat;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
  readonly viewport: ScreenPoint;
  readonly tileSize: number;
}

/**
 * Única fronteira pela qual os demais módulos convertem geografia em tela.
 *
 * A implementação de runtime deve delegar `project` e `unproject` ao transform do
 * MapLibre. `FlatMercatorProjector` existe para testes e cálculos sem DOM.
 */
export interface ProjectorPort {
  project(lngLat: LngLat, altitude?: number): ScreenPoint;
  unproject(point: ScreenPoint): LngLat;
  metersPerPixel(atLat: number): number;
  bearingToScreenAngle(bearing: number): number;
  elevationAt(lngLat: LngLat): number | null;
  snapshot(): ProjectorSnapshot;
}

export interface TileSourcePort {
  readonly id: string;
  readonly kind: "vector" | "raster" | "terrain";
  url(): string;
}

/**
 * `east < west` representa uma extensão que cruza o antimeridiano.
 * Uma diferença longitude leste-oeste de 360° representa o mundo inteiro.
 */
export interface GeoBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface MercatorFit {
  readonly center: LngLat;
  readonly zoom: number;
}

export interface MercatorFitOptions {
  readonly padding?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly tileSize?: number;
}

export type PlaceKind =
  | "country"
  | "region"
  | "admin-1"
  | "capital"
  | "city"
  | "town"
  | "village"
  | "settlement"
  | "landmark"
  | "water";

/** Registro de entrada, independente do formato do dataset que o alimenta. */
export interface GazetteerPlace {
  readonly id: string;
  readonly name: string;
  /** Código ISO 3166-1 alpha-2, como `RU` ou `US`. */
  readonly country: string;
  readonly kind: PlaceKind;
  readonly lngLat: LngLat;
  readonly admin1?: string;
  readonly population?: number;
  readonly aliases?: readonly string[];
  readonly countryAliases?: readonly string[];
  readonly admin1Aliases?: readonly string[];
}

export interface GazetteerHit {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly kind: PlaceKind;
  readonly lngLat: LngLat;
  readonly admin1?: string;
  readonly population?: number;
  /** Qualidade do casamento no intervalo `[0, 1]`. */
  readonly score: number;
}

export interface GazetteerPort {
  resolve(query: string): Promise<readonly GazetteerHit[]>;
  /**
   * Devolve um resultado apenas quando a consulta exata identifica um único
   * lugar. Consultas exatas ambíguas, como `Springfield`, devolvem `undefined`.
   */
  resolveExact(query: string): GazetteerHit | undefined;
}

export type GazetteerResolution =
  | {
      readonly status: "resolved";
      readonly query: string;
      readonly hit: GazetteerHit;
    }
  | {
      readonly status: "ambiguous";
      readonly query: string;
      readonly hits: readonly GazetteerHit[];
    }
  | {
      readonly status: "not-found";
      readonly query: string;
      readonly hits: readonly [];
    };
