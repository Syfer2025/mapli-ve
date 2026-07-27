import { clamp, lerp, toDegrees, toRadians } from "@theatrum/core-math";
import type { LngLat, MercatorPoint, ScreenPoint } from "./types.js";

/** Raio usado pela projeção EPSG:3857. */
export const WEB_MERCATOR_RADIUS = 6_378_137;
export const WEB_MERCATOR_CIRCUMFERENCE = 2 * Math.PI * WEB_MERCATOR_RADIUS;
export const MAX_MERCATOR_LATITUDE = 85.0511287798066;
export const DEFAULT_TILE_SIZE = 512;

/** Normaliza longitude para o intervalo semiaberto `[-180, 180)`. */
export function wrapLongitude(longitude: number): number {
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/** Menor delta assinado de `from` para `to`, no intervalo `[-180, 180]`. */
export function shortestLongitudeDelta(from: number, to: number): number {
  const raw = to - from;
  const wrapped = wrapLongitude(raw);
  // Em pontos antipodais os dois caminhos têm o mesmo tamanho. Preservar o
  // sinal da entrada torna a escolha determinística e reversível.
  return wrapped === -180 && raw > 0 ? 180 : wrapped;
}

export function clampMercatorLatitude(latitude: number): number {
  return clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
}

/**
 * Projeta para coordenadas Web Mercator normalizadas.
 *
 * Longitude não é enrolada: `-180 → 0`, `180 → 1`, e mundos adjacentes continuam
 * representáveis. Latitude é limitada ao domínio finito da projeção.
 */
export function webMercatorProject(lngLat: LngLat): MercatorPoint {
  const longitude = lngLat[0];
  const latitude = clampMercatorLatitude(lngLat[1]);
  const sinLatitude = Math.sin(toRadians(latitude));
  const x = (longitude + 180) / 360;
  const y = 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI);
  return [x, y];
}

/** Inversa de `webMercatorProject`; aceita também coordenadas de mundos adjacentes. */
export function webMercatorUnproject(point: MercatorPoint): LngLat {
  const longitude = point[0] * 360 - 180;
  const latitude = toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * point[1]))));
  return [longitude, latitude];
}

export function mercatorWorldSize(zoom: number, tileSize = DEFAULT_TILE_SIZE): number {
  return tileSize * 2 ** zoom;
}

export function lngLatToWorldPixel(
  lngLat: LngLat,
  zoom: number,
  tileSize = DEFAULT_TILE_SIZE,
): ScreenPoint {
  const projected = webMercatorProject(lngLat);
  const worldSize = mercatorWorldSize(zoom, tileSize);
  return [projected[0] * worldSize, projected[1] * worldSize];
}

export function worldPixelToLngLat(
  point: ScreenPoint,
  zoom: number,
  tileSize = DEFAULT_TILE_SIZE,
): LngLat {
  const worldSize = mercatorWorldSize(zoom, tileSize);
  return webMercatorUnproject([point[0] / worldSize, point[1] / worldSize]);
}

/**
 * Resolução local da projeção em metros por pixel.
 *
 * Usa a mesma convenção de zoom do MapLibre: mundo com 512 px no zoom zero.
 */
export function mercatorMetersPerPixel(
  latitude: number,
  zoom: number,
  tileSize = DEFAULT_TILE_SIZE,
): number {
  const clampedLatitude = clampMercatorLatitude(latitude);
  return (
    (WEB_MERCATOR_CIRCUMFERENCE * Math.cos(toRadians(clampedLatitude))) /
    mercatorWorldSize(zoom, tileSize)
  );
}

/**
 * Interpolação retilínea em Web Mercator pelo caminho curto do antimeridiano.
 *
 * É o modelo apropriado a movimento terrestre; aeronaves e navios devem usar
 * `greatCircleInterpolate`.
 */
export function mercatorInterpolate(a: LngLat, b: LngLat, t: number): LngLat {
  if (t === 0) return a;
  if (t === 1) return b;

  const projectedA = webMercatorProject(a);
  const projectedB = webMercatorProject(b);
  const longitude = a[0] + shortestLongitudeDelta(a[0], b[0]) * t;
  const latitude = webMercatorUnproject([0, lerp(projectedA[1], projectedB[1], t)])[1];
  return [wrapLongitude(longitude), latitude];
}
