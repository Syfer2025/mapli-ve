/**
 * Geometria de polilinha: recorte por comprimento, tracejado e setas.
 *
 * É o instrumento clássico do mapa de guerra — a seta de avanço — reduzido ao
 * que ele realmente é: contas sobre uma lista de pontos. Fica em L0, sem GPU e
 * sem projeção, porque cada uma destas funções é uma **função pura** e o
 * [ADR-003](../../../docs/adr/ADR-003-determinism.md) exige que o desenho seja
 * reprodutível a partir de (documento, frame).
 *
 * Todas medem por **comprimento de arco**, nunca por índice de vértice. A
 * diferença aparece na primeira revelação animada: um caminho com vértices
 * amontoados numa curva e esparsos na reta revelaria devagar na curva e rápido
 * na reta, e a cabeça da seta andaria aos trancos.
 *
 * O espaço é o da entrada — pixels de tela para uma rota projetada. Nada aqui
 * sabe o que é latitude.
 */

import { clamp, clamp01 } from "./scalar.js";
import type { Vec2 } from "./vec.js";

/** Comprimento acumulado por vértice. `total` é o último acumulado. */
export interface PolylineMeasure {
  /** `cumulative[i]` é a distância do início até o vértice `i`. */
  readonly cumulative: readonly number[];
  readonly total: number;
}

export function measurePolyline(points: readonly Vec2[]): PolylineMeasure {
  const cumulative: number[] = [0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cumulative.push(total);
  }
  return { cumulative, total };
}

/**
 * Ponto a uma distância do início, interpolado dentro do segmento.
 *
 * Busca linear e não binária de propósito: as polilinhas aqui têm dezenas de
 * vértices, e `pointAtDistance` é chamada poucas vezes por rota — a árvore de
 * decisão de uma busca binária custaria mais em legibilidade do que economiza.
 */
export function pointAtDistance(
  points: readonly Vec2[],
  measure: PolylineMeasure,
  distance: number,
): Vec2 {
  if (points.length === 0) return [0, 0];
  const first = points[0] as Vec2;
  if (points.length === 1 || distance <= 0) return [first[0], first[1]];
  if (distance >= measure.total) {
    const last = points[points.length - 1] as Vec2;
    return [last[0], last[1]];
  }
  for (let index = 1; index < points.length; index += 1) {
    const end = measure.cumulative[index] as number;
    if (distance > end) continue;
    const start = measure.cumulative[index - 1] as number;
    const span = end - start;
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    // Segmento de comprimento zero: vértices repetidos. Devolver o começo evita
    // uma divisão por zero que viraria NaN e apagaria a rota inteira.
    const t = span <= 0 ? 0 : (distance - start) / span;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  const last = points[points.length - 1] as Vec2;
  return [last[0], last[1]];
}

/**
 * O trecho entre duas frações de comprimento. É a revelação animada: `trim` de
 * 0 → 1 desenha a rota crescendo.
 *
 * Os vértices originais **dentro** do intervalo são preservados; só as pontas
 * são interpoladas. Reamostrar tudo suavizaria as quinas do caminho desenhado à
 * mão, que é justamente a informação que o autor colocou ali.
 */
export function trimPolyline(points: readonly Vec2[], from: number, to: number): readonly Vec2[] {
  if (points.length < 2) return points;
  const start = clamp01(Math.min(from, to));
  const end = clamp01(Math.max(from, to));
  if (end - start <= 0) return [];
  const measure = measurePolyline(points);
  if (measure.total <= 0) return [];
  const startDistance = start * measure.total;
  const endDistance = end * measure.total;
  const result: Vec2[] = [pointAtDistance(points, measure, startDistance)];
  for (let index = 0; index < points.length; index += 1) {
    const at = measure.cumulative[index] as number;
    if (at > startDistance && at < endDistance) result.push(points[index] as Vec2);
  }
  result.push(pointAtDistance(points, measure, endDistance));
  return result;
}

/**
 * Direção de marcha no fim do trecho, normalizada.
 *
 * Olha para trás até encontrar um vértice a distância não nula — não basta usar
 * os dois últimos pontos. Uma polilinha recortada quase sempre termina com um
 * ponto interpolado colado no vértice anterior, e a diferença entre eles é ruído
 * de ponto flutuante: a seta apontaria para uma direção aleatória no frame em
 * que a revelação passa por um vértice.
 */
export function endDirection(points: readonly Vec2[]): Vec2 {
  const last = points[points.length - 1];
  if (last === undefined) return [1, 0];
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const previous = points[index] as Vec2;
    const dx = last[0] - previous[0];
    const dy = last[1] - previous[1];
    const length = Math.hypot(dx, dy);
    if (length > 1e-6) return [dx / length, dy / length];
  }
  return [1, 0];
}

