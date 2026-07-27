import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  fitMercatorBounds,
  geoBoundsCenter,
  geoBoundsContains,
  geoBoundsFromPoints,
  geoBoundsLongitudeSpan,
} from "./bounds.js";
import { FlatMercatorProjector } from "./projector.js";
import type { LngLat } from "./types.js";

describe("GeoBounds", () => {
  it("devolve undefined para coleção vazia", () => {
    expect(geoBoundsFromPoints([])).toBeUndefined();
  });

  it("calcula bounds convencional", () => {
    expect(
      geoBoundsFromPoints([
        [-10, 5],
        [20, -3],
        [4, 9],
      ]),
    ).toEqual({ west: -10, south: -3, east: 20, north: 9 });
  });

  it("escolhe a extensão curta ao cruzar o antimeridiano", () => {
    const bounds = geoBoundsFromPoints([
      [170, -10],
      [-170, 20],
      [179, 5],
    ]);
    expect(bounds).toEqual({ west: 170, south: -10, east: -170, north: 20 });
    expect(geoBoundsLongitudeSpan(bounds!)).toBe(20);
    expect(geoBoundsCenter(bounds!)).toEqual([-180, 5]);
    expect(geoBoundsContains(bounds!, [179, 0])).toBe(true);
    expect(geoBoundsContains(bounds!, [-179, 0])).toBe(true);
    expect(geoBoundsContains(bounds!, [0, 0])).toBe(false);
  });

  it("uma bounds mundial contém qualquer longitude", () => {
    const world = { west: -180, south: -90, east: 180, north: 90 } as const;
    expect(geoBoundsLongitudeSpan(world)).toBe(360);
    expect(geoBoundsContains(world, [12_345, 0])).toBe(true);
  });

  it("a bounds mínima contém todos os pontos de entrada", () => {
    const pointArbitrary = fc.tuple(
      fc.double({ min: -180, max: 180, noNaN: true }),
      fc.double({ min: -90, max: 90, noNaN: true }),
    );
    fc.assert(
      fc.property(fc.array(pointArbitrary, { minLength: 1, maxLength: 30 }), (rawPoints) => {
        const points = rawPoints as readonly LngLat[];
        const bounds = geoBoundsFromPoints(points);
        expect(bounds).toBeDefined();
        for (const point of points) expect(geoBoundsContains(bounds!, point)).toBe(true);
      }),
    );
  });
});

describe("fitMercatorBounds", () => {
  it("enquadra os quatro cantos dentro do padding", () => {
    const bounds = { west: -10, south: 40, east: 30, north: 60 } as const;
    const viewport = [1200, 800] as const;
    const padding = 80;
    const fit = fitMercatorBounds(bounds, viewport, { padding });
    const projector = new FlatMercatorProjector({
      center: fit.center,
      zoom: fit.zoom,
      viewport,
    });

    for (const point of [
      [bounds.west, bounds.south],
      [bounds.west, bounds.north],
      [bounds.east, bounds.south],
      [bounds.east, bounds.north],
    ] as const) {
      const screen = projector.project(point);
      expect(screen[0]).toBeGreaterThanOrEqual(padding - 1e-8);
      expect(screen[0]).toBeLessThanOrEqual(viewport[0] - padding + 1e-8);
      expect(screen[1]).toBeGreaterThanOrEqual(padding - 1e-8);
      expect(screen[1]).toBeLessThanOrEqual(viewport[1] - padding + 1e-8);
    }
  });

  it("enquadra corretamente uma bounds sobre o antimeridiano", () => {
    const fit = fitMercatorBounds({ west: 170, south: -10, east: -170, north: 10 }, [1000, 600], {
      padding: 50,
    });
    expect(Math.abs(fit.center[0])).toBe(180);

    const projector = new FlatMercatorProjector({
      center: fit.center,
      zoom: fit.zoom,
      viewport: [1000, 600],
    });
    expect(projector.project([170, 0])[0]).toBeGreaterThanOrEqual(50);
    expect(projector.project([-170, 0])[0]).toBeLessThanOrEqual(950);
  });

  it("usa maxZoom para um único ponto e respeita limites", () => {
    expect(
      fitMercatorBounds({ west: 10, south: 20, east: 10, north: 20 }, [1000, 500], { maxZoom: 18 })
        .zoom,
    ).toBe(18);
    expect(
      fitMercatorBounds({ west: -180, south: -85, east: 180, north: 85 }, [100, 100], {
        minZoom: 3,
      }).zoom,
    ).toBe(3);
  });

  it("rejeita opções geometricamente impossíveis", () => {
    const bounds = { west: 0, south: 0, east: 1, north: 1 } as const;
    expect(() => fitMercatorBounds(bounds, [100, 100], { padding: -1 })).toThrow(RangeError);
    expect(() => fitMercatorBounds(bounds, [100, 100], { padding: 50 })).toThrow(RangeError);
    expect(() => fitMercatorBounds(bounds, [100, 100], { tileSize: 0 })).toThrow(RangeError);
    expect(() => fitMercatorBounds(bounds, [100, 100], { minZoom: 10, maxZoom: 5 })).toThrow(
      RangeError,
    );
    expect(() => fitMercatorBounds({ west: 0, south: 2, east: 1, north: 1 }, [100, 100])).toThrow(
      RangeError,
    );
  });
});
