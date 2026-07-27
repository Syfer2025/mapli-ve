/**
 * Leitor da malha geográfica compilada por `tools/build-geo.ts`.
 *
 * Formato e motivos em [ADR-010](../../../docs/adr/ADR-010-precompiled-geo-mesh.md).
 * Aqui só a leitura, e ela é **pura**: recebe o índice e os bytes já carregados,
 * nunca toca disco nem rede. Quem lê arquivo é a shell.
 *
 * Duas coisas justificam este módulo existir em vez de o consumidor mexer no
 * buffer direto:
 *
 * 1. **A geometria sai sem alocar.** `forEachVertex` percorre uma fatia contígua
 *    do buffer e chama de volta com graus. Um contorno de país tem milhares de
 *    vértices e é relido a cada frame — devolver arrays novos seria pressão de GC
 *    proporcional ao movimento da câmera.
 * 2. **O nível de simplificação é função pura do zoom.** Nada de estado entre
 *    frames, senão quebra o [ADR-003](../../../docs/adr/ADR-003-determinism.md):
 *    o mesmo frame tem de dar o mesmo contorno, venha do preview ou do export.
 */

import type { GeoBounds, LngLat } from "./types.js";

/** Versão de formato que este leitor entende. Ver `MESH_FORMAT_VERSION`. */
export const GEO_MESH_FORMAT_VERSION = 1;

export type GeoFeatureKind = "country" | "state" | "river";

export interface GeoRingEntry {
  /** Índice do primeiro vértice no buffer, em vértices — não em bytes. */
  readonly offset: number;
  readonly count: number;
  /** Caixa do anel, `[oeste, sul, leste, norte]`. Ver `tools/build-geo.ts`. */
  readonly bbox: readonly number[];
}

/** Caixa visível para descarte, em graus. */
export interface GeoViewBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface GeoFeatureEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly props: Readonly<Record<string, string>>;
  /** `[oeste, sul, leste, norte]` em graus. */
  readonly bbox: readonly number[];
  /** Ponto representativo em graus, do maior anel. Ver `tools/build-geo.ts`. */
  readonly center: readonly number[];
  readonly rings: readonly GeoRingEntry[];
  /** Vértices que sobrevivem em cada nível, do mais grosseiro ao mais fino. */
  readonly levelCounts: readonly number[];
}

export interface GeoMeshIndex {
  readonly version: number;
  readonly layer: string;
  readonly kind: string;
  readonly coordinateScale: number;
  readonly levelTolerances: readonly number[];
  readonly levelMinZoom: readonly number[];
  readonly vertexCount: number;
  readonly features: readonly GeoFeatureEntry[];
}

export class GeoMeshError extends Error {
  readonly code: "version" | "size" | "unknown-feature";

  constructor(code: "version" | "size" | "unknown-feature", message: string) {
    super(message);
    this.name = "GeoMeshError";
    this.code = code;
  }
}

/** Metadados de uma feição, sem geometria. */
export interface GeoFeature {
  readonly id: string;
  readonly name: string;
  readonly kind: GeoFeatureKind;
  readonly props: Readonly<Record<string, string>>;
  readonly bounds: GeoBounds;
  /**
   * Âncora padrão do nó que usa a feição: o ponto representativo do maior anel,
   * não o centro da caixa. Para Rússia, EUA e Fiji a caixa vai de −180 a 180 por
   * causa do antimeridiano, e o centro dela cairia no oceano errado.
   */
  readonly center: LngLat;
  readonly ringCount: number;
  readonly vertexCount: number;
}

export interface GeoMesh {
  readonly layer: string;
  readonly featureCount: number;
  /** Níveis disponíveis, do mais grosseiro ao mais fino. */
  readonly levelCount: number;
  has(id: string): boolean;
  feature(id: string): GeoFeature | undefined;
  list(): readonly GeoFeature[];
  /**
   * Nível de simplificação para um zoom de câmera. Função pura: nenhuma
   * dependência de estado ou de frame anterior.
   */
  levelForZoom(zoom: number): number;
  /** Quantos vértices a feição desenha no nível pedido. */
  vertexCountAt(id: string, level: number): number;
  /**
   * Percorre os vértices de cada anel no nível pedido, em graus.
   *
   * `onRing` abre um anel e recebe quantos vértices ele terá; `onVertex` recebe
   * cada um. Nenhuma alocação por vértice.
   */
  forEachVertex(
    id: string,
    level: number,
    onRing: (ringIndex: number, vertexCount: number) => void,
    onVertex: (lng: number, lat: number) => void,
    /**
     * Descarte por anel. Cada anel cuja caixa não cruza a vista é pulado antes de
     * um único vértice ser lido — o que importa para país que cruza o
     * antimeridiano, cuja caixa de feição cobre o mundo e nunca descartaria.
     */
    view?: GeoViewBounds,
  ): void;
}

function boundsOf(bbox: readonly number[]): GeoBounds {
  return Object.freeze({
    west: bbox[0] ?? 0,
    south: bbox[1] ?? 0,
    east: bbox[2] ?? 0,
    north: bbox[3] ?? 0,
  });
}

/** Cruzamento de caixas em graus: o teste mais barato que existe, e conservador. */
function ringInView(ring: GeoRingEntry, view: GeoViewBounds): boolean {
  const west = ring.bbox[0] ?? -180;
  const south = ring.bbox[1] ?? -90;
  const east = ring.bbox[2] ?? 180;
  const north = ring.bbox[3] ?? 90;
  return !(east < view.west || west > view.east || north < view.south || south > view.north);
}

