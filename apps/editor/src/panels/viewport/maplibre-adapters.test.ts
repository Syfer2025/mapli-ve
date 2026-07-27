import { DEFAULT_TILE_SIZE, mercatorMetersPerPixel } from "@theatrum/gis";
import { describe, expect, it, vi } from "vitest";
import {
  type MapLibreCameraOptionsLike,
  type MapLibreCoordinateLike,
  type MapLibreLike,
  createMapLibreCameraPort,
  createMapLibreProjectorPort,
} from "./maplibre-adapters.js";

class FakeMapLibre implements MapLibreLike {
  center = { lng: 20, lat: 50 };
  zoom = 5;
  bearing = 30;
  pitch = 45;
  canvas = { clientWidth: 1920, clientHeight: 1080 };
  isLoaded = true;
  tilesLoaded = true;
  moving = false;
  terrainElevation: number | null | undefined = 120;
  readonly projectCalls: {
    readonly lngLat: MapLibreCoordinateLike;
    readonly altitude?: number;
  }[] = [];
  readonly unprojectCalls: MapLibreCoordinateLike[] = [];
  readonly jumpCalls: MapLibreCameraOptionsLike[] = [];
  readonly easeCalls: MapLibreCameraOptionsLike[] = [];
  readonly idleListeners = new Set<() => void>();
  readonly errorListeners = new Set<() => void>();
  offCount = 0;

  project(
    lngLat: MapLibreCoordinateLike,
    altitude?: number,
  ): { readonly x: number; readonly y: number } {
    this.projectCalls.push(altitude === undefined ? { lngLat } : { lngLat, altitude });
    return { x: lngLat[0] * 10 + (altitude ?? 0), y: lngLat[1] * -10 };
  }

  unproject(point: MapLibreCoordinateLike): { readonly lng: number; readonly lat: number } {
    this.unprojectCalls.push(point);
    return { lng: point[0] / 10, lat: point[1] / -10 };
  }

  getCenter(): { readonly lng: number; readonly lat: number } {
    return this.center;
  }

  getZoom(): number {
    return this.zoom;
  }

  getBearing(): number {
    return this.bearing;
  }

  getPitch(): number {
    return this.pitch;
  }

  getCanvas(): { readonly clientWidth: number; readonly clientHeight: number } {
    return this.canvas;
  }

  jumpTo(options: MapLibreCameraOptionsLike): void {
    this.jumpCalls.push(options);
  }

  easeTo(options: MapLibreCameraOptionsLike): void {
    this.easeCalls.push(options);
  }

  loaded(): boolean {
    return this.isLoaded;
  }

  areTilesLoaded(): boolean {
    return this.tilesLoaded;
  }

  isMoving(): boolean {
    return this.moving;
  }

  on(type: "idle" | "error", listener: () => void): void {
    (type === "idle" ? this.idleListeners : this.errorListeners).add(listener);
  }

  off(type: "idle" | "error", listener: () => void): void {
    this.offCount++;
    (type === "idle" ? this.idleListeners : this.errorListeners).delete(listener);
  }

  queryTerrainElevation(_lngLat: MapLibreCoordinateLike): number | null | undefined {
    return this.terrainElevation;
  }

  emitIdle(): void {
    for (const listener of [...this.idleListeners]) listener();
  }

  emitError(): void {
    for (const listener of [...this.errorListeners]) listener();
  }
}