/**
 * Triângulo da ponta de seta, em coordenadas absolutas.
 *
 * `spreadDeg` é o **meio-ângulo** entre o eixo e cada aba: 30° dá a seta larga
 * de mapa militar, 15° dá a fina de diagrama.
 */
export function arrowHead(
  points: readonly Vec2[],
  sizePx: number,
  spreadDeg = 26,
): readonly Vec2[] {
  const tip = points[points.length - 1];
  if (tip === undefined || sizePx <= 0) return [];
  const [dx, dy] = endDirection(points);
  const spread = (clamp(spreadDeg, 1, 89) * Math.PI) / 180;
  const cos = Math.cos(spread);
  const sin = Math.sin(spread);
  // Duas rotações do vetor **de volta** (−d) pelo meio-ângulo, para cada lado.
  const back: Vec2 = [-dx * sizePx, -dy * sizePx];
  return [
    [tip[0], tip[1]],
    [tip[0] + back[0] * cos - back[1] * sin, tip[1] + back[0] * sin + back[1] * cos],
    [tip[0] + back[0] * cos + back[1] * sin, tip[1] - back[0] * sin + back[1] * cos],
  ];
}

export interface FatArrowOptions {
  /** Largura do corpo, em pixels. */
  readonly bodyWidth: number;
  /** Largura total da base da cabeça. Menor que o corpo não faz seta. */
  readonly headWidth: number;
  /** Comprimento da cabeça ao longo do caminho. */
  readonly headLength: number;
}

/**
 * A seta de avanço preenchida: um polígono só, fechado, pronto para preencher.
 *
 * A ordem dos vértices é a que um preenchimento espera — lado esquerdo do início
 * até a base da cabeça, aba esquerda, ponta, aba direita, e o lado direito de
 * volta. Emitir os dois lados em ordens independentes produziria uma ampulheta.
 *
 * **A cabeça nunca engole o corpo.** Numa rota curta — ou nos primeiros frames de
 * uma revelação — o comprimento pedido para a cabeça é maior que o caminho
 * inteiro. Sem limite, a base da cabeça cairia antes do início e o polígono se
 * dobraria sobre si mesmo. O limite é 70% do total: sobra corpo suficiente para a
 * forma continuar lendo como seta.
 */
export function fatArrow(points: readonly Vec2[], options: FatArrowOptions): readonly Vec2[] {
  if (points.length < 2) return [];
  const measure = measurePolyline(points);
  if (measure.total <= 0) return [];
  const headLength = Math.min(Math.max(options.headLength, 0), measure.total * 0.7);
  const bodyWidth = Math.max(options.bodyWidth, 0);
  const headWidth = Math.max(options.headWidth, bodyWidth);
  const bodyEnd = measure.total - headLength;

  // Corpo: os vértices originais até `bodyEnd`, mais o ponto exato do corte.
  const spine: Vec2[] = [points[0] as Vec2];
  for (let index = 1; index < points.length; index += 1) {
    const at = measure.cumulative[index] as number;
    if (at < bodyEnd) spine.push(points[index] as Vec2);
  }
  spine.push(pointAtDistance(points, measure, bodyEnd));

  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const half = bodyWidth / 2;
  for (let index = 0; index < spine.length; index += 1) {
    const normal = spineNormal(spine, index);
    const here = spine[index] as Vec2;
    left.push([here[0] + normal[0] * half, here[1] + normal[1] * half]);
    right.push([here[0] - normal[0] * half, here[1] - normal[1] * half]);
  }

  const tip = points[points.length - 1] as Vec2;
  const baseCenter = spine[spine.length - 1] as Vec2;
  const baseNormal = spineNormal(spine, spine.length - 1);
  const headHalf = headWidth / 2;

  return [
    ...left,
    [baseCenter[0] + baseNormal[0] * headHalf, baseCenter[1] + baseNormal[1] * headHalf],
    [tip[0], tip[1]],
    [baseCenter[0] - baseNormal[0] * headHalf, baseCenter[1] - baseNormal[1] * headHalf],
    ...right.reverse(),
  ];
}

