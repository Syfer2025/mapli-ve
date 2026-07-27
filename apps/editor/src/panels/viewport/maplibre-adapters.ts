import {
  type CameraApplyMode,
  type CameraPort,
  type CameraState,
  normalizeBearing,
  normalizeCameraState,
} from "@theatrum/camera";
import {
  DEFAULT_TILE_SIZE,
  type LngLat,
  type ProjectorPort,
  type ProjectorSnapshot,
  type ScreenPoint,
  mercatorMetersPerPixel,
} from "@theatrum/gis";

/** Ponto devolvido por `map.project()`. */
export interface MapLibrePointLike {
  readonly x: number;
  readonly y: number;
}

/** Coordenada devolvida por `map.getCenter()` e `map.unproject()`. */
export interface MapLibreLngLatLike {
  readonly lng: number;
  readonly lat: number;
}

/** Dimensões CSS usadas pelo transform do mapa. */
export interface MapLibreCanvasLike {
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** Tupla mutável aceita diretamente pelo `LngLatLike`/`PointLike` do MapLibre. */
export type MapLibreCoordinateLike = [number, number];

/** Subconjunto das opções de câmera compartilhado por `jumpTo` e `easeTo`. */
export interface MapLibreCameraOptionsLike {
  readonly center: MapLibreCoordinateLike;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

/**
 * Superfície estrutural consumida pelos adapters.
 *
 * O tipo não importa `maplibre-gl`: o editor pode passar um `Map` real, e os
 * testes usam um double pequeno com a mesma forma.
 */
export interface MapLibreLike {
  project(lngLat: MapLibreCoordinateLike, altitude?: number): MapLibrePointLike;
  unproject(point: MapLibreCoordinateLike): MapLibreLngLatLike;
  getCenter(): MapLibreLngLatLike;
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  getCanvas(): MapLibreCanvasLike;
  jumpTo(options: MapLibreCameraOptionsLike): unknown;
  easeTo(options: MapLibreCameraOptionsLike): unknown;
  loaded(): boolean;
  areTilesLoaded(): boolean;
  isMoving(): boolean;
  on(type: "idle" | "error", listener: () => void): unknown;
  off(type: "idle" | "error", listener: () => void): unknown;
  queryTerrainElevation?(lngLat: MapLibreCoordinateLike): number | null | undefined;
}

/** Configuração fixa do projetor associada ao mapa. */
export interface MapLibreProjectorOptions {
  readonly tileSize?: number;
}

function frozenPoint(x: number, y: number): readonly [number, number] {
  const point: [number, number] = [x, y];
  return Object.freeze(point);
}

function mapCoordinate(x: number, y: number): MapLibreCoordinateLike {
  return [x, y];
}

function cameraStateFromMap(map: MapLibreLike): CameraState {
  const center = map.getCenter();
  return normalizeCameraState({
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  });
}

function cameraOptions(state: CameraState): MapLibreCameraOptionsLike {
  const canonical = normalizeCameraState(state);
  return {
    center: mapCoordinate(canonical.center[0], canonical.center[1]),
    zoom: canonical.zoom,
    bearing: canonical.bearing,
    pitch: canonical.pitch,
  };
}

/**
 * Cria o único caminho de projeção do viewport.
 *
 * `project` e `unproject` delegam ao transform vivo do mapa, inclusive com
 * pitch. O snapshot copia e congela somente os dados necessários ao export.
 */
export function createMapLibreProjectorPort(
  map: MapLibreLike,
  options: MapLibreProjectorOptions = {},
): ProjectorPort {
  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new RangeError("tileSize precisa ser finito e positivo");
  }

  return {
    project(lngLat: LngLat, altitude?: number): ScreenPoint {
      const projected = map.project(mapCoordinate(lngLat[0], lngLat[1]), altitude);
      return [projected.x, projected.y];
    },

    unproject(point: ScreenPoint): LngLat {
      const unprojected = map.unproject(mapCoordinate(point[0], point[1]));
      return [unprojected.lng, unprojected.lat];
    },

    metersPerPixel(atLat: number): number {
      return mercatorMetersPerPixel(atLat, map.getZoom(), tileSize);
    },

    bearingToScreenAngle(bearing: number): number {
      return normalizeBearing(bearing - map.getBearing());
    },

    elevationAt(lngLat: LngLat): number | null {
      return map.queryTerrainElevation?.(mapCoordinate(lngLat[0], lngLat[1])) ?? null;
    },

    snapshot(): ProjectorSnapshot {
      const state = cameraStateFromMap(map);
      const canvas = map.getCanvas();
      if (
        !Number.isFinite(canvas.clientWidth) ||
        !Number.isFinite(canvas.clientHeight) ||
        canvas.clientWidth <= 0 ||
        canvas.clientHeight <= 0
      ) {
        throw new RangeError("viewport precisa ter dimensões finitas e positivas");
      }

      return Object.freeze({
        projection: "mercator",
        center: frozenPoint(state.center[0], state.center[1]),
        zoom: state.zoom,
        bearing: state.bearing,
        pitch: state.pitch,
        viewport: frozenPoint(canvas.clientWidth, canvas.clientHeight),
        tileSize,
      });
    },
  };
}

/**
 * Cria a fronteira de câmera sobre `jumpTo`/`easeTo` e o evento `idle`.
 *
 * `isSettled` cobre o caminho síncrono; `onSettled` usa `idle`, que o MapLibre
 * emite apenas sem movimento e depois de carregar os recursos da vista.
 */
export function createMapLibreCameraPort(map: MapLibreLike): CameraPort {
  return {
    apply(state: CameraState, mode: CameraApplyMode): void {
      const options = cameraOptions(state);
      if (mode === "jump") {
        map.jumpTo(options);
      } else {
        map.easeTo(options);
      }
    },

    current(): CameraState {
      return cameraStateFromMap(map);
    },

    isSettled(): boolean {
      return map.loaded() && map.areTilesLoaded() && !map.isMoving();
    },

    onSettled(listener: () => void): { dispose(): void } {
      let isActive = true;
      let hadResourceError = false;
      const onError = (): void => {
        hadResourceError = true;
      };
      const onIdle = (): void => {
        if (!hadResourceError) listener();
      };

      map.on("error", onError);
      map.on("idle", onIdle);
      return {
        dispose(): void {
          if (!isActive) return;
          isActive = false;
          map.off("idle", onIdle);
          map.off("error", onError);
        },
      };
    },
  };
}
