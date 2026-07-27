import type { Mat2D, Vec2 } from "@theatrum/core-math";
import type { NodeMatte, ScreenNode, ScreenScene, SlotId } from "./contracts.js";
import { RendererError } from "./errors.js";

export interface EvaluatedRenderableNodeLike<
  P extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
  readonly props: P;
  readonly opacity: number;
  readonly visible: boolean;
  readonly blendMode?: string;
  /**
   * Nome igual ao do documento de propósito: a ponte é estrutural, e um `matte`
   * opcional aqui casaria com qualquer objeto sem o campo — o recorte
   * desapareceria em silêncio em vez de o compilador cobrar.
   */
  readonly trackMatte?: NodeMatte | null;
}

export interface EvaluatedRenderableSceneLike {
  readonly frame: number;
  readonly nodes: ReadonlyMap<string, EvaluatedRenderableNodeLike>;
  readonly drawOrder: readonly string[];
}

export interface NodeLayoutLike {
  readonly matrix: Mat2D;
  readonly sizePx: Vec2;
  readonly culled: boolean;
}

export interface LayoutSceneLike {
  readonly frame: number;
  readonly layouts: ReadonlyMap<string, NodeLayoutLike>;
  readonly drawOrder: readonly string[];
}

export interface CreateScreenSceneOptions {
  readonly size: Vec2;
  readonly pixelRatio: number;
  readonly slotForType?: (type: string) => SlotId;
}

const BUILTIN_SLOT_BY_TYPE: Readonly<Record<string, SlotId>> = Object.freeze({
  "text.title": "above-all",
});

/**
 * Ponte pura entre `animation + scene-graph.layoutScene` e o renderer.
 *
 * A função só combina estruturas já avaliadas: não lê documento, não consulta
 * câmera e não cria IDs. O resultado independe da ordem de inserção dos Maps.
 */
export function createScreenScene(
  evaluated: EvaluatedRenderableSceneLike,
  laidOut: LayoutSceneLike,
  options: CreateScreenSceneOptions,
): ScreenScene {
  if (evaluated.frame !== laidOut.frame) {
    throw new RendererError(
      "backend-state",
      `Evaluate está no frame ${evaluated.frame}, mas layout está no frame ${laidOut.frame}.`,
    );
  }
  if (!sameOrder(evaluated.drawOrder, laidOut.drawOrder)) {
    throw new RendererError("backend-state", "Evaluate e layout possuem drawOrder diferentes.");
  }

  const slotForType =
    options.slotForType ??
    ((type: string): SlotId => {
      return BUILTIN_SLOT_BY_TYPE[type] ?? "scene";
    });
  const nodes = new Map<string, ScreenNode>();

  for (const nodeId of evaluated.drawOrder) {
    const node = evaluated.nodes.get(nodeId);
    const layout = laidOut.layouts.get(nodeId);
    if (node === undefined) {
      throw new RendererError("missing-node", `Evaluate não contém o nó "${nodeId}".`);
    }
    if (layout === undefined) {
      throw new RendererError("missing-node", `Layout não contém o nó "${nodeId}".`);
    }

    const screenNode: ScreenNode = {
      id: node.id,
      type: node.type,
      slot: slotForType(node.type),
      props: node.props,
      layout: {
        matrix: layout.matrix,
        size: layout.sizePx,
        opacity: node.opacity,
        visible: node.visible && !layout.culled,
        blendMode: node.blendMode ?? "normal",
        ...(node.trackMatte == null ? {} : { matte: node.trackMatte }),
      },
      ...(node.name === undefined ? {} : { name: node.name }),
    };
    nodes.set(nodeId, screenNode);
  }

  return {
    frame: evaluated.frame,
    size: [options.size[0], options.size[1]],
    pixelRatio: options.pixelRatio,
    nodes,
    drawOrder: [...evaluated.drawOrder],
  };
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
