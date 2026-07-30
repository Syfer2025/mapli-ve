export interface FloatingMenuPosition {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
}

export interface FloatingMenuAnchor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Posiciona o menu no viewport, fora da árvore do dockview.
 *
 * Os grupos do dock usam `overflow: hidden`, então aumentar `z-index` dentro do
 * painel nunca resolve o recorte. O portal elimina esse limite; esta função
 * mantém o menu dentro da janela mesmo quando o painel está numa borda.
 */
export function positionFloatingMenu(
  anchor: FloatingMenuAnchor,
  viewport: { readonly width: number; readonly height: number },
): FloatingMenuPosition {
  const padding = 8;
  const gap = 4;
  const width = 216;
  const preferredHeight = 432;
  const left = Math.max(padding, Math.min(anchor.left, viewport.width - width - padding));
  const below = Math.max(0, viewport.height - anchor.bottom - gap - padding);
  const above = Math.max(0, anchor.top - gap - padding);
  const openAbove = below < 160 && above > below;
  const maxHeight = Math.max(80, Math.min(preferredHeight, openAbove ? above : below));
  const top = openAbove
    ? Math.max(padding, anchor.top - gap - maxHeight)
    : Math.max(padding, anchor.bottom + gap);
  return { left, top, maxHeight };
}
