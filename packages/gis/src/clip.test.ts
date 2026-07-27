/**
 * Provas do recorte. O que importa não é o número de vértices que sai: é que o
 * polígono continue **fechado e no lugar**. Recorte que abre o anel faz o
 * preenchimento vazar pela tela inteira, e é um defeito que só aparece em pixel.
 */

import { describe, expect, it } from "vitest";
import { clipBufferSize, clipPolyline, clipRing, type ClipBounds } from "./clip.js";

const VIEW: ClipBounds = { west: 0, south: 0, east: 10, north: 10 };

function flat(points: readonly (readonly [number, number])[]): Float64Array {
  const array = new Float64Array(clipBufferSize(points.length + 8));
  points.forEach(([x, y], index) => {
    array[index * 2] = x;
    array[index * 2 + 1] = y;
  });
  return array;
}

function ringOf(points: readonly (readonly [number, number])[], bounds = VIEW) {
  const input = flat(points);
  const size = clipBufferSize(points.length + 8);
  const output = new Float64Array(size);
  const scratch = new Float64Array(size);
  const count = clipRing(input, points.length, bounds, output, scratch);
  const result: [number, number][] = [];
  for (let index = 0; index < count; index += 1) {
    result.push([output[index * 2] ?? 0, output[index * 2 + 1] ?? 0]);
  }
  return result;
}

/** Área assinada: zero significa anel degenerado, e sinal indica orientação. */
function area(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index] ?? [0, 0];
    const [x2, y2] = points[(index + 1) % points.length] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

describe("recorte de anel fechado", () => {
  it("anel inteiramente dentro passa intacto", () => {
    const original: readonly [number, number][] = [
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
    ];
    expect(ringOf(original)).toEqual([...original]);
  });

  it("anel inteiramente fora desaparece", () => {
    expect(
      ringOf([
        [20, 20],
        [30, 20],
        [30, 30],
      ]),
    ).toEqual([]);
    // Também do outro lado, e em diagonal.
    expect(
      ringOf([
        [-30, -30],
        [-20, -30],
        [-20, -20],
      ]),
    ).toEqual([]);
  });

  it("anel maior que a vista devolve exatamente a vista", () => {
    // É o caso que motivou o módulo: um país cobrindo a tela inteira em zoom de
    // cidade. Quatro cantos em vez de 25 mil vértices.
    const recortado = ringOf([
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ]);
    expect(recortado).toHaveLength(4);
    expect(Math.abs(area(recortado))).toBeCloseTo(100, 6);
    for (const [x, y] of recortado) {
      expect(x).toBeGreaterThanOrEqual(VIEW.west - 1e-9);
      expect(x).toBeLessThanOrEqual(VIEW.east + 1e-9);
      expect(y).toBeGreaterThanOrEqual(VIEW.south - 1e-9);
      expect(y).toBeLessThanOrEqual(VIEW.north + 1e-9);
    }
  });

  it("anel que atravessa continua fechado, com os cantos inseridos", () => {
    const recortado = ringOf([
      [-5, 5],
      [15, 5],
      [15, 15],
      [-5, 15],
    ]);
    // A faixa horizontal entra pela esquerda e sai pela direita: o recorte tem de
    // inserir as duas interseções e o topo da caixa, senão o anel abre.
    expect(recortado.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(area(recortado))).toBeGreaterThan(0);
    for (const [x, y] of recortado) {
      expect(x).toBeGreaterThanOrEqual(VIEW.west - 1e-9);
      expect(x).toBeLessThanOrEqual(VIEW.east + 1e-9);
      expect(y).toBeGreaterThanOrEqual(VIEW.south - 1e-9);
      expect(y).toBeLessThanOrEqual(VIEW.north + 1e-9);
    }
  });

  it("a área preservada é a interseção, não uma aproximação", () => {
    // Metade esquerda dentro, metade direita fora: sobra metade da área.
    const recortado = ringOf([
      [-10, 2],
      [5, 2],
      [5, 8],
      [-10, 8],
    ]);
    // A parte visível vai de x=0 a x=5 e y=2 a y=8: 5 × 6 = 30.
    expect(Math.abs(area(recortado))).toBeCloseTo(30, 6);
  });

  it("orientação se preserva: recorte não inverte o anel", () => {
    const antiHorario: readonly [number, number][] = [
      [-5, -5],
      [15, -5],
      [15, 15],
      [-5, 15],
    ];
    const horario = [...antiHorario].reverse();
    expect(Math.sign(area(ringOf(antiHorario)))).toBe(Math.sign(area(antiHorario)));
    expect(Math.sign(area(ringOf(horario)))).toBe(Math.sign(area(horario)));
  });

  it("anel com menos de três vértices não é polígono", () => {
    expect(ringOf([[1, 1]])).toEqual([]);
    expect(
      ringOf([
        [1, 1],
        [2, 2],
      ]),
    ).toEqual([]);
  });

  it("anel que entra e sai duas vezes é recusado: SH pintaria área inexistente", () => {
    /**
     * Este teste existe por um defeito visto em pixel, não em asserção. A Rússia
     * recortada pintava Belarus e o Báltico ao longo de uma linha reta na borda da
     * vista: Sutherland–Hodgham devolve **um** anel para geometria concava que sai
     * e volta, ligando os pedaços pela borda. Recusar é o certo — o chamador
     * projeta o anel inteiro.
     *
     * A forma abaixo é um "U" deitado que atravessa a caixa duas vezes: dois
     * braços dentro, o meio fora pela direita.
     */
    const u: readonly [number, number][] = [
      [-5, 1],
      [20, 1],
      [20, 3],
      [5, 3],
      [5, 7],
      [20, 7],
      [20, 9],
      [-5, 9],
    ];
    const input = flat(u);
    const size = clipBufferSize(u.length);
    expect(clipRing(input, u.length, VIEW, new Float64Array(size), new Float64Array(size))).toBe(
      -1,
    );
  });

  it("uma entrada e uma saída são seguras e continuam sendo recortadas", () => {
    // O caso comum: fronteira atravessando a vista uma vez. Aqui SH acerta, e
    // recusar seria jogar fora o ganho todo.
    const recortado = ringOf([
      [-5, 2],
      [5, 2],
      [5, 8],
      [-5, 8],
    ]);
    expect(recortado.length).toBeGreaterThan(0);
    expect(Math.abs(area(recortado))).toBeCloseTo(30, 6);
  });

  it("vista inteiramente dentro do anel: zero travessias, recorte trivial", () => {
    // É o caso que motivou o módulo — e o que mais economiza. Nenhuma travessia,
    // então nada de recusa: sai a vista, com quatro cantos.
    const recortado = ringOf([
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ]);
    expect(recortado).toHaveLength(4);
  });

  it("buffer apertado é recusado com −1, em vez de corromper memória", () => {
    const pontos: [number, number][] = [];
    for (let step = 0; step < 40; step += 1) {
      const angle = (step / 40) * Math.PI * 2;
      const radius = step % 2 === 0 ? 20 : 3;
      pontos.push([5 + Math.cos(angle) * radius, 5 + Math.sin(angle) * radius]);
    }
    const input = flat(pontos);
    // Deliberadamente pequeno: o resultado não cabe.
    const aperto = new Float64Array(12);
    expect(clipRing(input, pontos.length, VIEW, aperto, new Float64Array(12))).toBe(-1);
  });

  it("a estrela que cruza os quatro lados muitas vezes cabe no dimensionamento", () => {
    // Anel em estrela que cruza os quatro lados muitas vezes: o pior caso de
    // inserção de interseções.
    const pontos: [number, number][] = [];
    for (let step = 0; step < 40; step += 1) {
      const angle = (step / 40) * Math.PI * 2;
      const radius = step % 2 === 0 ? 20 : 3;
      pontos.push([5 + Math.cos(angle) * radius, 5 + Math.sin(angle) * radius]);
    }
    const input = flat(pontos);
    const size = clipBufferSize(pontos.length);
    const output = new Float64Array(size);
    const scratch = new Float64Array(size);
    // Não estourar é a prova: ou cabe, ou recusa com −1. Nunca escreve fora.
    const count = clipRing(input, pontos.length, VIEW, output, scratch);
    expect(count).not.toBe(0);
    if (count > 0) expect(count * 2).toBeLessThanOrEqual(size);
  });
});

