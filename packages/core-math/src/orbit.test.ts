import { describe, expect, it } from "vitest";
import {
  MAX_ELEVATION_DEG,
  MIN_ORBIT_DISTANCE_METERS,
  orbitCameraPosition,
  orbitDistanceToFit,
  orbitStateFromPosition,
} from "./orbit.js";
import type { Vec3 } from "./vec.js";

const ORIGIN: Vec3 = [0, 0, 0];

describe("orbitCameraPosition", () => {
  it("põe azimute 0 e elevação 0 ao sul do alvo, na distância pedida", () => {
    const [x, y, z] = orbitCameraPosition({
      target: ORIGIN,
      distanceMeters: 100,
      azimuthDeg: 0,
      elevationDeg: 0,
    });
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(100, 9);
  });

  it("gira para o leste com azimute 90", () => {
    const [x, y, z] = orbitCameraPosition({
      target: ORIGIN,
      distanceMeters: 100,
      azimuthDeg: 90,
      elevationDeg: 0,
    });
    expect(x).toBeCloseTo(100, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
  });

  it("mantém a distância ao alvo em qualquer par de ângulos", () => {
    for (const azimuthDeg of [-210, -33, 0, 47, 180, 359]) {
      for (const elevationDeg of [-80, -12, 0, 25, 75]) {
        const position = orbitCameraPosition({
          target: [12, -4, 30],
          distanceMeters: 250,
          azimuthDeg,
          elevationDeg,
        });
        expect(Math.hypot(position[0] - 12, position[1] + 4, position[2] - 30)).toBeCloseTo(250, 6);
      }
    }
  });

  it("acompanha o alvo: mover o centro move a câmera junto", () => {
    const state = { distanceMeters: 40, azimuthDeg: 31, elevationDeg: 17 };
    const a = orbitCameraPosition({ target: ORIGIN, ...state });
    const b = orbitCameraPosition({ target: [5, 6, 7], ...state });
    expect(b[0] - a[0]).toBeCloseTo(5, 9);
    expect(b[1] - a[1]).toBeCloseTo(6, 9);
    expect(b[2] - a[2]).toBeCloseTo(7, 9);
  });

  it("limita a elevação antes do polo, onde a matriz de observação degenera", () => {
    const atLimit = orbitCameraPosition({
      target: ORIGIN,
      distanceMeters: 10,
      azimuthDeg: 0,
      elevationDeg: MAX_ELEVATION_DEG,
    });
    // Um keyframe passando por 90° não pode produzir uma câmera diferente da do
    // limite: é essa igualdade que impede o salto no meio da interpolação.
    for (const beyond of [90, 120, 400]) {
      const clamped = orbitCameraPosition({
        target: ORIGIN,
        distanceMeters: 10,
        azimuthDeg: 0,
        elevationDeg: beyond,
      });
      expect(clamped).toEqual(atLimit);
    }
    // E a câmera nunca chega exatamente sobre o alvo no plano horizontal.
    expect(Math.hypot(atLimit[0], atLimit[2])).toBeGreaterThan(0);
  });

  it("nunca colapsa a câmera dentro do alvo", () => {
    for (const distanceMeters of [0, -50, Number.MIN_VALUE]) {
      const position = orbitCameraPosition({
        target: ORIGIN,
        distanceMeters,
        azimuthDeg: 45,
        elevationDeg: 20,
      });
      expect(Math.hypot(...position)).toBeCloseTo(MIN_ORBIT_DISTANCE_METERS, 9);
    }
  });
});

describe("orbitStateFromPosition", () => {
  it("é o inverso de orbitCameraPosition — arrastar e gravar não salta", () => {
    const target: Vec3 = [-3, 8, 21];
    for (const azimuthDeg of [-170, -45, 0, 60, 179]) {
      for (const elevationDeg of [-70, -5, 0, 33, 88]) {
        const original = { target, distanceMeters: 75, azimuthDeg, elevationDeg };
        const recovered = orbitStateFromPosition(orbitCameraPosition(original), target);
        expect(recovered.distanceMeters).toBeCloseTo(75, 6);
        expect(recovered.azimuthDeg).toBeCloseTo(azimuthDeg, 6);
        expect(recovered.elevationDeg).toBeCloseTo(elevationDeg, 6);
      }
    }
  });

  it("degenera com dignidade quando a câmera está sobre o alvo", () => {
    const state = orbitStateFromPosition([1, 1, 1], [1, 1, 1]);
    expect(state.distanceMeters).toBe(MIN_ORBIT_DISTANCE_METERS);
    expect(Number.isFinite(state.azimuthDeg)).toBe(true);
    expect(Number.isFinite(state.elevationDeg)).toBe(true);
  });
});

describe("orbitDistanceToFit", () => {
  it("recua o bastante para a esfera caber no campo vertical", () => {
    const fovDeg = 40;
    const radius = 9;
    const distance = orbitDistanceToFit(radius, fovDeg, 1);
    // Meio campo visto da distância calculada tem exatamente o raio da esfera.
    const halfExtent = distance * Math.sin(((fovDeg / 2) * Math.PI) / 180);
    expect(halfExtent).toBeCloseTo(radius, 9);
  });

  it("escala linearmente com o tamanho do objeto", () => {
    const small = orbitDistanceToFit(10, 45);
    const large = orbitDistanceToFit(330, 45);
    expect(large / small).toBeCloseTo(33, 9);
  });

  it("recua mais em campo estreito", () => {
    expect(orbitDistanceToFit(10, 20)).toBeGreaterThan(orbitDistanceToFit(10, 70));
  });

  it("sobrevive a campo absurdo sem devolver NaN nem distância negativa", () => {
    for (const fovDeg of [0, -30, 180, 1e6]) {
      const distance = orbitDistanceToFit(10, fovDeg);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeGreaterThanOrEqual(MIN_ORBIT_DISTANCE_METERS);
    }
  });
});
