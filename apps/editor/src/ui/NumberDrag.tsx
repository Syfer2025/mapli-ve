import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./NumberDrag.css";

export interface NumberDragProps {
  readonly id?: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** Chamado uma vez no fim do arraste — é o gancho para fechar a transação de undo. */
  readonly onCommit?: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  /** Unidades por pixel arrastado. */
  readonly step?: number;
  /** Casas decimais na exibição e no arredondamento. */
  readonly precision?: number;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
}

/**
 * Campo numérico com arraste (scrub).
 *
 * Todo campo de valor do editor usa isto: arrastar é mais rápido que digitar e
 * é o gesto que quem vem do After Effects espera.
 *
 * Modificadores durante o arraste seguem a convenção da categoria:
 *   Shift → 10× · Ctrl/Cmd → 1/10 · Alt → 1/100
 *
 * `setPointerCapture` em vez de listeners no `window`: o arraste continua
 * funcionando se o cursor sair da janela, e é liberado sozinho se o ponteiro
 * for cancelado pelo sistema.
 */
export function NumberDrag({
  id,
  value,
  onChange,
  onCommit,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  precision = 2,
  disabled = false,
  ariaLabel,
}: NumberDragProps): ReactNode {
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Guardado em ref para que o handler de pointermove não recrie a cada frame.
  const dragState = useRef({ startX: 0, startValue: 0, latest: 0 });

  const clampRound = useCallback(
    (next: number): number => {
      const factor = 10 ** precision;
      return Math.min(max, Math.max(min, Math.round(next * factor) / factor));
    },
    [min, max, precision],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || editing || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragState.current = { startX: event.clientX, startValue: value, latest: value };
      setDragging(true);
    },
    [disabled, editing, value],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;

      const multiplier = event.shiftKey
        ? 10
        : event.altKey
          ? 0.01
          : event.ctrlKey || event.metaKey
            ? 0.1
            : 1;

      const delta = (event.clientX - dragState.current.startX) * step * multiplier;
      const next = clampRound(dragState.current.startValue + delta);
      dragState.current.latest = next;
      onChange(next);
    },
    [dragging, step, clampRound, onChange],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
      onCommit?.(dragState.current.latest);
    },
    [dragging, onCommit],
  );

  const beginEditing = useCallback(() => {
    if (disabled) return;
    setDraft(String(value));
    setEditing(true);
  }, [disabled, value]);

  const commitDraft = useCallback(() => {
    const parsed = Number(draft.replace(",", "."));
    setEditing(false);
    if (!Number.isFinite(parsed)) return; // entrada inválida: mantém o valor
    const next = clampRound(parsed);
    onChange(next);
    onCommit?.(next);
  }, [draft, clampRound, onChange, onCommit]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (disabled) return;

      if (editing) {
        if (event.key === "Enter") commitDraft();
        else if (event.key === "Escape") setEditing(false);
        return;
      }

      // Setas: 1 unidade, 10 com Shift. Convenção universal.
      const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
      if (direction !== 0) {
        event.preventDefault();
        const next = clampRound(value + direction * step * (event.shiftKey ? 10 : 1));
        onChange(next);
        onCommit?.(next);
        return;
      }

      if (event.key === "Enter") beginEditing();
    },
    [disabled, editing, commitDraft, value, step, clampRound, onChange, onCommit, beginEditing],
  );

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        id={id}
        className="ui-number ui-number--editing"
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={handleKeyDown}
        autoFocus
      />
    );
  }

  return (
    <div
      id={id}
      className="ui-number"
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={Number.isFinite(min) ? min : undefined}
      aria-valuemax={Number.isFinite(max) ? max : undefined}
      aria-disabled={disabled || undefined}
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={beginEditing}
      onKeyDown={handleKeyDown}
    >
      {formatNumber(value, precision)}
    </div>
  );
}

/** Sem zeros à direita: `1.5`, não `1.50`. */
function formatNumber(value: number, precision: number): string {
  return String(Number.parseFloat(value.toFixed(precision)));
}
