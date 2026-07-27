import type { ReactNode } from "react";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Button, Panel } from "../../ui/index.js";
import "./HistoryPanel.css";

export function HistoryPanel(): ReactNode {
  const { history } = useEditorSession();

  return (
    <Panel
      title="Histórico de comandos"
      toolbar={
        <>
          <Button
            size="sm"
            onClick={() => editorActions.undo()}
            disabled={!history.canUndo}
            aria-label="Desfazer"
          >
            ↶ Desfazer
          </Button>
          <Button
            size="sm"
            onClick={() => editorActions.redo()}
            disabled={!history.canRedo}
            aria-label="Refazer"
          >
            ↷ Refazer
          </Button>
        </>
      }
      footer={
        <span>
          {history.entries.length} entradas · posição {history.cursor + 1}/{history.entries.length}
        </span>
      }
    >
      <div className="history-list" role="listbox" aria-label="Histórico do documento">
        <button
          type="button"
          className="history-list__entry"
          data-current={history.cursor === -1 || undefined}
          onClick={() => editorActions.jumpHistory(-1)}
        >
          <span className="history-list__sequence">00</span>
          <span className="history-list__marker">●</span>
          <span className="history-list__label">Estado inicial</span>
        </button>
        {history.entries.map((entry, index) => (
          <button
            type="button"
            role="option"
            aria-selected={index === history.cursor}
            className="history-list__entry"
            data-applied={index <= history.cursor || undefined}
            data-current={index === history.cursor || undefined}
            key={entry.sequence}
            onClick={() => editorActions.jumpHistory(index)}
          >
            <span className="history-list__sequence">
              {entry.sequence.toString().padStart(2, "0")}
            </span>
            <span className="history-list__marker">●</span>
            <span className="history-list__label">{entry.label}</span>
            <span className="history-list__meta">
              {entry.commandTypes.length} cmd · {entry.patches.length} patches
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}
