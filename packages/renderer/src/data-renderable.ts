import type {
  NodeLayout,
  RenderContext,
  Renderable,
  RenderableFactory,
  ScreenNode,
  VisualEvaluator,
} from "./contracts.js";
import { RendererError } from "./errors.js";

/**
 * Converte uma função pura `(ScreenNode) → VisualPrimitive` em um renderable
 * retido. Essa é a extensão normal para tipos de nó simples.
 */
export function createDataRenderableFactory<P>(evaluate: VisualEvaluator<P>): RenderableFactory<P> {
  return () => {
    let context: RenderContext | undefined;

    const renderable: Renderable<P> = {
      mount(nextContext) {
        if (context !== undefined) {
          throw new RendererError(
            "invalid-lifecycle",
            `Renderable "${nextContext.nodeId}" foi montado duas vezes.`,
          );
        }
        context = nextContext;
      },

      update(node: ScreenNode<P>, layout: NodeLayout) {
        if (context === undefined) {
          throw new RendererError(
            "invalid-lifecycle",
            `Renderable "${node.id}" recebeu update antes de mount.`,
          );
        }
        context.submit(evaluate(node), layout);
      },

      unmount() {
        if (context === undefined) {
          throw new RendererError("invalid-lifecycle", "Renderable recebeu unmount sem mount.");
        }
        context = undefined;
      },
    };

    return renderable;
  };
}
