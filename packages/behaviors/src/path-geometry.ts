/**
 * `PathData` → segmentos cúbicos + tabela de comprimento de arco.
 *
 * Duas decisões que definem a qualidade do movimento:
 *
 * 1. **A métrica do arco é geodésica em caminhos geo.** Comprimento medido em
 *    graus daria "velocidade uniforme" que acelera ao subir de latitude, porque
 *    um grau de longitude encurta com o cosseno da latitude. Varsóvia→Leningrado
 *    tem 12° de latitude de diferença: o erro seria visível.
 * 2. **Segmento geodésico ignora handles.** Great-circle entre dois pontos não é
 *    uma bezier; ou o segmento é a rota mais curta na esfera, ou é uma curva
 *    desenhada à mão. Misturar os dois produziria um caminho que não é nenhum dos
 *    dois. Aproximamos cada trecho geodésico por uma cadeia de sub-segmentos
 *    retos, densa o suficiente para o erro ficar abaixo de meio pixel na escala
 *    de zoom de composição geopolítica.
 */

import {
  buildArcLengthTable,
  catmullRomToBezier,
  lineSegment,
  type ArcLengthTable,
  type CubicSegment,
  type Vec2,
} from "@theatrum/core-math";
import { geodesicDistance, greatCircleInterpolate } from "@theatrum/gis";
import type { PathData } from "@theatrum/schema";

/** Sub-segmentos por trecho geodésico. 16 mantém o desvio abaixo de 0,05%. */
const GEODESIC_SUBDIVISIONS = 16;

export interface PathGeometry {
  readonly segments: readonly CubicSegment[];
  readonly table: ArcLengthTable;
  /** Metros em caminhos geo; pixels de composição em caminhos comp. */
  readonly totalLength: number;
  readonly space: PathData["space"];
  readonly geodesic: boolean;
  /**
   * Vértices originais de um caminho geodésico. A cadeia de cordas perde a
   * curvatura da esfera — dentro de uma corda a tangente é constante — então o
   * rumo analítico precisa dos extremos de cada trecho de grande-círculo.
   */
  readonly geodesicVertices: readonly Vec2[];
  /** Cordas por trecho geodésico; permite achar o trecho a partir do t global. */
  readonly subdivisions: number;
}

const cache = new WeakMap<PathData, PathGeometry>();

/**
 * Geometria de um caminho, memoizada pela identidade do `PathData`. O documento
 * é imutável: um caminho editado é um objeto novo, então o cache nunca serve
 * dado velho.
 */
export function pathGeometry(path: PathData): PathGeometry {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;

  const geodesic = path.space === "geo" && path.geodesic;
  const segments = geodesic ? geodesicSegments(path) : bezierSegments(path);
  const distance = path.space === "geo" ? geodesicMetres : undefined;
  const table =
    distance === undefined
      ? buildArcLengthTable(segments)
      : buildArcLengthTable(segments, 32, distance);
  const geometry: PathGeometry = Object.freeze({
    segments,
    table,
    totalLength: table.total,
    space: path.space,
    geodesic,
    geodesicVertices: geodesic
      ? Object.freeze(orderedVertices(path).map((point) => [point[0], point[1]] as Vec2))
      : Object.freeze([]),
    subdivisions: GEODESIC_SUBDIVISIONS,
  });
  cache.set(path, geometry);
  return geometry;
}

function geodesicMetres(from: Vec2, to: Vec2): number {
  return geodesicDistance([from[0], from[1]], [to[0], to[1]]);
}

function bezierSegments(path: PathData): readonly CubicSegment[] {
  const points = path.vertices.map((vertex) => vertex.point as Vec2);
  const ordered = path.closed && points.length > 2 ? [...points, points[0] as Vec2] : points;
  if (ordered.length < 2) return Object.freeze([]);

  if (path.interpolation === "linear") {
    return Object.freeze(
      pairs(ordered).map(([from, to]) => lineSegment([from[0], from[1]], [to[0], to[1]])),
    );
  }
  if (path.interpolation === "catmull-rom") {
    // A própria função fecha o anel; passar o ponto inicial duplicado criaria um
    // segmento de comprimento zero.
    return Object.freeze(catmullRomToBezier(points, { closed: path.closed }));
  }

  const segments: CubicSegment[] = [];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const fromVertex = path.vertices[index % path.vertices.length];
    const toVertex = path.vertices[(index + 1) % path.vertices.length];
    const from = ordered[index] as Vec2;
    const to = ordered[index + 1] as Vec2;
    const out = handle(fromVertex?.outHandle);
    const incoming = handle(toVertex?.inHandle);
    if (out === null && incoming === null) {
      segments.push(lineSegment([from[0], from[1]], [to[0], to[1]]));
      continue;
    }
    segments.push({
      p0: [from[0], from[1]],
      c0: out === null ? [from[0], from[1]] : [from[0] + out[0], from[1] + out[1]],
      c1: incoming === null ? [to[0], to[1]] : [to[0] + incoming[0], to[1] + incoming[1]],
      p1: [to[0], to[1]],
    });
  }
  return Object.freeze(segments);
}

/** Pontos na ordem percorrida, fechando o anel quando o caminho é fechado. */
function orderedVertices(path: PathData): readonly Vec2[] {
  const points = path.vertices.map((vertex) => vertex.point as Vec2);
  return path.closed && points.length > 2 ? [...points, points[0] as Vec2] : points;
}

function geodesicSegments(path: PathData): readonly CubicSegment[] {
  const ordered = orderedVertices(path);
  if (ordered.length < 2) return Object.freeze([]);

  const segments: CubicSegment[] = [];
  for (const [from, to] of pairs(ordered)) {
    let previous: Vec2 = [from[0], from[1]];
    for (let step = 1; step <= GEODESIC_SUBDIVISIONS; step += 1) {
      const interpolated = greatCircleInterpolate(
        [from[0], from[1]],
        [to[0], to[1]],
        step / GEODESIC_SUBDIVISIONS,
      );
      const next: Vec2 = [interpolated[0], interpolated[1]];
      segments.push(lineSegment(previous, next));
      previous = next;
    }
  }
  return Object.freeze(segments);
}

function pairs(points: readonly Vec2[]): readonly (readonly [Vec2, Vec2])[] {
  const result: (readonly [Vec2, Vec2])[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    result.push([points[index] as Vec2, points[index + 1] as Vec2]);
  }
  return result;
}

function handle(value: unknown): Vec2 | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value as [unknown, unknown];
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return x === 0 && y === 0 ? null : [x, y];
}
