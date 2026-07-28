/**
 * Resolve para onde cada rótulo aponta, por frame.
 *
 * Mesmo lugar e motivo dos passes de efeito e de geografia: o renderer não
 * conhece cena nem câmera. O nó chega com um alvo — outro nó ou um ponto de
 * caminho — e sai com `leader`, o vetor da caixa até o alvo em pixels relativos à
 * própria origem.
 *
 * **Por que resolver aqui e não no avaliador.** O alvo pode ser um `model3d`
 * cuja posição vem de `motion-path`, ou um ponto de caminho que só existe depois
 * da projeção. Nos dois casos a resposta depende da câmera daquele frame, que o
 * avaliador não vê. Resolver depois do layout é o único ponto onde o dado existe.
 *
 * **Sem atraso de um frame.** O passe roda no mesmo frame do layout que o
 * produziu, lendo `layout.layouts`, não o frame anterior. Rótulo que arrasta
 * atrás do objeto é o defeito clássico deste recurso, e ele nasce de ler estado
 * velho.
 */

import type { EvaluatedScene } from "@theatrum/animation";
import { pathGeometry, pointAt } from "@theatrum/behaviors";
import { mat2d, type Mat2D, type Vec2 } from "@theatrum/core-math";
import type { ScreenScene as LayoutScreenScene } from "@theatrum/scene-graph";
import type { PathData } from "@theatrum/schema";
import type { ScreenNode, ScreenScene } from "@theatrum/renderer";

const CALLOUT_TYPE = "label.callout";

export interface CalloutDiagnostic {
  readonly nodeId: string;
  readonly message: string;
}

export interface CalloutExpansion {
  readonly scene: ScreenScene;
  readonly diagnostics: readonly CalloutDiagnostic[];
  /** Rótulos que acharam o alvo e desenharam guia. */
  readonly anchored: number;
  /** Rótulos presentes que não acharam alvo — desenham sem guia. */
  readonly loose: number;
}

function stringProp(props: Readonly<Record<string, unknown>>, key: string): string {
  const value = props[key];
  return typeof value === "string" ? value : "";
}

function numberProp(
  props: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Onde o nó alvo aparece na tela.
 *
 * Usa a **âncora** projetada, não o centro da caixa: um modelo 3D grande tem
 * caixa que muda com o ângulo da câmera, e a guia ficaria tremendo. A âncora é o
 * ponto que o usuário posicionou.
 */
function targetPoint(layout: LayoutScreenScene, nodeId: string): Vec2 | null {
  const entry = layout.layouts.get(nodeId);
  return entry === undefined ? null : [entry.anchorPx[0], entry.anchorPx[1]];
}

/** Ponto de um caminho, em pixels de tela. */
function pathPoint(
  path: PathData,
  progress: number,
  project: (lngLat: Vec2) => Vec2,
  compToScreen: Mat2D,
): Vec2 | null {
  const geometry = pathGeometry(path);
  if (geometry.segments.length === 0) return null;
  const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const point = pointAt(geometry, clamped);
  return path.space === "geo"
    ? project([point[0], point[1]])
    : mat2d.applyPoint(compToScreen, point);
}

/**
 * Acrescenta `leader` a cada rótulo da cena.
 *
 * Rótulo sem alvo não é erro: ele desenha a caixa na própria âncora, sem guia. É
 * o comportamento certo para uma legenda solta, que também é um uso legítimo.
 */
export function expandCalloutNodes(
  screen: ScreenScene,
  evaluated: EvaluatedScene,
  layout: LayoutScreenScene,
  paths: Readonly<Record<string, PathData>>,
  compToScreen: Mat2D,
  project: (lngLat: Vec2) => Vec2,
): CalloutExpansion {
  const owners = screen.drawOrder.filter(
    (nodeId) => screen.nodes.get(nodeId)?.type === CALLOUT_TYPE,
  );
  if (owners.length === 0) {
    return Object.freeze({
      scene: screen,
      diagnostics: Object.freeze([]),
      anchored: 0,
      loose: 0,
    });
  }

  const nodes = new Map(screen.nodes);
  const diagnostics: CalloutDiagnostic[] = [];
  let anchored = 0;
  let loose = 0;

  for (const nodeId of owners) {
    const node = screen.nodes.get(nodeId);
    const own = layout.layouts.get(nodeId);
    const state = evaluated.nodes.get(nodeId);
    if (node === undefined || own === undefined || state === undefined) continue;
    if (!state.visible) continue;

    const targetId = stringProp(state.props, "targetId");
    const pathId = stringProp(state.props, "pathId");
    const offsetX = numberProp(state.props, "offsetX", 0);
    const offsetY = numberProp(state.props, "offsetY", 0);

    let target: Vec2 | null = null;
    if (targetId !== "" && targetId !== nodeId) {
      target = targetPoint(layout, targetId);
      if (target === null) {
        diagnostics.push({
          nodeId,
          message: `O objeto alvo "${targetId}" não está neste frame; o rótulo fica sem guia.`,
        });
      }
    } else if (pathId !== "") {
      const path = paths[pathId];
      if (path === undefined) {
        diagnostics.push({
          nodeId,
          message: `O caminho "${pathId}" não existe; o rótulo fica sem guia.`,
        });
      } else {
        target = pathPoint(path, numberProp(state.props, "progress", 0.5), project, compToScreen);
      }
    }

    /**
     * A caixa fica no alvo mais o afastamento; a guia volta do canto da caixa até
     * o alvo. Ambos em coordenada local do nó, porque é assim que a primitiva os
     * consome — e a matriz do layout põe tudo no lugar.
     */
    const boxScreen: Vec2 =
      target === null
        ? [own.anchorPx[0], own.anchorPx[1]]
        : [target[0] + offsetX, target[1] + offsetY];
    const leader: Vec2 | null = target === null ? null : [-offsetX, -offsetY];

    if (target === null) loose += 1;
    else anchored += 1;

    /**
     * O nó é reposicionado pela matriz, não pela âncora do documento: mover o
     * rótulo é consequência de onde o alvo está, e escrever na âncora sujaria o
     * documento a cada frame.
     */
    const [a, b, c, d] = own.matrix;
    nodes.set(nodeId, {
      ...node,
      props: Object.freeze({ ...node.props, leader }),
      layout: Object.freeze({
        ...node.layout,
        matrix: [a, b, c, d, boxScreen[0], boxScreen[1]] as Mat2D,
        visible: true,
      }),
    } satisfies ScreenNode);
  }

  return Object.freeze({
    scene: Object.freeze({ ...screen, nodes }),
    diagnostics: Object.freeze(diagnostics),
    anchored,
    loose,
  });
}
