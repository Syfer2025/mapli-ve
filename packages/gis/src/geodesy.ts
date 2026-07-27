import { clamp, normalizeDegrees, toDegrees, toRadians } from "@theatrum/core-math";
import { shortestLongitudeDelta, wrapLongitude } from "./mercator.js";
import type { LngLat } from "./types.js";

/** Raio terrestre médio IUGG, apropriado a distâncias esféricas globais. */
export const EARTH_MEAN_RADIUS_METERS = 6_371_008.8;

export function geodesicDistance(a: LngLat, b: LngLat): number {
  const latitudeA = toRadians(a[1]);
  const latitudeB = toRadians(b[1]);
  const deltaLatitude = latitudeB - latitudeA;
  const deltaLongitude = toRadians(shortestLongitudeDelta(a[0], b[0]));

  const sinLatitude = Math.sin(deltaLatitude / 2);
  const sinLongitude = Math.sin(deltaLongitude / 2);
  const haversine =
    sinLatitude * sinLatitude +
    Math.cos(latitudeA) * Math.cos(latitudeB) * sinLongitude * sinLongitude;

  return 2 * EARTH_MEAN_RADIUS_METERS * Math.asin(Math.sqrt(clamp(haversine, 0, 1)));
}

/**
 * Bearing inicial em graus, no sentido horário a partir do norte.
 * Pontos coincidentes têm bearing convencional igual a zero.
 */
export function initialBearing(a: LngLat, b: LngLat): number {
  if (a[0] === b[0] && a[1] === b[1]) return 0;

  const latitudeA = toRadians(a[1]);
  const latitudeB = toRadians(b[1]);
  const deltaLongitude = toRadians(shortestLongitudeDelta(a[0], b[0]));
  const y = Math.sin(deltaLongitude) * Math.cos(latitudeB);
  const x =
    Math.cos(latitudeA) * Math.sin(latitudeB) -
    Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(deltaLongitude);
  return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

export function destinationPoint(from: LngLat, bearing: number, meters: number): LngLat {
  const angularDistance = meters / EARTH_MEAN_RADIUS_METERS;
  const bearingRadians = toRadians(bearing);
  const latitude = toRadians(from[1]);
  const longitude = toRadians(from[0]);

  const destinationLatitude = Math.asin(
    clamp(
      Math.sin(latitude) * Math.cos(angularDistance) +
        Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearingRadians),
      -1,
      1,
    ),
  );
  const destinationLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
    );

  return [wrapLongitude(toDegrees(destinationLongitude)), toDegrees(destinationLatitude)];
}

type Cartesian = readonly [number, number, number];

function toCartesian(lngLat: LngLat): Cartesian {
  const longitude = toRadians(lngLat[0]);
  const latitude = toRadians(lngLat[1]);
  const cosLatitude = Math.cos(latitude);
  return [cosLatitude * Math.cos(longitude), cosLatitude * Math.sin(longitude), Math.sin(latitude)];
}

function normalizeCartesian(value: Cartesian): Cartesian {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) return [1, 0, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function cross(a: Cartesian, b: Cartesian): Cartesian {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Perpendicular estável para o caso exatamente antipodal. */
function deterministicPerpendicular(vector: Cartesian): Cartesian {
  const axis: Cartesian =
    Math.abs(vector[0]) <= Math.abs(vector[1]) && Math.abs(vector[0]) <= Math.abs(vector[2])
      ? [1, 0, 0]
      : Math.abs(vector[1]) <= Math.abs(vector[2])
        ? [0, 1, 0]
        : [0, 0, 1];
  return normalizeCartesian(cross(axis, vector));
}

function fromCartesian(value: Cartesian): LngLat {
  const normalized = normalizeCartesian(value);
  return [
    wrapLongitude(toDegrees(Math.atan2(normalized[1], normalized[0]))),
    toDegrees(Math.atan2(normalized[2], Math.hypot(normalized[0], normalized[1]))),
  ];
}

/**
 * Interpolação esférica pelo arco menor.
 *
 * Para antípodas exatos existem infinitos arcos equivalentes; escolhemos um
 * plano determinístico para que export e preview produzam o mesmo resultado.
 */
export function greatCircleInterpolate(a: LngLat, b: LngLat, t: number): LngLat {
  if (t === 0) return a;
  if (t === 1) return b;

  const from = toCartesian(a);
  const to = toCartesian(b);
  const dot = clamp(from[0] * to[0] + from[1] * to[1] + from[2] * to[2], -1, 1);
  // atan2(sin θ, cos θ) preserva ângulos pequenos; acos(dot) perde vários
  // dígitos quando dot arredonda para quase 1.
  const crossLength = Math.hypot(...cross(from, to));
  const angle = Math.atan2(crossLength, dot);

  if (angle < 1e-12) {
    return fromCartesian([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ]);
  }

  const tangentCandidate: Cartesian = [
    to[0] - dot * from[0],
    to[1] - dot * from[1],
    to[2] - dot * from[2],
  ];
  const tangentLength = Math.hypot(...tangentCandidate);
  const tangent =
    tangentLength < 1e-12
      ? deterministicPerpendicular(from)
      : ([
          tangentCandidate[0] / tangentLength,
          tangentCandidate[1] / tangentLength,
          tangentCandidate[2] / tangentLength,
        ] as const);

  const along = angle * t;
  return fromCartesian([
    Math.cos(along) * from[0] + Math.sin(along) * tangent[0],
    Math.cos(along) * from[1] + Math.sin(along) * tangent[1],
    Math.cos(along) * from[2] + Math.sin(along) * tangent[2],
  ]);
}
