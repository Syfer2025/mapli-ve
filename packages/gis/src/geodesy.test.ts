import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  destinationPoint,
  EARTH_MEAN_RADIUS_METERS,
  geodesicDistance,
  greatCircleInterpolate,
  initialBearing,
} from "./geodesy.js";

const longitudeArbitrary = fc.double({ min: -180, max: 180, noNaN: true });
const latitudeArbitrary = fc.double({ min: -89.9, max: 89.9, noNaN: true });

describe("geodesicDistance", () => {
  it("bate com uma distância de referência Londres–Nova York", () => {
    const london = [-0.1278, 51.5074] as const;
    const newYork = [-74.006, 40.7128] as const;
    expect(geodesicDistance(london, newYork)).toBeCloseTo(5_570_230, -3);
  });

  it("é zero na identidade, simétrica e não negativa", () => {
    fc.assert(
      fc.property(
        longitudeArbitrary,
        latitudeArbitrary,
        longitudeArbitrary,
        latitudeArbitrary,
        (longitudeA, latitudeA, longitudeB, latitudeB) => {
          const a = [longitudeA, latitudeA] as const;
          const b = [longitudeB, latitudeB] as const;
          expect(geodesicDistance(a, a)).toBe(0);
          expect(geodesicDistance(a, b)).toBeGreaterThanOrEqual(0);
          expect(geodesicDistance(a, b)).toBeCloseTo(geodesicDistance(b, a), 7);
        },
      ),
    );
  });

  it("usa o caminho curto no antimeridiano", () => {
    const distance = geodesicDistance([179, 0], [-179, 0]);
    expect(distance).toBeCloseTo(222_390, -1);
  });
});

describe("bearing e destino", () => {
  it("reconhece os quatro pontos cardeais", () => {
    expect(initialBearing([0, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(initialBearing([0, 0], [1, 0])).toBeCloseTo(90, 10);
    expect(initialBearing([0, 0], [0, -1])).toBeCloseTo(180, 10);
    expect(initialBearing([0, 0], [-1, 0])).toBeCloseTo(270, 10);
    expect(initialBearing([2, 3], [2, 3])).toBe(0);
  });

  it("um grau no equador chega à longitude esperada", () => {
    const oneDegree = (Math.PI / 180) * EARTH_MEAN_RADIUS_METERS;
    const result = destinationPoint([0, 0], 90, oneDegree);
    expect(result[0]).toBeCloseTo(1, 10);
    expect(result[1]).toBeCloseTo(0, 10);
  });

  it("destinationPoint preserva a distância pedida", () => {
    fc.assert(
      fc.property(
        longitudeArbitrary,
        fc.double({ min: -75, max: 75, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.double({ min: 0, max: 5_000_000, noNaN: true }),
        (longitude, latitude, bearing, meters) => {
          const from = [longitude, latitude] as const;
          const destination = destinationPoint(from, bearing, meters);
          expect(geodesicDistance(from, destination)).toBeCloseTo(meters, 5);
        },
      ),
    );
  });
});

describe("greatCircleInterpolate", () => {
  it("preserva os extremos exatamente", () => {
    const a = [170, 10] as const;
    const b = [-170, 20] as const;
    expect(greatCircleInterpolate(a, b, 0)).toBe(a);
    expect(greatCircleInterpolate(a, b, 1)).toBe(b);
  });

  it("cruza o antimeridiano pelo arco curto", () => {
    const midpoint = greatCircleInterpolate([170, 10], [-170, 10], 0.5);
    expect(Math.abs(midpoint[0])).toBeCloseTo(180, 9);
    expect(midpoint[1]).toBeGreaterThan(10);
  });

  it("divide a distância do arco proporcionalmente", () => {
    fc.assert(
      fc.property(
        longitudeArbitrary,
        latitudeArbitrary,
        longitudeArbitrary,
        latitudeArbitrary,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (longitudeA, latitudeA, longitudeB, latitudeB, t) => {
          const a = [longitudeA, latitudeA] as const;
          const b = [longitudeB, latitudeB] as const;
          const total = geodesicDistance(a, b);
          // Próximo de antípodas a direção do arco é numericamente mal condicionada.
          fc.pre(total < Math.PI * EARTH_MEAN_RADIUS_METERS - 10);
          const point = greatCircleInterpolate(a, b, t);
          expect(geodesicDistance(a, point)).toBeCloseTo(total * t, 4);
        },
      ),
    );
  });

  it("escolhe um arco finito e determinístico para antípodas exatos", () => {
    const first = greatCircleInterpolate([0, 0], [180, 0], 0.5);
    const second = greatCircleInterpolate([0, 0], [180, 0], 0.5);
    expect(first).toEqual(second);
    expect(first.every(Number.isFinite)).toBe(true);
    expect(geodesicDistance([0, 0], first)).toBeCloseTo(
      (Math.PI * EARTH_MEAN_RADIUS_METERS) / 2,
      4,
    );
  });
});
