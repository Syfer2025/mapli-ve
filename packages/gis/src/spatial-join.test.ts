/**
 * Provas da junção espacial do ADR-011. O que importa não é a geometria de
 * ponto-no-polígono em si — é que a atribuição seja **determinística e justa**:
 * enclave vai para o polígono menor, antimeridiano não confunde, e ponto em mar
 * aberto não é inventado como território.
 */

import { describe, expect, it } from "vitest";
import {
  containingPolygon,
  pointInPolygon,
  prepareJoinPolygons,
  type JoinPolygon,
} from "./spatial-join.js";

/** Quadrado fechado no sentido anti-horário, canto sudoeste em (x, y). */
function square(x: number, y: number, side: number): readonly (readonly number[])[] {
  return [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
    [x, y],
  ];
}

function polygonOf(id: string, rings: readonly (readonly (readonly number[])[])[]): JoinPolygon {
  const prepared = prepareJoinPolygons([{ id, rings }]);
  const polygon = prepared[0];
  if (polygon === undefined) throw new Error("preparação devolveu vazio");
  return polygon;
}

describe("pointInPolygon", () => {
  it("dentro de um quadrado simples", () => {
    expect(pointInPolygon(5, 5, polygonOf("a", [square(0, 0, 10)]))).toBe(true);
  });

  it("fora de um quadrado simples", () => {
    expect(pointInPolygon(15, 5, polygonOf("a", [square(0, 0, 10)]))).toBe(false);
  });

  it("buraco inverte: ponto no buraco está fora", () => {
    const withHole = polygonOf("a", [square(0, 0, 20), square(5, 5, 10)]);
    expect(pointInPolygon(10, 10, withHole)).toBe(false);
    expect(pointInPolygon(2, 2, withHole)).toBe(true);
  });

  it("anéis partidos no antimeridiano: os dois lados contam", () => {
    // Rússia de brinquedo: um anel de 170 a 180 e outro de −180 a −170.
    const split = polygonOf("a", [square(170, 0, 10), square(-180, 0, 10)]);
    expect(pointInPolygon(175, 5, split)).toBe(true);
    expect(pointInPolygon(-175, 5, split)).toBe(true);
    expect(pointInPolygon(0, 5, split)).toBe(false);
  });

  it("caixa da feição exclui antes de tocar num anel", () => {
    // Um ponto ao norte de tudo: fora mesmo com anel estreito apontando para lá.
    expect(pointInPolygon(5, 50, polygonOf("a", [square(0, 0, 10)]))).toBe(false);
  });
});

describe("prepareJoinPolygons + containingPolygon", () => {
  it("enclave resolve para o polígono menor, não para o que o contém", () => {
    // Lesoto de brinquedo dentro da África do Sul de brinquedo.
    const polygons = prepareJoinPolygons([
      { id: "c:ZAF", rings: [square(0, 0, 20)] },
      { id: "c:LSO", rings: [square(8, 8, 4)] },
    ]);
    expect(containingPolygon([10, 10], polygons)?.id).toBe("c:LSO");
    expect(containingPolygon([2, 2], polygons)?.id).toBe("c:ZAF");
  });

  it("a ordem é estável independente da ordem de entrada", () => {
    const first = prepareJoinPolygons([
      { id: "c:BBB", rings: [square(0, 0, 10)] },
      { id: "c:AAA", rings: [square(20, 20, 10)] },
    ]);
    const second = prepareJoinPolygons([
      { id: "c:AAA", rings: [square(20, 20, 10)] },
      { id: "c:BBB", rings: [square(0, 0, 10)] },
    ]);
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id));
  });

  it("caixa que cobre o mundo é testada por último", () => {
    // Rússia de brinquedo com caixa de −180 a 180, como a real.
    const polygons = prepareJoinPolygons([
      { id: "c:RUS", rings: [square(-180, 0, 360)] },
      { id: "c:UKR", rings: [square(22, 44, 10)] },
    ]);
    expect(containingPolygon([27, 49], polygons)?.id).toBe("c:UKR");
  });

  it("ponto em mar aberto não pertence a ninguém", () => {
    const polygons = prepareJoinPolygons([{ id: "c:UKR", rings: [square(22, 44, 10)] }]);
    expect(containingPolygon([-30, -20], polygons)).toBeUndefined();
  });

  it("determinismo: a mesma entrada atribui igual em chamadas repetidas", () => {
    const polygons = prepareJoinPolygons([
      { id: "c:DEU", rings: [square(5, 47, 10)] },
      { id: "c:FRA", rings: [square(-5, 42, 10)] },
    ]);
    const point = [7, 48] as const;
    const a = containingPolygon(point, polygons)?.id;
    const b = containingPolygon(point, polygons)?.id;
    expect(a).toBe("c:DEU");
    expect(a).toBe(b);
  });
});
