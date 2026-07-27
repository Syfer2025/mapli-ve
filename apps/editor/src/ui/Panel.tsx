import type { ReactNode } from "react";
import "./Panel.css";

export interface PanelProps {
  /** Cabeçalho interno. A aba do dock já mostra o nome; use só quando ajudar. */
  readonly title?: string;
  readonly toolbar?: ReactNode;
  readonly footer?: ReactNode;
  /** `false` quando o conteúdo gerencia o próprio scroll (canvas, viewport). */
  readonly scroll?: boolean;
  readonly children?: ReactNode;
}

/** Casca padrão de painel: cabeçalho, corpo com scroll e rodapé opcional. */
export function Panel({ title, toolbar, footer, scroll = true, children }: PanelProps): ReactNode {
  const hasHeader = title !== undefined || toolbar !== undefined;

  return (
    <section className="ui-panel">
      {hasHeader && (
        <header className="ui-panel__header">
          {title !== undefined && <h2 className="ui-panel__title">{title}</h2>}
          {toolbar !== undefined && <div className="ui-panel__toolbar">{toolbar}</div>}
        </header>
      )}

      <div className="ui-panel__body" data-scroll={scroll || undefined}>
        {children}
      </div>

      {footer !== undefined && <footer className="ui-panel__footer">{footer}</footer>}
    </section>
  );
}

export interface PanelPlaceholderProps {
  readonly label: string;
  readonly phase: string;
  readonly hint?: string;
}

/**
 * Marcador de painel ainda não implementado.
 *
 * Diz em qual fase o painel chega, em vez de mostrar um vazio ambíguo. Serve
 * de mapa de progresso dentro do próprio app durante a construção.
 */
export function PanelPlaceholder({ label, phase, hint }: PanelPlaceholderProps): ReactNode {
  return (
    <div className="ui-placeholder">
      <span className="ui-placeholder__label">{label}</span>
      <span className="ui-placeholder__phase">{phase}</span>
      {hint !== undefined && <p className="ui-placeholder__hint">{hint}</p>}
    </div>
  );
}
