/**
 * Provas da geometria de rota. O que importa aqui não é "a função devolve
 * pontos" — é que ela devolve os pontos **certos** nos casos que quebram
 * implementações ingênuas: vértices amontoados, rota curta demais para a cabeça,
 * dobra de 180°, offset negativo, segmento de comprimento zero.
 */

import { describe, expect, it } from "vitest";
import {
  arrowHead,
  dashPolyline,
  endDirection,
  fatArrow,
  measurePolyline,
  pointAtDistance,
  trimPolyline,
} from "./polyline.js";
import type { Vec2 } from "./vec.js";

/** Reta horizontal de 100 px com vértices deliberadamente desiguais. */
const DESIGUAL: readonly Vec2[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [100, 0],
];

const L: readonly Vec2[] = [
  [0, 0],
  [100, 0],
  [100, 100],
];

function area(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index] as Vec2;
    const b = polygon[(index + 1) % polygon.length] as Vec2;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function totalLength(segments: readonly (readonly Vec2[])[]): number {
  let sum = 0;
  for (const segment of segments) sum += measurePolyline(segment).total;
  return sum;
}

describe("measurePolyline", () => {
  it("acumula o comprimento de cada segmento", () => {
    const measure = measurePolyline(L);
    expect(measure.cumulative).toEqual([0, 100, 200]);
    expect(measure.total).toBe(200);
  });

  it("dá total zero para um ponto só, sem quebrar", () => {
    expect(measurePolyline([[5, 5]]).total).toBe(0);
    expect(measurePolyline([]).total).toBe(0);
  });
});

describe("pointAtDistance", () => {
  it("interpola dentro do segmento, não salta de vértice em vértice", () => {
    expect(pointAtDistance(L, measurePolyline(L), 150)).toEqual([100, 50]);
  });

  it("grampeia nas duas pontas", () => {
    const measure = measurePolyline(L);
    expect(pointAtDistance(L, measure, -50)).toEqual([0, 0]);
    expect(pointAtDistance(L, measure, 9999)).toEqual([100, 100]);
  });

  it("sobrevive a vértice repetido, que faria NaN numa divisão direta", () => {
    const repetido: readonly Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 0],
      [20, 0],
    ];
    const point = pointAtDistance(repetido, measurePolyline(repetido), 10);
    expect(Number.isFinite(point[0])).toBe(true);
    expect(point).toEqual([10, 0]);
  });
});

describe("trimPolyline", () => {
  it("mede por comprimento, não por índice — é o que faz a revelação ser lisa", () => {
    // DESIGUAL tem quatro vértices nos primeiros 3 px e o último a 100. Cortar
    // pela metade por ÍNDICE devolveria x = 2; por comprimento, x = 50.
    const half = trimPolyline(DESIGUAL, 0, 0.5);
    expect((half[half.length - 1] as Vec2)[0]).toBeCloseTo(50, 9);
  });

  it("preserva as quinas do caminho original dentro do intervalo", () => {
    const trimmed = trimPolyline(L, 0, 0.75);
    // O vértice do cotovelo tem de continuar lá: reamostrar arredondaria a quina
    // que o autor desenhou.
    expect(trimmed).toContainEqual([100, 0]);
    expect(trimmed[trimmed.length - 1]).toEqual([100, 50]);
  });

  it("aceita as frações em qualquer ordem", () => {
    expect(trimPolyline(L, 0.75, 0.25)).toEqual(trimPolyline(L, 0.25, 0.75));
  });

  it("intervalo vazio devolve nada — e não a rota inteira", () => {
    expect(trimPolyline(L, 0.5, 0.5)).toEqual([]);
    expect(trimPolyline(L, -1, 0)).toEqual([]);
  });

  it("o comprimento revelado cresce monotonicamente com a fração", () => {
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const length = measurePolyline(trimPolyline(L, 0, step / 20)).total;
      expect(length).toBeGreaterThanOrEqual(previous);
      previous = length;
    }
    expect(previous).toBeCloseTo(200, 9);
  });
});

