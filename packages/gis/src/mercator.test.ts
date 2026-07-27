import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_MERCATOR_LATITUDE,
  mercatorInterpolate,
  mercatorMetersPerPixel,
  shortestLongitudeDelta,
  webMercatorProject,
  webMercatorUnproject,
  wrapLongitude,
} from "./mercator.js";
import { FlatMercatorProjector, projectorFromSnapshot } from "./projector.js";

const longitudeArbitrary = fc.double({ min: -180, max: 180, noNaN: true });
const latitudeArbitrary = fc.double({
  min: -MAX_MERCATOR_LATITUDE,
  max: MAX_MERCATOR_LATITUDE,
  noNaN: true,
});

describe("Web Mercator", () => {
  it("projeta os pontos canônicos", () => {
    expect(webMercatorProject([0, 0])).toEqual([0.5, 0.5]);
    const northEast = webMercatorProject([180, MAX_MERCATOR_LATITUDE]);
    const southWest = webMercatorProject([-180, -MAX_MERCATOR_LATITUDE]);
    expect(northEast[0]).toBe(1);
    expect(northEast[1]).toBeCloseTo(0, 12);
    expect(southWest[0]).toBe(0);
    expect(southWest[1]).toBeCloseTo(1, 12);
  });

  it("project/unproject faz round-trip no domínio válido", () => {
    fc.assert(
      fc.property(longitudeArbitrary, latitudeArbitrary, (longitude, latitude) => {
        const result = webMercatorUnproject(webMercatorProject([longitude, latitude]));
        expect(result[0]).toBeCloseTo(longitude, 9);
        expect(result[1]).toBeCloseTo(latitude, 8);
      }),
    );
  });

  it("limita latitude além do domínio finito", () => {
    expect(webMercatorProject([0, 90])[1]).toBeCloseTo(0, 12);
    expect(webMercatorProject([0, -90])[1]).toBeCloseTo(1, 12);
  });

  it("calcula resolução conforme latitude e zoom", () => {
    expect(mercatorMetersPerPixel(0, 0)).toBeCloseTo(78_271.516964, 6);
    expect(mercatorMetersPerPixel(60, 0)).toBeCloseTo(mercatorMetersPerPixel(0, 0) / 2, 8);
    expect(mercatorMetersPerPixel(0, 10)).toBeCloseTo(mercatorMetersPerPixel(0, 0) / 1024, 10);
  });
});

describe("world wrap e interpolação Mercator", () => {
  it("normaliza longitudes para intervalo semiaberto", () => {
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(540)).toBe(-180);
    expect(wrapLongitude(-181)).toBe(179);
  });

  it("delta curto é antissimétrico, inclusive em 180°", () => {
    fc.assert(
      fc.property(longitudeArbitrary, longitudeArbitrary, (a, b) => {
        expect(shortestLongitudeDelta(a, b)).toBeCloseTo(-shortestLongitudeDelta(b, a), 10);
      }),
    );
  });

  it("cruza o antimeridiano em vez de atravessar Greenwich", () => {
    const midpoint = mercatorInterpolate([170, 10], [-170, 20], 0.5);
    expect(Math.abs(midpoint[0])).toBeCloseTo(180, 10);

    const projectedA = webMercatorProject([170, 10]);
    const projectedB = webMercatorProject([-170, 20]);
    const projectedMidpoint = webMercatorProject(midpoint);
    expect(projectedMidpoint[1]).toBeCloseTo((projectedA[1] + projectedB[1]) / 2, 12);
  });

  it("preserva os extremos exatamente", () => {
    const a = [170, 10] as const;
    const b = [-170, 20] as const;
    expect(mercatorInterpolate(a, b, 0)).toBe(a);
    expect(mercatorInterpolate(a, b, 1)).toBe(b);
  });
});

describe("FlatMercatorProjector", () => {
  it("projeta o centro no centro do viewport", () => {
    const projector = new FlatMercatorProjector({
      center: [36.1874, 51.7304],
      zoom: 7,
      viewport: [1920, 1080],
    });
    expect(projector.project([36.1874, 51.7304])).toEqual([960, 540]);
  });

  it("aplica bearing e converte bearing geográfico para tela", () => {
    const projector = new FlatMercatorProjector({
      center: [0, 0],
      zoom: 4,
      bearing: 90,
      viewport: [1000, 1000],
    });
    const east = projector.project([1, 0]);
    expect(east[0]).toBeCloseTo(500, 9);
    expect(east[1]).toBeLessThan(500);
    expect(projector.bearingToScreenAngle(120)).toBe(30);
  });

  it("project/unproject faz round-trip no mundo próximo", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -170, max: 170, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: 0, max: 359.999, noNaN: true }),
        (longitude, latitude, bearing) => {
          const projector = new FlatMercatorProjector({
            center: [0, 0],
            zoom: 3,
            bearing,
            viewport: [1280, 720],
          });
          const result = projector.unproject(projector.project([longitude, latitude]));
          expect(result[0]).toBeCloseTo(longitude, 8);
          expect(result[1]).toBeCloseTo(latitude, 8);
        },
      ),
    );
  });

  it("usa o mundo mais próximo ao cruzar o antimeridiano", () => {
    const projector = new FlatMercatorProjector({
      center: [179, 0],
      zoom: 4,
      viewport: [1000, 1000],
    });
    const acrossDateLine = projector.project([-179, 0]);
    expect(acrossDateLine[0]).toBeGreaterThan(500);
    expect(acrossDateLine[0]).toBeLessThan(600);
  });

  it("snapshot é serializável, congelado e reconstruível", () => {
    const projector = new FlatMercatorProjector({
      center: [10, 20],
      zoom: 5,
      bearing: 25,
      viewport: [800, 600],
    });
    const snapshot = projector.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.center)).toBe(true);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(projectorFromSnapshot(snapshot).project([11, 21])).toEqual(projector.project([11, 21]));
  });

  it("rejeita dimensões inválidas e snapshots com pitch", () => {
    expect(
      () => new FlatMercatorProjector({ center: [0, 0], zoom: 0, viewport: [0, 100] }),
    ).toThrow(RangeError);
    expect(() =>
      projectorFromSnapshot({
        projection: "mercator",
        center: [0, 0],
        zoom: 0,
        bearing: 0,
        pitch: 45,
        viewport: [100, 100],
        tileSize: 512,
      }),
    ).toThrow(RangeError);
  });
});
