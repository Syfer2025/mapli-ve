import { normalizeDegrees, toRadians } from "@theatrum/core-math";
import {
  DEFAULT_TILE_SIZE,
  mercatorMetersPerPixel,
  mercatorWorldSize,
  webMercatorProject,
  webMercatorUnproject,
  wrapLongitude,
} from "./mercator.js";
import type { LngLat, ProjectorPort, ProjectorSnapshot, ScreenPoint } from "./types.js";

export interface FlatMercatorProjectorOptions {
  readonly center: LngLat;
  readonly zoom: number;
  readonly viewport: ScreenPoint;
  readonly bearing?: number;
  readonly tileSize?: number;
}

function frozenPoint(point: readonly [number, number]): readonly [number, number] {
  return Object.freeze([point[0], point[1]]);
}

/**
 * Projetor analítico para testes, miniaturas e cálculos sem um mapa vivo.
 *
 * Ele modela Web Mercator, zoom, world-wrap e bearing em pitch zero. A versão
 * de produção continua sendo um adapter de `map.project()`/`map.unproject()`.
 */
export class FlatMercatorProjector implements ProjectorPort {
  readonly #state: ProjectorSnapshot;

  constructor(options: FlatMercatorProjectorOptions) {
    const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
    if (options.viewport[0] <= 0 || options.viewport[1] <= 0) {
      throw new RangeError("viewport dimensions must be positive");
    }
    if (tileSize <= 0) throw new RangeError("tileSize must be positive");

    this.#state = Object.freeze({
      projection: "mercator",
      center: frozenPoint(options.center),
      zoom: options.zoom,
      bearing: normalizeDegrees(options.bearing ?? 0),
      pitch: 0,
      viewport: frozenPoint(options.viewport),
      tileSize,
    });
  }

  project(lngLat: LngLat, altitude = 0): ScreenPoint {
    const center = webMercatorProject(this.#state.center);
    const target = webMercatorProject(lngLat);
    const worldSize = mercatorWorldSize(this.#state.zoom, this.#state.tileSize);
    let deltaX = target[0] - center[0];
    // O mundo mais próximo evita que 179° e -179° fiquem uma tela inteira longe.
    deltaX -= Math.round(deltaX);
    const worldX = deltaX * worldSize;
    const worldY = (target[1] - center[1]) * worldSize;
    const rotation = toRadians(-this.#state.bearing);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const rotatedX = worldX * cosine - worldY * sine;
    const rotatedY = worldX * sine + worldY * cosine;
    const altitudePixels = altitude / this.metersPerPixel(lngLat[1]);
    return [
      this.#state.viewport[0] / 2 + rotatedX,
      this.#state.viewport[1] / 2 + rotatedY - altitudePixels,
    ];
  }

  unproject(point: ScreenPoint): LngLat {
    const screenX = point[0] - this.#state.viewport[0] / 2;
    const screenY = point[1] - this.#state.viewport[1] / 2;
    const rotation = toRadians(this.#state.bearing);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const worldX = screenX * cosine - screenY * sine;
    const worldY = screenX * sine + screenY * cosine;
    const worldSize = mercatorWorldSize(this.#state.zoom, this.#state.tileSize);
    const center = webMercatorProject(this.#state.center);
    const unprojected = webMercatorUnproject([
      center[0] + worldX / worldSize,
      center[1] + worldY / worldSize,
    ]);
    return [wrapLongitude(unprojected[0]), unprojected[1]];
  }

  metersPerPixel(atLat: number): number {
    return mercatorMetersPerPixel(atLat, this.#state.zoom, this.#state.tileSize);
  }

  bearingToScreenAngle(bearing: number): number {
    return normalizeDegrees(bearing - this.#state.bearing);
  }

  elevationAt(_lngLat: LngLat): number | null {
    return null;
  }

  snapshot(): ProjectorSnapshot {
    return this.#state;
  }
}

export function createFlatMercatorProjector(
  options: FlatMercatorProjectorOptions,
): FlatMercatorProjector {
  return new FlatMercatorProjector(options);
}

export function projectorFromSnapshot(snapshot: ProjectorSnapshot): FlatMercatorProjector {
  if (snapshot.projection !== "mercator" || snapshot.pitch !== 0) {
    throw new RangeError("flat projector only supports Mercator snapshots at pitch zero");
  }
  return new FlatMercatorProjector(snapshot);
}