describe("endDirection", () => {
  it("aponta ao longo do último trecho com movimento", () => {
    expect(endDirection(L)).toEqual([0, 1]);
  });

  it("ignora a cauda degenerada que um recorte quase sempre deixa", () => {
    // Um trim que cai exatamente sobre um vértice termina com dois pontos
    // praticamente iguais. Usar os dois últimos daria uma direção de ruído.
    const comCauda: readonly Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 1e-12],
    ];
    const direction = endDirection(comCauda);
    // O que prova o ponto é ter pulado a cauda: usando os dois últimos pontos a
    // direção seria [0, 1] — perpendicular à rota, noventa graus errada.
    expect(direction[0]).toBeCloseTo(1, 9);
    expect(direction[1]).toBeCloseTo(0, 9);
  });

  it("devolve uma direção válida mesmo sem nenhum movimento", () => {
    const parado = endDirection([
      [7, 7],
      [7, 7],
    ]);
    expect(Number.isFinite(parado[0])).toBe(true);
    expect(Math.hypot(...parado)).toBeCloseTo(1, 9);
  });
});

describe("arrowHead", () => {
  it("põe a ponta no fim da rota e as abas atrás dela", () => {
    const head = arrowHead(
      [
        [0, 0],
        [100, 0],
      ],
      20,
    );
    expect(head[0]).toEqual([100, 0]);
    // Rota para leste: as duas abas ficam a oeste da ponta.
    expect((head[1] as Vec2)[0]).toBeLessThan(100);
    expect((head[2] as Vec2)[0]).toBeLessThan(100);
    // E simétricas em relação ao eixo.
    expect((head[1] as Vec2)[1]).toBeCloseTo(-(head[2] as Vec2)[1], 9);
  });

  it("gira junto com a rota", () => {
    const paraNorte = arrowHead(
      [
        [0, 0],
        [0, -100],
      ],
      20,
    );
    expect(paraNorte[0]).toEqual([0, -100]);
    // Rota para o norte (y decrescente): abas ao sul da ponta.
    expect((paraNorte[1] as Vec2)[1]).toBeGreaterThan(-100);
    expect((paraNorte[2] as Vec2)[1]).toBeGreaterThan(-100);
  });

  it("abre mais com meio-ângulo maior", () => {
    const linha: readonly Vec2[] = [
      [0, 0],
      [100, 0],
    ];
    const largura = (spread: number) => {
      const head = arrowHead(linha, 20, spread);
      return Math.abs((head[1] as Vec2)[1] - (head[2] as Vec2)[1]);
    };
    expect(largura(35)).toBeGreaterThan(largura(15));
  });

  it("não desenha nada com tamanho zero ou rota vazia", () => {
    expect(arrowHead(L, 0)).toEqual([]);
    expect(arrowHead([], 20)).toEqual([]);
  });
});

