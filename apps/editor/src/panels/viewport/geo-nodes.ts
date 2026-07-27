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
import type { Vec2 } from "@theatrum/core-math";
import type { GeoMesh } from "@theatrum/gis";
import type { ScreenScene as LayoutScreenScene } from "@theatrum/scene-graph";
import type { ScreenNode, ScreenScene } from "@theatrum/renderer";
import { geoMeshFor } from "../../geo/geo-data.js";

/** Tipos de nó que este passe alimenta. */
const GEO_NODE_TYPES: ReadonlySet<string> = new Set(["geo.region", "geo.rivers"]);

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
}

export interface GeoViewport {
  readonly zoom: number;
  /** Caixa visível em graus, folgada. `undefined` desliga o descarte. */
  readonly bounds: { west: number; south: number; east: number; north: number } | undefined;
}

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
    });
  }

  const nodes = new Map(screen.nodes);
  const diagnostics: GeoDiagnostic[] = [];
  let drawn = 0;
  let culled = 0;
  let vertices = 0;
  let reportedLevel = 0;

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
    let current: Vec2[] | undefined;
    const anchor = hostLayout.anchorPx;

    mesh.forEachVertex(
      geoId,
      level,
      (_ringIndex, count) => {
        // Dimensionar antes: a malha já sabe quantos vértices o anel terá neste
        // nível, então o array nasce do tamanho final.
        current = new Array<Vec2>(count);
        (current as { length: number }).length = 0;
        rings.push(current);
      },
      (lng, lat) => {
        if (current === undefined) return;
        const screenPoint = project([lng, lat]);
        // Relativo à âncora: é o que faz mover, girar e escalar o território
        // funcionar como em qualquer outro nó.
        current.push([screenPoint[0] - anchor[0], screenPoint[1] - anchor[1]]);
      },
      // Descarte por anel: sem ele um país que cruza o antimeridiano projeta o
      // mundo inteiro em qualquer zoom, porque a caixa dele cobre tudo.
      viewport.bounds,
    );

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
        size: [maxX - minX, maxY - minY] as Vec2,
        visible: true,
      }),
    };
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
  });
}
