import { clamp } from "@theatrum/core-math";
import {
  DEFAULT_TILE_SIZE,
  MAX_MERCATOR_LATITUDE,
  webMercatorProject,
  webMercatorUnproject,
  wrapLongitude,
} from "./mercator.js";
import type { GeoBounds, LngLat, MercatorFit, MercatorFitOptions, ScreenPoint } from "./types.js";

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Extensão longitudinal em graus, respeitando bounds que cruzam ±180°. */
export function geoBoundsLongitudeSpan(bounds: GeoBounds): number {
  const rawSpan = bounds.east - bounds.west;
  if (Math.abs(rawSpan) >= 360) return 360;
  return positiveModulo(rawSpan, 360);
}

/**
 * Menor bounds longitudinal que contém os pontos.
 *
 * O algoritmo remove o maior vazio entre longitudes consecutivas; por isso
 * `[170, …]` e `[-170, …]` geram uma bounds curta que cruza o antimeridiano.
 */
export function geoBoundsFromPoints(points: readonly LngLat[]): GeoBounds | undefined {
  if (points.length === 0) return undefined;

  let south = Infinity;
  let north = -Infinity;
  const longitudes: number[] = [];
  for (const point of points) {
    south = Math.min(south, point[1]);
    north = Math.max(north, point[1]);
    longitudes.push(positiveModulo(point[0], 360));
  }
  longitudes.sort((a, b) => a - b);

  if (longitudes.length === 1) {
    const longitude = wrapLongitude(longitudes[0] as number);
    return { west: longitude, south, east: longitude, north };
  }

  let largestGap = -1;
  let gapIndex = 0;
  for (let index = 0; index < longitudes.length; index++) {
    const current = longitudes[index] as number;
    const next =
      index === longitudes.length - 1
        ? (longitudes[0] as number) + 360
        : (longitudes[index + 1] as number);
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = index;
    }
  }

  const westIndex = (gapIndex + 1) % longitudes.length;
  const west = wrapLongitude(longitudes[westIndex] as number);
  const east = wrapLongitude(longitudes[gapIndex] as number);
  return { west, south, east, north };
}

export function geoBoundsContains(bounds: GeoBounds, point: LngLat): boolean {
  if (point[1] < bounds.south || point[1] > bounds.north) return false;
  const span = geoBoundsLongitudeSpan(bounds);
  if (span >= 360) return true;
  const fromWest = positiveModulo(wrapLongitude(point[0]) - wrapLongitude(bounds.west), 360);
  const longitudeTolerance = Number.EPSILON * 360 * 8;
  // A conversão 0..360 ↔ -180..180 pode deslocar a própria borda por alguns
  // ULPs. `fromWest ≈ 360` é, nesse caso, o mesmo que zero.
  return fromWest <= span + longitudeTolerance || 360 - fromWest <= longitudeTolerance;
}

export function geoBoundsCenter(bounds: GeoBounds): LngLat {
  const longitude = wrapLongitude(bounds.west + geoBoundsLongitudeSpan(bounds) / 2);
  return [longitude, (bounds.south + bounds.north) / 2];
}

function mercatorBoundsCenter(bounds: GeoBounds): LngLat {
  const longitude = wrapLongitude(bounds.west + geoBoundsLongitudeSpan(bounds) / 2);
  const north = clamp(bounds.north, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const south = clamp(bounds.south, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const northY = webMercatorProject([0, north])[1];
  const southY = webMercatorProject([0, south])[1];
  return [longitude, webMercatorUnproject([0, (northY + southY) / 2])[1]];
}

/**
 * Calcula centro/zoom para conter a bounds em um viewport Mercator sem pitch.
 *
 * O resultado é independente de UI e serve de núcleo matemático para
 * `camera.frameBounds`.
 */
export function fitMercatorBounds(
  bounds: GeoBounds,
  viewport: ScreenPoint,
  options: MercatorFitOptions = {},
): MercatorFit {
  const padding = options.padding ?? 0;
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxZoom ?? 24;
  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
  if (padding < 0) throw new RangeError("padding must not be negative");
  const availableWidth = viewport[0] - padding * 2;
  const availableHeight = viewport[1] - padding * 2;

  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new RangeError("padding must leave a positive viewport");
  }
  if (tileSize <= 0) throw new RangeError("tileSize must be positive");
  if (minZoom > maxZoom) throw new RangeError("minZoom must not exceed maxZoom");
  if (bounds.south > bounds.north) throw new RangeError("south must not exceed north");

  const longitudeSpan = geoBoundsLongitudeSpan(bounds) / 360;
  const clampedNorth = clamp(bounds.north, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const clampedSouth = clamp(bounds.south, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const northY = webMercatorProject([0, clampedNorth])[1];
  const southY = webMercatorProject([0, clampedSouth])[1];
  const latitudeSpan = Math.abs(southY - northY);

  const horizontalScale =
    longitudeSpan === 0 ? Infinity : availableWidth / (tileSize * longitudeSpan);
  const verticalScale = latitudeSpan === 0 ? Infinity : availableHeight / (tileSize * latitudeSpan);
  const limitingScale = Math.min(horizontalScale, verticalScale);
  const unclampedZoom = Number.isFinite(limitingScale) ? Math.log2(limitingScale) : maxZoom;

  return {
    center: mercatorBoundsCenter(bounds),
    zoom: clamp(unclampedZoom, minZoom, maxZoom),
  };
}