describe("fatArrow", () => {
  const options = { bodyWidth: 20, headWidth: 48, headLength: 40 };

  it("fecha um polígono com área e com a ponta no fim da rota", () => {
    const polygon = fatArrow(
      [
        [0, 0],
        [200, 0],
      ],
      options,
    );
    expect(polygon.length).toBeGreaterThan(4);
    expect(polygon).toContainEqual([200, 0]);
    expect(area(polygon)).toBeGreaterThan(0);
  });

  it("a cabeça é mais larga que o corpo — senão não é seta", () => {
    const polygon = fatArrow(
      [
        [0, 0],
        [200, 0],
      ],
      options,
    );
    const ys = polygon.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(24, 6);
    expect(Math.min(...ys)).toBeCloseTo(-24, 6);
  });

  it("numa rota curta a cabeça é limitada, e o polígono não se dobra", () => {
    // Cabeça de 40 px pedida numa rota de 10: sem limite, a base cairia 30 px
    // ANTES do início e o polígono viraria uma ampulheta de área errada.
    const curta = fatArrow(
      [
        [0, 0],
        [10, 0],
      ],
      options,
    );
    expect(curta.length).toBeGreaterThan(4);
    for (const point of curta) {
      expect(point[0]).toBeGreaterThanOrEqual(-1e-6);
      expect(point[0]).toBeLessThanOrEqual(10 + 1e-6);
    }
    expect(area(curta)).toBeGreaterThan(0);
  });

  it("acompanha a curva em vez de virar um retângulo", () => {
    const curvada = fatArrow(L, options);
    // Existe vértice depois do cotovelo: a seta dobrou junto.
    expect(curvada.some((point) => point[1] > 40)).toBe(true);
  });

  it("mantém a largura na quina, sem pinçar", () => {
    // A bissetriz é o que impede o lado de dentro de atravessar o de fora. Com
    // a normal do segmento seguinte apenas, a área desabaria na dobra.
    const reta = area(
      fatArrow(
        [
          [0, 0],
          [200, 0],
        ],
        options,
      ),
    );
    const dobrada = area(
      fatArrow(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        options,
      ),
    );
    // Mesmo comprimento total: as áreas ficam na mesma ordem de grandeza.
    expect(dobrada).toBeGreaterThan(reta * 0.6);
  });

  it("cabeça mais estreita que o corpo é elevada ao corpo, não invertida", () => {
    const polygon = fatArrow(
      [
        [0, 0],
        [200, 0],
      ],
      { bodyWidth: 30, headWidth: 10, headLength: 40 },
    );
    const ys = polygon.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(15, 6);
  });

  it("recusa entrada sem geometria", () => {
    expect(fatArrow([[0, 0]], options)).toEqual([]);
    expect(
      fatArrow(
        [
          [5, 5],
          [5, 5],
        ],
        options,
      ),
    ).toEqual([]);
  });
});

describe("dashPolyline", () => {
  it("cobre aproximadamente a fração dash/(dash+gap) do comprimento", () => {
    const linha: readonly Vec2[] = [
      [0, 0],
      [1000, 0],
    ];
    const coberto = totalLength(dashPolyline(linha, 10, 10));
    expect(coberto).toBeGreaterThan(1000 * 0.42);
    expect(coberto).toBeLessThan(1000 * 0.58);
  });

  it("nenhum traço escapa do caminho", () => {
    for (const segment of dashPolyline(L, 13, 7, 21)) {
      for (const point of segment) {
        expect(point[0]).toBeGreaterThanOrEqual(-1e-6);
        expect(point[0]).toBeLessThanOrEqual(100 + 1e-6);
        expect(point[1]).toBeGreaterThanOrEqual(-1e-6);
        expect(point[1]).toBeLessThanOrEqual(100 + 1e-6);
      }
    }
  });

  it("o padrão anda com o offset — é a formiguinha", () => {
    const linha: readonly Vec2[] = [
      [0, 0],
      [1000, 0],
    ];
    const parado = dashPolyline(linha, 20, 20, 0);
    const andado = dashPolyline(linha, 20, 20, 7);
    expect(JSON.stringify(andado)).not.toBe(JSON.stringify(parado));
    // Um período inteiro de deslocamento reproduz o padrão original.
    const umCiclo = dashPolyline(linha, 20, 20, 40);
    expect(totalLength(umCiclo)).toBeCloseTo(totalLength(parado), 6);
  });

  it("offset negativo não estoura nem some — o módulo em JS mantém o sinal", () => {
    const linha: readonly Vec2[] = [
      [0, 0],
      [500, 0],
    ];
    const negativo = dashPolyline(linha, 20, 20, -137);
    expect(negativo.length).toBeGreaterThan(5);
    for (const segment of negativo) {
      expect(segment[0]?.[0]).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("intervalo zero devolve a linha inteira em vez de nada", () => {
    expect(dashPolyline(L, 10, 0)).toEqual([L]);
  });

  it("preserva as quinas dentro de um traço longo", () => {
    const [primeiro] = dashPolyline(L, 500, 100);
    expect(primeiro).toContainEqual([100, 0]);
  });
});
