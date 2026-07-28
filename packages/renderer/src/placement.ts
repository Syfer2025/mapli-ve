import type { Vec2 } from "@theatrum/core-math";
import type { VisualPrimitive } from "./contracts.js";

export interface VisualPlacement {
  /** Posição do display object dentro do sistema local `[0..size]`. */
  readonly position: Vec2;
  /**
   * Anchor normalizado do display object. Graphics centrados já desenham ao
   * redor de `(0,0)`, portanto usam anchor zero e somente a posição central.
   */
  readonly anchor: Vec2;
}

/**
 * Convenção geométrica única entre layout, desenho e hit testing.
 *
 * `scene-graph` calcula bounds sobre `[0..size]`. Textura e texto têm geometria
 * própria ancorada no centro; círculo/símbolo são Graphics desenhados ao redor
 * da origem. Todos os quatro são colocados em `size/2`. Linha e polígono já
 * carregam pontos locais explícitos e permanecem em `(0,0)`.
 */
export function visualPlacement(visual: VisualPrimitive, size: Vec2): VisualPlacement {
  switch (visual.kind) {
    case "text":
    case "image":
      return {
        position: [size[0] / 2, size[1] / 2],
        anchor: [0.5, 0.5],
      };
    case "circle":
    case "symbol":
      return {
        position: [size[0] / 2, size[1] / 2],
        anchor: [0, 0],
      };
    // Linha, polígono, geometria geográfica, rótulo com guia e partículas carregam
    // deslocamento local próprio, medido a partir da origem do nó; centralizar
    // deslocaria a geometria inteira. O rótulo ancora no canto da caixa porque é
    // dali que a caixa cresce com o texto.
    case "none":
    case "line":
    case "polygon":
    case "callout":
    case "geo-shape":
    case "route":
    case "particles":
      return {
        position: [0, 0],
        anchor: [0, 0],
      };
  }
}
