/**
 * Reparametrização por comprimento de arco.
 *
 * O parâmetro `t` de uma bezier **não** é proporcional a distância: com t
 * avançando de forma uniforme, o objeto acelera nas curvas fechadas e
 * desacelera nas retas. É um erro clássico e muito visível — um comboio que
 * "engasga" a cada curva da estrada.
 *
 * A solução é uma tabela que mapeia distância → t, construída por amostragem.
 * Ver docs/03-DATA-MODEL.md § 7.
 */

import { sampleCubic, type CubicSegment } from "./bezier.js";
import { vec2, type Vec2 } from "./vec.js";

export interface ArcLengthTable {
  /** Comprimento total do caminho. */
  readonly total: number;
  /** Distância acumulada em cada amostra. Monotonicamente não decrescente. */
  readonly distances: Float64Array;
  /** Amostras por segmento. */
  readonly resolution: number;
  readonly segmentCount: number;
}

const DEFAULT_RESOLUTION = 32;

/** Métrica entre duas amostras. Trocá-la é o que permite arco em metros. */
export type DistanceFunction = (from: Vec2, to: Vec2) => number;

/**
 * Constrói a tabela. `resolution` é o número de amostras por segmento — 32 dá
 * erro abaixo de 0,1% em curvas típicas de mapa.
 *
 * `distance` é euclidiana por padrão. Um caminho em lng/lat precisa de uma
 * métrica geodésica: um grau de longitude encurta com a latitude, e comprimento
 * em graus daria velocidade "uniforme" que acelera indo para o norte. A função
 * entra por parâmetro para que este pacote continue sem dependência de `gis`.
 */
export function buildArcLengthTable(
  segments: readonly CubicSegment[],
  resolution = DEFAULT_RESOLUTION,
  distance: DistanceFunction = vec2.distance,
): ArcLengthTable {
  const segmentCount = segments.length;

  if (segmentCount === 0) {
    return { total: 0, distances: Float64Array.of(0), resolution, segmentCount: 0 };
  }

  const sampleCount = segmentCount * resolution + 1;
  const distances = new Float64Array(sampleCount);

  let accumulated = 0;
  let previous = (segments[0] as CubicSegment).p0;
  distances[0] = 0;

  for (let s = 0; s < segmentCount; s++) {
    const segment = segments[s] as CubicSegment;
    for (let i = 1; i <= resolution; i++) {
      const point = sampleCubic(segment, i / resolution);
      accumulated += distance(previous, point);
      distances[s * resolution + i] = accumulated;
      previous = point;
    }
  }

  return { total: accumulated, distances, resolution, segmentCount };
}

/**
 * Distância → parâmetro global `t` em [0, segmentCount].
 *
 * A parte inteira é o índice do segmento; a fracionária é o t local.
 *
 * INVARIANT: monotônica. Distância crescente nunca produz t decrescente —
 * sem isso, o objeto andaria para trás no meio do movimento.
 */
export function arcLengthToT(table: ArcLengthTable, distance: number): number {
  const { distances, resolution, segmentCount, total } = table;

  if (segmentCount === 0) return 0;
  if (distance <= 0) return 0;
  if (distance >= total) return segmentCount;

  // Busca binária pelo primeiro índice cuja distância acumulada >= distance.
  let low = 0;
  let high = distances.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((distances[mid] as number) < distance) low = mid + 1;
    else high = mid;
  }

  if (low === 0) return 0;

  const before = distances[low - 1] as number;
  const after = distances[low] as number;
  const span = after - before;

  // Span zero acontece com pontos repetidos no path. Interpolar dividiria por
  // zero; alinhar na amostra anterior mantém a monotonicidade.
  const localFraction = span === 0 ? 0 : (distance - before) / span;

  return (low - 1 + localFraction) / resolution;
}

/** Conveniência: fração do caminho [0,1] → t global. */
export function progressToT(table: ArcLengthTable, progress: number): number {
  return arcLengthToT(table, progress * table.total);
}

/**
 * Amostra o caminho em t global. Segmento = parte inteira, t local = fração.
 */
export function samplePath(segments: readonly CubicSegment[], globalT: number): Vec2 {
  const count = segments.length;
  if (count === 0) return [0, 0];

  if (globalT <= 0) return (segments[0] as CubicSegment).p0;
  if (globalT >= count) return (segments[count - 1] as CubicSegment).p1;

  const index = Math.floor(globalT);
  const local = globalT - index;
  return sampleCubic(segments[index] as CubicSegment, local);
}

/** Tangente do caminho em t global. */
export function pathTangent(segments: readonly CubicSegment[], globalT: number): Vec2 {
  const count = segments.length;
  if (count === 0) return [1, 0];

  const clamped = Math.max(0, Math.min(count - 1e-9, globalT));
  const index = Math.min(count - 1, Math.floor(clamped));
  const local = clamped - index;

  // Importado localmente para manter a dependência de bezier.ts explícita
  // apenas onde é usada.
  return cubicTangentAt(segments[index] as CubicSegment, local);
}

function cubicTangentAt(segment: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const dx =
    3 * u * u * (segment.c0[0] - segment.p0[0]) +
    6 * u * t * (segment.c1[0] - segment.c0[0]) +
    3 * t * t * (segment.p1[0] - segment.c1[0]);
  const dy =
    3 * u * u * (segment.c0[1] - segment.p0[1]) +
    6 * u * t * (segment.c1[1] - segment.c0[1]) +
    3 * t * t * (segment.p1[1] - segment.c1[1]);

  if (dx * dx + dy * dy > 1e-18) return [dx, dy];
  return vec2.sub(segment.p1, segment.p0);
}