function isFeatureKind(value: string): value is GeoFeatureKind {
  return value === "country" || value === "state" || value === "river";
}

/**
 * Abre a malha sobre um buffer já carregado.
 *
 * O layout é: `vertexCount` pares de Int32 pequeno-endian com as coordenadas
 * escaladas, seguidos de `vertexCount` bytes com o nível de cada vértice. Se o
 * tamanho não bater exatamente, falha — binário truncado desenharia um contorno
 * plausível e errado, que é o pior modo de falhar.
 */
export function createGeoMesh(index: GeoMeshIndex, bytes: ArrayBuffer): GeoMesh {
  if (index.version !== GEO_MESH_FORMAT_VERSION) {
    throw new GeoMeshError(
      "version",
      `Malha "${index.layer}" está na versão ${index.version}; este leitor entende ${GEO_MESH_FORMAT_VERSION}.`,
    );
  }
  const expected = index.vertexCount * 9;
  if (bytes.byteLength !== expected) {
    throw new GeoMeshError(
      "size",
      `Malha "${index.layer}" deveria ter ${expected} bytes para ${index.vertexCount} vértices, veio com ${bytes.byteLength}.`,
    );
  }

  const coordinates = new Int32Array(bytes, 0, index.vertexCount * 2);
  const levels = new Uint8Array(bytes, index.vertexCount * 8, index.vertexCount);
  const inverseScale = 1 / index.coordinateScale;
  const levelCount = index.levelTolerances.length + 1;

  const entries = new Map<string, GeoFeatureEntry>();
  const features: GeoFeature[] = [];
  for (const entry of index.features) {
    entries.set(entry.id, entry);
    const vertexCount = entry.rings.reduce((sum, ring) => sum + ring.count, 0);
    features.push(
      Object.freeze({
        id: entry.id,
        name: entry.name,
        kind: isFeatureKind(entry.kind) ? entry.kind : "country",
        props: entry.props,
        bounds: boundsOf(entry.bbox),
        center: Object.freeze([entry.center[0] ?? 0, entry.center[1] ?? 0] as const) as LngLat,
        ringCount: entry.rings.length,
        vertexCount,
      }),
    );
  }
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const frozenList = Object.freeze(features);

  function requireEntry(id: string): GeoFeatureEntry {
    const entry = entries.get(id);
    if (entry === undefined) {
      throw new GeoMeshError(
        "unknown-feature",
        `Feição "${id}" não existe na malha "${index.layer}".`,
      );
    }
    return entry;
  }

  function clampLevel(level: number): number {
    if (!Number.isFinite(level)) return levelCount - 1;
    const rounded = Math.round(level);
    return rounded < 0 ? 0 : rounded > levelCount - 1 ? levelCount - 1 : rounded;
  }

  return {
    layer: index.layer,
    featureCount: features.length,
    levelCount,

    has(id: string): boolean {
      return entries.has(id);
    },

    feature(id: string): GeoFeature | undefined {
      return byId.get(id);
    },

    list(): readonly GeoFeature[] {
      return frozenList;
    },

    levelForZoom(zoom: number): number {
      if (!Number.isFinite(zoom)) return levelCount - 1;
      // O nível mais fino cujo zoom mínimo o zoom atual já alcançou.
      let chosen = 0;
      for (let level = 0; level < index.levelMinZoom.length; level += 1) {
        if (zoom >= (index.levelMinZoom[level] ?? 0)) chosen = level;
      }
      // Acima do último limiar entra a malha cheia, que é o nível extra.
      const last = index.levelMinZoom[index.levelMinZoom.length - 1] ?? 0;
      if (zoom >= last + 2) chosen = levelCount - 1;
      return chosen;
    },

    vertexCountAt(id: string, level: number): number {
      const entry = requireEntry(id);
      return entry.levelCounts[clampLevel(level)] ?? 0;
    },

    forEachVertex(
      id: string,
      level: number,
      onRing: (ringIndex: number, vertexCount: number) => void,
      onVertex: (lng: number, lat: number) => void,
      view?: GeoViewBounds,
    ): void {
      const entry = requireEntry(id);
      const wanted = clampLevel(level);
      for (let ringIndex = 0; ringIndex < entry.rings.length; ringIndex += 1) {
        const ring = entry.rings[ringIndex];
        if (ring === undefined) continue;
        if (view !== undefined && !ringInView(ring, view)) continue;
        // Contar antes de abrir o anel: quem desenha precisa dimensionar o buffer
        // sem uma segunda passada.
        let surviving = 0;
        for (let k = 0; k < ring.count; k += 1) {
          if ((levels[ring.offset + k] ?? 0) <= wanted) surviving += 1;
        }
        // Anel que perde tudo menos um ou dois pontos não é polígono; some.
        if (surviving < 3) continue;
        onRing(ringIndex, surviving);
        for (let k = 0; k < ring.count; k += 1) {
          const vertex = ring.offset + k;
          if ((levels[vertex] ?? 0) > wanted) continue;
          onVertex(
            (coordinates[vertex * 2] ?? 0) * inverseScale,
            (coordinates[vertex * 2 + 1] ?? 0) * inverseScale,
          );
        }
      }
    },
  };
}
