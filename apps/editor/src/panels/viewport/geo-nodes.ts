/**
 * Projeção dos nós geográficos, por frame.
 *
 * Mesmo lugar e mesmo motivo do passe de efeitos: o renderer não conhece
 * geografia nem câmera, então quem transforma graus em pixels é o aplicativo. O
 * nó chega com um `geoId`; sai com `props.rings` em pixels de tela relativos à
 * âncora dele.
 *
 * Três coisas mantêm o custo dentro do orçamento de 8 ms do
 * [ADR-009](../../../../docs/adr/ADR-009-geo-layers-overlay.md):
 *
 * 1. **Nível de simplificação pelo zoom.** A Ucrânia desenha 75 vértices em z0 e
 *    2.659 em zoom de cidade. O nível é função pura do zoom da câmera avaliada, o
 *    que mantém o determinismo do ADR-003.
 * 2. **Descarte por caixa envolvente.** Território inteiramente fora da vista não
 *    é projetado. O teste é na caixa, em graus, antes de tocar um vértice.
 * 3. **Nada de alocação por vértice.** `forEachVertex` escreve direto no array do
 *    anel, dimensionado antes pela contagem que a malha declara.
 */

import type { EvaluatedScene } from "@theatrum/animation";
import { mat2d, rect, type Rect, type Vec2 } from "@theatrum/core-math";
import { clipBufferSize, clipPolyline, clipRing, type GeoMesh } from "@theatrum/gis";
import type { ScreenScene as LayoutScreenScene } from "@theatrum/scene-graph";
import type { ScreenNode, ScreenScene } from "@theatrum/renderer";
import { geoMeshFor } from "../../geo/geo-data.js";

/** Tipos de nó que este passe alimenta. */
const GEO_NODE_TYPES: ReadonlySet<string> = new Set(["geo.region", "geo.rivers", "geo.roads"]);

export interface GeoDiagnostic {
  readonly nodeId: string;
  readonly geoId: string;
  readonly message: string;
}

export interface GeoExpansion {
  readonly scene: ScreenScene;
  readonly diagnostics: readonly GeoDiagnostic[];
  /** Nós geográficos que contribuíram com geometria neste frame. */
  readonly drawn: number;
  /** Descartados por estarem fora da vista. */
  readonly culled: number;
  readonly vertices: number;
  /** Nível de simplificação em vigor, para o painel de depuração. */
  readonly level: number;
  /**
   * Caixa real da geometria projetada, por nó.
   *
   * O estágio de layout mede o tamanho padrão do nó, então sem isto clique e gizmo
   * apontam para um quadrado de 64 px na âncora em vez do território. Quem monta o
   * frame sobrepõe estas caixas no layout antes de testar clique.
   */
  readonly bounds: ReadonlyMap<string, Rect>;
}

export interface GeoViewport {
  readonly zoom: number;
  /** Caixa visível em graus, folgada. `undefined` desliga o descarte. */
  readonly bounds: { west: number; south: number; east: number; north: number } | undefined;
}

/**
 * Buffers de recorte, vivos entre frames.
 *
 * Módulo em vez de parâmetro porque são detalhe de implementação do passe e
 * crescem sob demanda até o maior anel que a sessão viu. Não guardam estado
 * observável: o conteúdo é sobrescrito a cada anel, então nada aqui influencia o
 * resultado de um frame — o determinismo do ADR-003 fica intacto.
 */
const scratch = {
  degrees: new Float64Array(4096),
  clipped: new Float64Array(8192),
  spare: new Float64Array(8192),
};

function stringProp(props: Readonly<Record<string, unknown>>, key: string): string {
  const value = props[key];
  return typeof value === "string" ? value : "";
}

/**
 * A caixa do território cruza a caixa visível?
 *
 * Comparação em graus, não em pixels: é o teste mais barato que existe, e o erro
 * dele é conservador — na dúvida projeta.
 */
function intersects(
  feature: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  },
  view: GeoViewport["bounds"],
): boolean {
  if (view === undefined) return true;
  return !(
    feature.east < view.west ||
    feature.west > view.east ||
    feature.north < view.south ||
    feature.south > view.north
  );
}