/**
 * Normal unitária num vértice da espinha, pela média das direções vizinhas.
 *
 * Usar só o segmento seguinte deixaria a largura pinçar nas quinas: o lado de
 * dentro da curva atravessa o de fora. A média das duas direções é a bissetriz,
 * e é o que mantém a largura visualmente constante numa curva fechada.
 */
function spineNormal(spine: readonly Vec2[], index: number): Vec2 {
  const here = spine[index] as Vec2;
  const previous = spine[index - 1];
  const next = spine[index + 1];
  let dx = 0;
  let dy = 0;
  if (previous !== undefined) {
    const length = Math.hypot(here[0] - previous[0], here[1] - previous[1]);
    if (length > 1e-9) {
      dx += (here[0] - previous[0]) / length;
      dy += (here[1] - previous[1]) / length;
    }
  }
  if (next !== undefined) {
    const length = Math.hypot(next[0] - here[0], next[1] - here[1]);
    if (length > 1e-9) {
      dx += (next[0] - here[0]) / length;
      dy += (next[1] - here[1]) / length;
    }
  }
  const length = Math.hypot(dx, dy);
  // Vértice degenerado, ou uma dobra de exatamente 180°, onde as duas direções
  // se cancelam. Uma perpendicular qualquer é melhor que NaN.
  if (length <= 1e-9) return [0, 1];
  return [-dy / length, dx / length];
}

/**
 * Quebra a polilinha no padrão tracejado, devolvendo um traço por segmento.
 *
 * `offsetPx` desliza o padrão ao longo do caminho — animado, é a "formiguinha"
 * que dá sentido de marcha à rota sem mover a rota. O deslocamento é normalizado
 * para dentro de um período: sem isso, um keyframe de 0 a 10 000 px faria a
 * função percorrer dez mil ciclos por frame só para chegar no mesmo lugar.
 */
export function dashPolyline(
  points: readonly Vec2[],
  dashPx: number,
  gapPx: number,
  offsetPx = 0,
): readonly (readonly Vec2[])[] {
  const dash = Math.max(dashPx, 0.01);
  const gap = Math.max(gapPx, 0);
  if (points.length < 2) return [];
  if (gap <= 0) return [points];
  const measure = measurePolyline(points);
  if (measure.total <= 0) return [];

  const period = dash + gap;
  // Módulo que sobrevive a offset negativo: `%` em JS mantém o sinal.
  const phase = ((offsetPx % period) + period) % period;
  const result: Vec2[][] = [];
  // Cursor sobre os vértices, compartilhado por todos os traços. Os traços saem
  // em ordem crescente de distância, então nunca é preciso voltar — e sem o
  // cursor cada traço reiniciava a varredura do começo, o que faz o custo
  // crescer com dashes × vértices em vez de dashes + vértices.
  let cursor = 0;
  // Começa um período atrás para que um traço cortado pela origem apareça pela
  // metade, como num padrão contínuo — e não sumindo até o próximo ciclo.
  for (let start = -phase - period; start < measure.total; start += period) {
    const from = Math.max(0, start);
    const to = Math.min(measure.total, start + dash);
    if (to <= from) continue;
    const segment: Vec2[] = [pointAtDistance(points, measure, from)];
    while (cursor < points.length && (measure.cumulative[cursor] as number) <= from) cursor += 1;
    for (let index = cursor; index < points.length; index += 1) {
      if ((measure.cumulative[index] as number) >= to) break;
      segment.push(points[index] as Vec2);
    }
    segment.push(pointAtDistance(points, measure, to));
    result.push(segment);
  }
  return result;
}