describe("recorte de polilinha aberta", () => {
  function piecesOf(points: readonly (readonly [number, number])[], bounds = VIEW) {
    const input = flat(points);
    const output = new Float64Array(clipBufferSize(points.length * 2 + 8));
    const pieces: [number, number][][] = [];
    clipPolyline(input, points.length, bounds, output, (offset, count) => {
      const piece: [number, number][] = [];
      for (let index = 0; index < count; index += 1) {
        piece.push([output[(offset + index) * 2] ?? 0, output[(offset + index) * 2 + 1] ?? 0]);
      }
      pieces.push(piece);
    });
    return pieces;
  }

  it("linha inteiramente dentro volta como um pedaço só", () => {
    const pieces = piecesOf([
      [1, 1],
      [5, 5],
      [9, 2],
    ]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toHaveLength(3);
  });

  it("linha que entra e sai duas vezes volta como dois pedaços", () => {
    // Um rio que atravessa a vista, sai, e volta a entrar.
    const pieces = piecesOf([
      [-5, 5],
      [4, 5],
      [15, 5],
      [15, 8],
      [4, 8],
      [-5, 8],
    ]);
    expect(pieces).toHaveLength(2);
    // Nenhum pedaço liga a nascente à foz por fora da caixa: é o que
    // Sutherland–Hodgman faria de errado aqui.
    for (const piece of pieces) {
      for (const [x, y] of piece) {
        expect(x).toBeGreaterThanOrEqual(VIEW.west - 1e-9);
        expect(x).toBeLessThanOrEqual(VIEW.east + 1e-9);
        expect(y).toBeGreaterThanOrEqual(VIEW.south - 1e-9);
        expect(y).toBeLessThanOrEqual(VIEW.north + 1e-9);
      }
    }
  });

  it("linha inteiramente fora não devolve pedaço", () => {
    expect(
      piecesOf([
        [-20, -20],
        [-15, -18],
      ]),
    ).toEqual([]);
  });

  it("segmento que só atravessa a caixa devolve a travessia", () => {
    const pieces = piecesOf([
      [-10, 5],
      [20, 5],
    ]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.[0]?.[0]).toBeCloseTo(0, 6);
    expect(pieces[0]?.[1]?.[0]).toBeCloseTo(10, 6);
  });

  it("linha de um ponto não é linha", () => {
    expect(piecesOf([[5, 5]])).toEqual([]);
  });
});