/**
 * Acrescenta `props.rings` a cada nó geográfico da cena.
 *
 * O nó não é criado nem removido aqui: ele já existe na cena de tela, vindo do
 * documento. O que este passe faz é preencher a geometria — e um nó sem geometria
 * desenha nada, o que é o comportamento certo enquanto a malha carrega.
 */
export function expandGeoNodes(
  screen: ScreenScene,
  evaluated: EvaluatedScene,
  layout: LayoutScreenScene,
  viewport: GeoViewport,
  project: (lngLat: Vec2) => Vec2,
): GeoExpansion {
  const owners = screen.drawOrder.filter((nodeId) => {
    const node = screen.nodes.get(nodeId);
    return node !== undefined && GEO_NODE_TYPES.has(node.type);
  });
  if (owners.length === 0) {
    return Object.freeze({
      scene: screen,
      diagnostics: Object.freeze([]),
      drawn: 0,
      culled: 0,
      vertices: 0,
      level: 0,
      bounds: new Map(),
    });
  }

  const nodes = new Map(screen.nodes);
  const diagnostics: GeoDiagnostic[] = [];
  let drawn = 0;
  let culled = 0;
  let vertices = 0;
  let reportedLevel = 0;
  const bounds = new Map<string, Rect>();

  for (const nodeId of owners) {
    const node = screen.nodes.get(nodeId);
    const hostLayout = layout.layouts.get(nodeId);
    const hostEvaluated = evaluated.nodes.get(nodeId);
    if (node === undefined || hostLayout === undefined || hostEvaluated === undefined) continue;
    // Nó invisível não paga projeção.
    if (!hostEvaluated.visible) continue;

    const geoId = stringProp(hostEvaluated.props, "geoId");
    if (geoId === "") continue;

    const mesh: GeoMesh | undefined = geoMeshFor(geoId);
    if (mesh === undefined) continue;
    const feature = mesh.feature(geoId);
    if (feature === undefined) {
      diagnostics.push({
        nodeId,
        geoId,
        message: `Território "${geoId}" não existe na malha "${mesh.layer}".`,
      });
      continue;
    }

    if (!intersects(feature.bounds, viewport.bounds)) {
      culled += 1;
      continue;
    }

    const level = mesh.levelForZoom(viewport.zoom);
    reportedLevel = level;
    const rings: Vec2[][] = [];
    const anchor = hostLayout.anchorPx;
    const closed = node.type === "geo.region";
    const clip = viewport.bounds;

    /**
     * Recorte em graus **antes** de projetar.
     *
     * Sem ele, um anel cuja caixa contém a vista — o continente russo em zoom de
     * cidade — projeta cada vértice para descobrir que nenhum aparece. Com ele, a
     * saída é o que cabe na tela mais os cantos, e a projeção só paga por isso.
     *
     * O buffer de graus é reaproveitado entre anéis e entre frames: o custo de
     * alocação some, que era o motivo de `forEachVertex` não alocar.
     */
    let degrees = scratch.degrees;
    let pending = 0;
    const openRing = (count: number): void => {
      if (degrees.length < count * 2) {
        degrees = new Float64Array(count * 2);
        scratch.degrees = degrees;
      }
      pending = 0;
    };
    const pushDegrees = (lng: number, lat: number): void => {
      degrees[pending * 2] = lng;
      degrees[pending * 2 + 1] = lat;
      pending += 1;
    };

    /** Projeta uma fatia de graus em pixels relativos à âncora. */
    const emit = (source: Float64Array, offset: number, count: number): void => {
      if (count < 2) return;
      const ring = new Array<Vec2>(count);
      for (let index = 0; index < count; index += 1) {
        const screenPoint = project([
          source[(offset + index) * 2] ?? 0,
          source[(offset + index) * 2 + 1] ?? 0,
        ]);
        // Relativo à âncora: é o que faz mover, girar e escalar o território
        // funcionar como em qualquer outro nó.
        ring[index] = [screenPoint[0] - anchor[0], screenPoint[1] - anchor[1]];
      }
      rings.push(ring);
    };

    const flushRing = (): void => {
      if (pending === 0) return;
      if (clip === undefined) {
        emit(degrees, 0, pending);
        pending = 0;
        return;
      }
      const size = clipBufferSize(pending);
      if (scratch.clipped.length < size) {
        scratch.clipped = new Float64Array(size);
        scratch.spare = new Float64Array(size);
      }
      if (closed) {
        const kept = clipRing(degrees, pending, clip, scratch.clipped, scratch.spare);
        // −1 significa que o recorte não caberia no buffer. Projetar o anel inteiro
        // é correto, só mais caro — melhor que geometria truncada.
        if (kept < 0) emit(degrees, 0, pending);
        else if (kept > 0) emit(scratch.clipped, 0, kept);
      } else {
        clipPolyline(degrees, pending, clip, scratch.clipped, (offset, count) => {
          emit(scratch.clipped, offset, count);
        });
      }
      pending = 0;
    };

    mesh.forEachVertex(
      geoId,
      level,
      (_ringIndex, count) => {
        flushRing();
        openRing(count);
      },
      pushDegrees,
      // Descarte por anel: sem ele um país que cruza o antimeridiano projeta o
      // mundo inteiro em qualquer zoom, porque a caixa dele cobre tudo.
      clip,
    );
    flushRing();

    const usable = rings.filter((ring) => ring.length >= 2);
    if (usable.length === 0) continue;
    vertices += usable.reduce((sum, ring) => sum + ring.length, 0);
    drawn += 1;

    /**
     * A extensão real da geometria, e não o tamanho padrão do nó.
     *
     * Sem isto o estágio de layout mede uma caixa de 64×64 pixels na âncora e
     * descarta o nó quando **ela** sai da vista — mesmo com o contorno cruzando a
     * tela inteira. A Rússia era o caso patológico: âncora na Sibéria, caixa
     * minúscula lá, contorno chegando à Europa e ninguém desenhando nada.
     *
     * O descarte de verdade acontece no teste de caixa geográfica logo acima, que
     * é mais barato e vê o território inteiro.
     */
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of usable) {
      for (const point of ring) {
        if (point[0] < minX) minX = point[0];
        if (point[1] < minY) minY = point[1];
        if (point[0] > maxX) maxX = point[0];
        if (point[1] > maxY) maxY = point[1];
      }
    }

    const next: ScreenNode = {
      ...node,
      props: Object.freeze({
        ...node.props,
        rings: Object.freeze(usable.map((ring) => Object.freeze(ring))),
        closed: node.type === "geo.region",
      }),
      layout: Object.freeze({
        ...node.layout,
        /**
         * Devolve a origem local para a âncora. A matriz vem do estágio de
         * layout, onde o pivot é `anchorPoint × tamanho` — 32 px no tamanho
         * padrão de 64. Os anéis, porém, são medidos a partir de `anchorPx`:
         * sem empurrar o pivot de volta, o território inteiro é pintado
         * deslocado da projeção (achado na prova ao vivo do `geo.roads`, 7B).
         * Multiplicar por `translate(pivot)` cancela o `translate(-pivot)` da
         * composição e mantém rotação, escala e skew aplicados sobre a âncora.
         */
        matrix: mat2d.multiply(
          hostLayout.matrix,
          mat2d.translate(
            hostEvaluated.transform.anchorPoint[0] * hostLayout.sizePx[0],
            hostEvaluated.transform.anchorPoint[1] * hostLayout.sizePx[1],
          ),
        ),
        size: [maxX - minX, maxY - minY] as Vec2,
        visible: true,
      }),
    };
    // Volta ao espaço de tela: os anéis são relativos à âncora.
    bounds.set(
      nodeId,
      rect.fromPoints([
        [anchor[0] + minX, anchor[1] + minY],
        [anchor[0] + maxX, anchor[1] + maxY],
      ]),
    );
    nodes.set(nodeId, next);
  }

  return Object.freeze({
    scene:
      drawn === 0 && diagnostics.length === 0 && culled === 0
        ? screen
        : Object.freeze({ ...screen, nodes }),
    diagnostics: Object.freeze(diagnostics),
    drawn,
    culled,
    vertices,
    level: reportedLevel,
    bounds,
  });
}
