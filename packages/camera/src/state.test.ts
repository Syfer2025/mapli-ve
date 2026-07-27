import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_CONSTRAINTS,
  DEFAULT_CAMERA_STATE,
  MAX_MERCATOR_LATITUDE,
  type CameraConstraints,
  type CameraState,
  clampLatitude,
  normalizeBearing,
  normalizeCameraState,
  normalizeLongitude,
} from "./index.js";

const finite = fc.double({ min: -1e6, max: 1e6, noNaN: true });

const cameraStateArbitrary = fc.record({
  center: fc.tuple(finite, finite),
  zoom: finite,
  bearing: finite,
  pitch: finite,
});

describe("normalização geográfica", () => {
  it.each([
    [0, 0],
    [180, -180],
    [-180, -180],
    [181, -179],
    [-181, 179],
    [540, -180],
    [-540, -180],
    [360, 0],
    [-360, 0],
  ])("normaliza longitude %d para %d", (input, expected) => {
    expect(normalizeLongitude(input)).toBe(expected);
  });

  it.each([
    [0, 0],
    [360, 0],
    [720, 0],
    [-10, 350],
    [370, 10],
  ])("normaliza bearing %d para %d", (input, expected) => {
    expect(normalizeBearing(input)).toBe(expected);
  });

  it("clampa latitude aos extremos de Web Mercator", () => {
    expect(clampLatitude(90)).toBe(MAX_MERCATOR_LATITUDE);
    expect(clampLatitude(-90)).toBe(-MAX_MERCATOR_LATITUDE);
    expect(clampLatitude(23.5)).toBe(23.5);
  });

  it("não deixa zero negativo na representação canônica", () => {
    expect(Object.is(normalizeLongitude(-0), -0)).toBe(false);
    expect(Object.is(normalizeBearing(-0), -0)).toBe(false);
    expect(Object.is(clampLatitude(-0), -0)).toBe(false);
  });

  it("rejeita números não finitos", () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => normalizeLongitude(invalid)).toThrow(RangeError);
      expect(() => normalizeBearing(invalid)).toThrow(RangeError);
      expect(() => clampLatitude(invalid)).toThrow(RangeError);
    }
  });

  it("é periódica em voltas inteiras", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: -1000, max: 1000 }),
        (longitude, turns) => {
          const longitudeDelta = Math.abs(
            normalizeLongitude(longitude + turns * 360) - normalizeLongitude(longitude),
          );
          const bearingDelta = Math.abs(
            normalizeBearing(longitude + turns * 360) - normalizeBearing(longitude),
          );
          expect(Math.min(longitudeDelta, 360 - longitudeDelta)).toBeLessThan(1e-8);
          expect(Math.min(bearingDelta, 360 - bearingDelta)).toBeLessThan(1e-8);
        },
      ),
    );
  });
});

describe("normalizeCameraState", () => {
  it("normaliza wrap e clamp de todos os componentes", () => {
    expect(
      normalizeCameraState({
        center: [541, 90],
        zoom: 99,
        bearing: -10,
        pitch: -5,
      }),
    ).toEqual({
      center: [-179, MAX_MERCATOR_LATITUDE],
      zoom: 24,
      bearing: 350,
      pitch: 0,
    });
  });

  it("aceita limites específicos do adaptador", () => {
    const constraints: CameraConstraints = {
      minLatitude: -70,
      maxLatitude: 70,
      minZoom: 2,
      maxZoom: 18,
      minPitch: 10,
      maxPitch: 60,
    };

    expect(
      normalizeCameraState({ center: [20, -80], zoom: 1, bearing: 720, pitch: 80 }, constraints),
    ).toEqual({ center: [20, -70], zoom: 2, bearing: 0, pitch: 60 });
  });

  it("rejeita estado não finito em qualquer componente", () => {
    const valid: CameraState = { center: [0, 0], zoom: 1, bearing: 0, pitch: 0 };
    const invalidStates: readonly CameraState[] = [
      { ...valid, center: [Number.NaN, 0] },
      { ...valid, center: [0, Number.POSITIVE_INFINITY] },
      { ...valid, zoom: Number.NaN },
      { ...valid, bearing: Number.NEGATIVE_INFINITY },
      { ...valid, pitch: Number.POSITIVE_INFINITY },
    ];

    for (const state of invalidStates) {
      expect(() => normalizeCameraState(state)).toThrow(RangeError);
    }
  });

  it("rejeita limites invertidos, não finitos ou fora da esfera", () => {
    const base = DEFAULT_CAMERA_CONSTRAINTS;
    const invalidConstraints: readonly CameraConstraints[] = [
      { ...base, minLatitude: 1, maxLatitude: -1 },
      { ...base, minZoom: 10, maxZoom: 2 },
      { ...base, minPitch: 20, maxPitch: 10 },
      { ...base, maxZoom: Number.NaN },
      { ...base, minLatitude: -91 },
      { ...base, maxLatitude: 91 },
    ];

    for (const constraints of invalidConstraints) {
      expect(() => normalizeCameraState(DEFAULT_CAMERA_STATE, constraints)).toThrow(RangeError);
    }
  });

  it("é idempotente e sempre devolve valores nos intervalos canônicos", () => {
    fc.assert(
      fc.property(cameraStateArbitrary, (state) => {
        const normalized = normalizeCameraState(state);
        expect(normalizeCameraState(normalized)).toEqual(normalized);
        expect(normalized.center[0]).toBeGreaterThanOrEqual(-180);
        expect(normalized.center[0]).toBeLessThan(180);
        expect(normalized.center[1]).toBeGreaterThanOrEqual(-MAX_MERCATOR_LATITUDE);
        expect(normalized.center[1]).toBeLessThanOrEqual(MAX_MERCATOR_LATITUDE);
        expect(normalized.zoom).toBeGreaterThanOrEqual(0);
        expect(normalized.zoom).toBeLessThanOrEqual(24);
        expect(normalized.bearing).toBeGreaterThanOrEqual(0);
        expect(normalized.bearing).toBeLessThan(360);
        expect(normalized.pitch).toBeGreaterThanOrEqual(0);
        expect(normalized.pitch).toBeLessThanOrEqual(85);
      }),
    );
  });

  it("expõe defaults imutáveis", () => {
    expect(Object.isFrozen(DEFAULT_CAMERA_CONSTRAINTS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CAMERA_STATE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CAMERA_STATE.center)).toBe(true);
  });
});
