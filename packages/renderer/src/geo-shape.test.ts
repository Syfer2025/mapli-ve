/**
 * Provas da primitiva de geometria geográfica.
 *
 * O ponto que ela existe para resolver: um país é MultiPolygon. A Rússia tem
 * cerca de cem anéis contando ilhas, e `PolygonPrimitive` só carrega um contorno.
 * Estes testes verificam que os anéis chegam inteiros ao backend e que
 * preenchimento e contorno são de fato independentes — é o que permite "só
 * contorno" e "só preenchimento" no mesmo tipo de nó.
 */

import { MAT2D_IDENTITY } from "@theatrum/core-math";
import { describe, expect, it } from "vitest";
import { evaluateBuiltinVisual } from "./builtins.js";
import { visualPlacement } from "./placement.js";
import type { GeoShapePrimitive, NodeLayout, ScreenNode } from "./contracts.js";

const LAYOUT: NodeLayout = {
  matrix: MAT2D_IDENTITY,
  size: [100, 100],
  opacity: 1,
  visible: true,
  blendMode: "normal",
};

function node(type: string, props: Readonly<Record<string, unknown>>): ScreenNode {
  return { id: "nd_geo", type, slot: "scene", props, layout: LAYOUT };
}

function geoShapeOf(type: string, props: Readonly<Record<string, unknown>>): GeoShapePrimitive {
  const visual = evaluateBuiltinVisual(type as "geo.region", node(type, props));
  if (visual.kind !== "geo-shape") throw new Error(`esperava geo-shape, veio ${visual.kind}`);
  return visual;
}

/** Continente com um buraco e uma ilha separada. */
const RINGS = [
  [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
  [
    [200, 10],
    [230, 10],
    [230, 40],
  ],
];

describe("primitiva de geometria geográfica", () => {
  it("os anéis atravessam inteiros, sem fundir nem perder", () => {
    const visual = geoShapeOf("geo.region", { rings: RINGS });
    expect(visual.rings).toHaveLength(2);
    expect(visual.rings[0]).toHaveLength(4);
    expect(visual.rings[1]).toHaveLength(3);
    expect(visual.rings[0]?.[2]).toEqual([100, 100]);
  });

  it("região fecha o anel; rio e estradas não", () => {
    expect(geoShapeOf("geo.region", { rings: RINGS }).closed).toBe(true);
    expect(geoShapeOf("geo.rivers", { rings: RINGS, closed: false }).closed).toBe(false);
    expect(geoShapeOf("geo.roads", { rings: RINGS, closed: false }).closed).toBe(false);
    // Só `false` explícito abre; ausência fecha.
    expect(geoShapeOf("geo.rivers", { rings: RINGS }).closed).toBe(true);
  });

  it("preenchimento e contorno são independentes", () => {
    const soContorno = geoShapeOf("geo.region", { rings: RINGS, fillAlpha: 0 });
    expect(soContorno.fillAlpha).toBe(0);
    expect(soContorno.strokeWidth).toBeGreaterThan(0);

    const soPreenchimento = geoShapeOf("geo.region", { rings: RINGS, strokeWidth: 0 });
    expect(soPreenchimento.strokeWidth).toBe(0);
    expect(soPreenchimento.fillAlpha).toBeGreaterThan(0);

    // Opacidade do contorno é separada da espessura: dá para esmaecer a linha
    // sem afiná-la.
    const linhaFraca = geoShapeOf("geo.region", { rings: RINGS, strokeAlpha: 0.15 });
    expect(linhaFraca.strokeAlpha).toBeCloseTo(0.15, 6);
    expect(linhaFraca.strokeWidth).toBeGreaterThan(0);
  });

  it("o alfa embutido no hexadecimal de oito dígitos vira opacidade", () => {
    const visual = geoShapeOf("geo.region", { rings: RINGS, fill: "#ff000080" });
    expect(visual.fill).toBe("#ff0000");
    expect(visual.fillAlpha).toBeCloseTo(128 / 255, 4);
    // Opacidade explícita manda sobre o alfa do hexadecimal.
    const explicito = geoShapeOf("geo.region", { rings: RINGS, fill: "#ff000080", fillAlpha: 1 });
    expect(explicito.fillAlpha).toBe(1);
  });

  it("sem anéis o nó desenha nada, em vez de um contorno inventado", () => {
    // Região cujo território não resolveu tem de sumir. Um polígono padrão no
    // meio do mapa seria pior que nada: parece dado, e não é.
    expect(geoShapeOf("geo.region", {}).rings).toEqual([]);
    expect(geoShapeOf("geo.region", { rings: "nada" }).rings).toEqual([]);
    expect(geoShapeOf("geo.region", { rings: [] }).rings).toEqual([]);
  });

  it("anel malformado é descartado sem derrubar os vizinhos", () => {
    const visual = geoShapeOf("geo.region", {
      rings: [
        RINGS[0],
        [[10, 10]],
        "lixo",
        [
          [0, 0],
          [1, Number.NaN],
        ],
        RINGS[1],
      ],
    });
    // Sobra o primeiro e o último: um anel de um ponto não é geometria, e o que
    // tem NaN foi rejeitado inteiro pelo leitor de pontos.
    expect(visual.rings).toHaveLength(2);
    expect(visual.rings[0]).toHaveLength(4);
    expect(visual.rings[1]).toHaveLength(3);
  });

  it("a geometria carrega deslocamento próprio: o placement não recentraliza", () => {
    // Se o placement centralizasse, o contorno inteiro sairia do lugar — os
    // anéis já vêm relativos à âncora do território.
    const placement = visualPlacement(geoShapeOf("geo.region", { rings: RINGS }), LAYOUT.size);
    expect(placement.position).toEqual([0, 0]);
    expect(placement.anchor).toEqual([0, 0]);
  });
});