describe("createMapLibreProjectorPort", () => {
  it("delega project e unproject ao transform vivo, incluindo altitude", () => {
    const map = new FakeMapLibre();
    const projector = createMapLibreProjectorPort(map);

    expect(projector.project([12, 34], 50)).toEqual([170, -340]);
    expect(map.projectCalls).toEqual([{ lngLat: [12, 34], altitude: 50 }]);
    expect(projector.unproject([120, -340])).toEqual([12, 34]);
    expect(map.unprojectCalls).toEqual([[120, -340]]);
  });

  it("calcula resolução Mercator com o zoom atual e tileSize configurado", () => {
    const map = new FakeMapLibre();
    map.zoom = 7;
    const projector = createMapLibreProjectorPort(map, { tileSize: 256 });

    expect(projector.metersPerPixel(52)).toBeCloseTo(mercatorMetersPerPixel(52, 7, 256), 12);

    map.zoom = 8;
    expect(projector.metersPerPixel(52)).toBeCloseTo(mercatorMetersPerPixel(52, 8, 256), 12);
  });

  it("converte bearing geográfico em ângulo de tela pelo caminho canônico", () => {
    const map = new FakeMapLibre();
    map.bearing = 350;
    const projector = createMapLibreProjectorPort(map);

    expect(projector.bearingToScreenAngle(10)).toBe(20);
    expect(projector.bearingToScreenAngle(340)).toBe(350);
  });

  it("delega terreno e converte ausência em null", () => {
    const map = new FakeMapLibre();
    const projector = createMapLibreProjectorPort(map);

    expect(projector.elevationAt([20, 50])).toBe(120);
    map.terrainElevation = undefined;
    expect(projector.elevationAt([20, 50])).toBeNull();
  });

  it("captura snapshot profundo, canônico, congelado e independente do mapa", () => {
    const map = new FakeMapLibre();
    map.center = { lng: 181, lat: 50 };
    map.bearing = -10;
    const projector = createMapLibreProjectorPort(map);
    const snapshot = projector.snapshot();

    expect(snapshot).toEqual({
      projection: "mercator",
      center: [-179, 50],
      zoom: 5,
      bearing: 350,
      pitch: 45,
      viewport: [1920, 1080],
      tileSize: DEFAULT_TILE_SIZE,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.center)).toBe(true);
    expect(Object.isFrozen(snapshot.viewport)).toBe(true);

    map.center = { lng: 10, lat: 20 };
    map.canvas = { clientWidth: 800, clientHeight: 600 };
    expect(snapshot.center).toEqual([-179, 50]);
    expect(snapshot.viewport).toEqual([1920, 1080]);
    expect(projector.snapshot().center).toEqual([10, 20]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejeita tileSize inválido %s",
    (tileSize) => {
      expect(() => createMapLibreProjectorPort(new FakeMapLibre(), { tileSize })).toThrow(
        RangeError,
      );
    },
  );

  it("rejeita snapshot de viewport sem dimensões válidas", () => {
    const map = new FakeMapLibre();
    map.canvas = { clientWidth: 0, clientHeight: 1080 };
    const projector = createMapLibreProjectorPort(map);
    expect(() => projector.snapshot()).toThrow(RangeError);
  });
});

describe("createMapLibreCameraPort", () => {
  it("lê e normaliza o estado atual", () => {
    const map = new FakeMapLibre();
    map.center = { lng: 181, lat: 90 };
    map.zoom = 99;
    map.bearing = -10;
    map.pitch = -1;

    expect(createMapLibreCameraPort(map).current()).toEqual({
      center: [-179, 85.051_128_779_806_6],
      zoom: 24,
      bearing: 350,
      pitch: 0,
    });
  });

  it("aplica jump com estado canônico", () => {
    const map = new FakeMapLibre();
    const camera = createMapLibreCameraPort(map);

    camera.apply({ center: [181, 90], zoom: 30, bearing: -10, pitch: 90 }, "jump");

    expect(map.jumpCalls).toEqual([
      {
        center: [-179, 85.051_128_779_806_6],
        zoom: 24,
        bearing: 350,
        pitch: 85,
      },
    ]);
    expect(map.easeCalls).toHaveLength(0);
  });

  it("aplica ease sem iniciar jump", () => {
    const map = new FakeMapLibre();
    const camera = createMapLibreCameraPort(map);
    camera.apply({ center: [20, 50], zoom: 6, bearing: 40, pitch: 20 }, "ease");

    expect(map.easeCalls).toEqual([{ center: [20, 50], zoom: 6, bearing: 40, pitch: 20 }]);
    expect(map.jumpCalls).toHaveLength(0);
  });

  it.each([
    [true, true, false, true],
    [false, true, false, false],
    [true, false, false, false],
    [true, true, true, false],
  ])(
    "settled com loaded=%s tiles=%s moving=%s resulta em %s",
    (loaded, tiles, moving, expected) => {
      const map = new FakeMapLibre();
      map.isLoaded = loaded;
      map.tilesLoaded = tiles;
      map.moving = moving;
      expect(createMapLibreCameraPort(map).isSettled()).toBe(expected);
    },
  );

  it("publica idle e remove o listener com dispose idempotente", () => {
    const map = new FakeMapLibre();
    const camera = createMapLibreCameraPort(map);
    const listener = vi.fn();
    const subscription = camera.onSettled(listener);

    expect(map.idleListeners.size).toBe(1);
    expect(map.errorListeners.size).toBe(1);
    map.emitIdle();
    expect(listener).toHaveBeenCalledTimes(1);

    subscription.dispose();
    subscription.dispose();
    map.emitIdle();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(map.idleListeners.size).toBe(0);
    expect(map.errorListeners.size).toBe(0);
    expect(map.offCount).toBe(2);
  });

  it("não declara settle depois de erro de recurso", () => {
    const map = new FakeMapLibre();
    const camera = createMapLibreCameraPort(map);
    const listener = vi.fn();
    const subscription = camera.onSettled(listener);

    map.emitError();
    map.emitIdle();

    expect(listener).not.toHaveBeenCalled();
    subscription.dispose();
    expect(map.idleListeners.size).toBe(0);
    expect(map.errorListeners.size).toBe(0);
  });
});
