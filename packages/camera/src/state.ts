import { clamp, normalizeDegrees, type Vec2 } from "@theatrum/core-math";

/** Estado concreto da câmera, na mesma convenção geográfica do MapLibre. */
export interface CameraState {
  /** Centro em `[longitude, latitude]`, em graus. */
  readonly center: Vec2;
  /** Zoom logarítmico do MapLibre. */
  readonly zoom: number;
  /** Rotação em graus, com norte no topo em 0°. */
  readonly bearing: number;
  /** Inclinação em graus, com visão de topo em 0°. */
  readonly pitch: number;
}

/** Limites aplicados ao estado antes de avaliação ou envio ao runtime. */
export interface CameraConstraints {
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly minPitch: number;
  readonly maxPitch: number;
}

/** Latitude extrema representável pela projeção Web Mercator. */
export const MAX_MERCATOR_LATITUDE = 85.051_128_779_806_6;

/** Limites canônicos usados pelo mapa na Fase 2. */
export const DEFAULT_CAMERA_CONSTRAINTS: CameraConstraints = Object.freeze({
  minLatitude: -MAX_MERCATOR_LATITUDE,
  maxLatitude: MAX_MERCATOR_LATITUDE,
  minZoom: 0,
  maxZoom: 24,
  minPitch: 0,
  maxPitch: 85,
});

/** Estado inicial neutro da câmera. */
export const DEFAULT_CAMERA_STATE: CameraState = Object.freeze({
  center: Object.freeze([0, 0] satisfies Vec2),
  zoom: 0,
  bearing: 0,
  pitch: 0,
});

function requireFinite(label: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} precisa ser finito`);
  }
  return value;
}

function canonicalZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function validateRange(label: string, min: number, max: number): void {
  requireFinite(`${label}.min`, min);
  requireFinite(`${label}.max`, max);
  if (min > max) {
    throw new RangeError(`${label}.min não pode ser maior que ${label}.max`);
  }
}

function validateConstraints(constraints: CameraConstraints): void {
  validateRange("latitude", constraints.minLatitude, constraints.maxLatitude);
  validateRange("zoom", constraints.minZoom, constraints.maxZoom);
  validateRange("pitch", constraints.minPitch, constraints.maxPitch);
  if (constraints.minLatitude < -90 || constraints.maxLatitude > 90) {
    throw new RangeError("limites de latitude precisam ficar em [-90, 90]");
  }
}

/**
 * Normaliza longitude para o intervalo canônico `[-180, 180)`.
 *
 * `180` e `-180` representam o mesmo meridiano; a forma negativa é escolhida
 * para que estados equivalentes tenham uma única representação serializável.
 */
export function normalizeLongitude(longitude: number): number {
  const finite = requireFinite("longitude", longitude);
  return canonicalZero(normalizeDegrees(finite + 180) - 180);
}

/** Normaliza bearing para `[0, 360)`. */
export function normalizeBearing(bearing: number): number {
  return canonicalZero(normalizeDegrees(requireFinite("bearing", bearing)));
}

/** Limita latitude aos limites configurados. */
export function clampLatitude(
  latitude: number,
  constraints: CameraConstraints = DEFAULT_CAMERA_CONSTRAINTS,
): number {
  validateConstraints(constraints);
  return canonicalZero(
    clamp(requireFinite("latitude", latitude), constraints.minLatitude, constraints.maxLatitude),
  );
}

/**
 * Produz a representação canônica de um estado.
 *
 * Longitude e bearing dão a volta; latitude, zoom e pitch são limitados.
 * Valores não finitos representam bug de domínio e lançam `RangeError`.
 */
export function normalizeCameraState(
  state: CameraState,
  constraints: CameraConstraints = DEFAULT_CAMERA_CONSTRAINTS,
): CameraState {
  validateConstraints(constraints);
  return {
    center: [
      normalizeLongitude(state.center[0]),
      canonicalZero(
        clamp(
          requireFinite("latitude", state.center[1]),
          constraints.minLatitude,
          constraints.maxLatitude,
        ),
      ),
    ],
    zoom: canonicalZero(
      clamp(requireFinite("zoom", state.zoom), constraints.minZoom, constraints.maxZoom),
    ),
    bearing: normalizeBearing(state.bearing),
    pitch: canonicalZero(
      clamp(requireFinite("pitch", state.pitch), constraints.minPitch, constraints.maxPitch),
    ),
  };
}
