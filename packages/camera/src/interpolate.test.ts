import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CameraState, interpolateCameraState, normalizeCameraState } from "./index.js";

const fromWarsaw: CameraState = {
  center: [21.0122, 52.2297],
  zoom: 5,
  bearing: 350,
  pitch: 10,
};

const toLeningrad: CameraState = {
  center: [30.3351, 59.9343],
  zoom: 9,
  bearing: 10,
  pitch: 50,
};

describe("interpolateCameraState", () => {
  it("interpola pan, zoom, bearing e pitch com o mesmo progresso", () => {
    const halfway = interpolateCameraState(fromWarsaw, toLeningrad, 0.5);

    expect(halfway.center[0]).toBeCloseTo((21.0122 + 30.3351) / 2, 12);
    expect(halfway.center[1]).toBeCloseTo((52.2297 + 59.9343) / 2, 12);
    expect(halfway.zoom).toBe(7);
    expect(halfway.bearing).toBe(0);
    expect(halfway.pitch).toBe(30);
  });

  it("cruza o antimeridiano pelo arco de 2°, não pelo mundo inteiro", () => {
    const eastward = interpolateCameraState(
      { ...fromWarsaw, center: [179, 10] },
      { ...toLeningrad, center: [-179, 20] },
      0.5,
    );
    const westward = interpolateCameraState(
      { ...fromWarsaw, center: [-179, 10] },
      { ...toLeningrad, center: [179, 20] },
      0.5,
    );

    expect(eastward.center).toEqual([-180, 15]);
    expect(westward.center).toEqual([-180, 15]);
  });

  it("gira bearing pelo caminho curto nos dois sentidos", () => {
    expect(
      interpolateCameraState({ ...fromWarsaw, bearing: 350 }, { ...toLeningrad, bearing: 10 }, 0.25)
        .bearing,
    ).toBe(355);
    expect(
      interpolateCameraState({ ...fromWarsaw, bearing: 10 }, { ...toLeningrad, bearing: 350 }, 0.25)
        .bearing,
    ).toBe(5);
  });

  it("escolhe o sentido positivo no empate exato de 180°", () => {
    expect(
      interpolateCameraState({ ...fromWarsaw, bearing: 0 }, { ...toLeningrad, bearing: 180 }, 0.5)
        .bearing,
    ).toBe(90);
  });

  it("clampa progresso fora de [0, 1] e preserva endpoints canônicos", () => {
    expect(interpolateCameraState(fromWarsaw, toLeningrad, -1)).toEqual(
      normalizeCameraState(fromWarsaw),
    );
    expect(interpolateCameraState(fromWarsaw, toLeningrad, 2)).toEqual(
      normalizeCameraState(toLeningrad),
    );
  });

  it("não muta os estados de entrada", () => {
    const fromSnapshot = structuredClone(fromWarsaw);
    const toSnapshot = structuredClone(toLeningrad);
    interpolateCameraState(fromWarsaw, toLeningrad, 0.5);
    expect(fromWarsaw).toEqual(fromSnapshot);
    expect(toLeningrad).toEqual(toSnapshot);
  });

  it("rejeita progresso não finito", () => {
    expect(() => interpolateCameraState(fromWarsaw, toLeningrad, Number.NaN)).toThrow(RangeError);
    expect(() => interpolateCameraState(fromWarsaw, toLeningrad, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it("mantém todos os resultados canônicos para estados e progressos arbitrários", () => {
    const finite = fc.double({ min: -1e4, max: 1e4, noNaN: true });
    const state = fc.record({
      center: fc.tuple(finite, finite),
      zoom: finite,
      bearing: finite,
      pitch: finite,
    });

    fc.assert(
      fc.property(
        state,
        state,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (from, to, progress) => {
          const result = interpolateCameraState(from, to, progress);
          expect(normalizeCameraState(result)).toEqual(result);
        },
      ),
    );
  });
});
