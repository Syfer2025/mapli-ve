/**
 * Junção espacial da compilação de estradas: em que país está este segmento.
 *
 * Justificado em [ADR-011](../../../docs/adr/ADR-011-roads-spatial-join.md): o
 * Natural Earth só preenche `sov_a3` na América do Norte e Central — 85% dos
 * vértices de estrada do mundo não têm soberano — então a malha de estradas é
 * agrupada pelo país que contém o **ponto médio** de cada segmento.
 *
 * Duas escolhas carregam o peso deste módulo:
 *
 * 1. **Candidatos em ordem crescente de área de caixa.** O país mais local é
 *    testado primeiro, e o primeiro que contém o ponto ganha. Isso resolve
 *    enclave (Lesoto dentro da África do Sul) para o polígono menor e mantém a
 *    Rússia — cuja caixa vai de −180 a 180 e é candidata a todo ponto da Terra —
 *    fora do caminho quente: ela só é testada quando nenhum país menor reclamou.
 * 2. **Par-ímpar sobre todos os anéis da feição.** Buracos (raros em países)
 *    invertem corretamente. Anéis cuja caixa não pode contribuir cruzamentos para
 *    o raio que vai para leste são pulados sem mudar o resultado.
 *
 * Tudo aqui é puro e determinístico: a mesma entrada produz a mesma atribuição
 * em qualquer máquina, que é o que o `--verify` do build cobra.
 */

import type { LngLat } from "./types.js";

/** Anel com a caixa pronta, para o descarte antes do par-ímpar. */
export interface JoinRing {
  /** Pontos `[lng, lat]` em graus. */
  readonly points: readonly (readonly number[])[];
  /** `[oeste, sul, leste, norte]`. */
  readonly bbox: readonly [number, number, number, number];
}

/** Polígono candidato a conter pontos, com os anéis já medidos. */
export interface JoinPolygon {
  readonly id: string;
  /** Caixa da feição inteira — o primeiro filtro, antes de tocar num anel. */
  readonly bbox: readonly [number, number, number, number];
  readonly rings: readonly JoinRing[];
}

function bboxOfRing(points: readonly (readonly number[])[]): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of points) {
    const lng = point[0] ?? 0;
    const lat = point[1] ?? 0;
    if (lng < west) west = lng;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

function bboxArea(bbox: readonly [number, number, number, number]): number {
  return ((bbox[2] ?? 0) - (bbox[0] ?? 0)) * ((bbox[3] ?? 0) - (bbox[1] ?? 0));
}

/**
 * Prepara os polígonos candidatos a partir de feições cruas.
 *
 * A ordenação — área de caixa crescente, id como desempate — é parte da
 * decisão (ver o cabeçalho): estável e independente da ordem do arquivo.
 */
export function prepareJoinPolygons(
  features: readonly {
    readonly id: string;
    readonly rings: readonly (readonly (readonly number[])[])[];
  }[],
): readonly JoinPolygon[] {
  const polygons: JoinPolygon[] = features.map((feature) => {
    const rings: JoinRing[] = feature.rings.map((points) => ({
      points,
      bbox: bboxOfRing(points),
    }));
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const ring of rings) {
      if (ring.bbox[0] < west) west = ring.bbox[0];
      if (ring.bbox[1] < south) south = ring.bbox[1];
      if (ring.bbox[2] > east) east = ring.bbox[2];
      if (ring.bbox[3] > north) north = ring.bbox[3];
    }
    return { id: feature.id, bbox: [west, south, east, north], rings };
  });
  // Estável: o sort do JS preserva a ordem relativa em empate, então o desempate
  // por id precisa ser explícito.
  polygons.sort((a, b) => {
    const byArea = bboxArea(a.bbox) - bboxArea(b.bbox);
    return byArea !== 0 ? byArea : a.id.localeCompare(b.id);
  });
  return polygons;
}

/**
 * O ponto está dentro do polígono? Par-ímpar com raio para leste, sobre todos
 * os anéis — um buraco inverte o resultado, como deve.
 *
 * O raio horizontal torna o descarte por anel seguro: um anel cuja faixa de
 * latitudes não cobre o ponto nunca cruza o raio, e um anel inteiramente a
 * oeste só produziria interseções com longitude menor que a do ponto, que a
 * condição par-ímpar descartaria de qualquer forma.
 */
export function pointInPolygon(lng: number, lat: number, polygon: JoinPolygon): boolean {
  const bbox = polygon.bbox;
  if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) return false;

  let inside = false;
  for (const ring of polygon.rings) {
    const rb = ring.bbox;
    if (lat < rb[1] || lat > rb[3] || lng > rb[2]) continue;
    const points = ring.points;
    const count = points.length;
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const xi = points[i]?.[0] ?? 0;
      const yi = points[i]?.[1] ?? 0;
      const xj = points[j]?.[0] ?? 0;
      const yj = points[j]?.[1] ?? 0;
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * O primeiro polígono que contém o ponto, na ordem da mais local à mais ampla,
 * ou `undefined` quando nenhum contém — rota de ferry, mar ou terra disputada.
 */
export function containingPolygon(
  lngLat: LngLat | readonly number[],
  polygons: readonly JoinPolygon[],
): JoinPolygon | undefined {
  const lng = lngLat[0] ?? 0;
  const lat = lngLat[1] ?? 0;
  for (const polygon of polygons) {
    if (pointInPolygon(lng, lat, polygon)) return polygon;
  }
  return undefined;
}
