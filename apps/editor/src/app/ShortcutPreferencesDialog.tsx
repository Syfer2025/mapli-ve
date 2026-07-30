import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  EDITOR_COMMANDS,
  formatShortcut,
  shortcutFromKeyboardEvent,
  type EditorCommandId,
} from "./command-shortcuts.js";
import type { ShortcutPreferencesController } from "./useShortcutPreferences.js";
import { Button } from "../ui/index.js";
import "./ShortcutPreferencesDialog.css";

export interface ShortcutPreferencesDialogProps {
  readonly controller: ShortcutPreferencesController;
  readonly onClose: () => void;
}

export function ShortcutPreferencesDialog({
  controller,
  onClose,
}: ShortcutPreferencesDialogProps): ReactNode {
  const [capturing, setCapturing] = useState<EditorCommandId | null>(null);
  const mac = navigator.platform.toLowerCase().includes("mac");
  const conflicts = controller.registry.conflicts();

  const capture = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    commandId: EditorCommandId,
  ): void => {
    if (capturing !== commandId) return;
    event.preventDefault();
    event.stopPropagation();
    const chord = shortcutFromKeyboardEvent(event.nativeEvent);
    if (chord === null) return;
    const result = controller.rebind(commandId, chord);
    if (result.ok) setCapturing(null);
  };

  return (
    <div className="shortcut-settings" role="presentation">
      <section
        className="shortcut-settings__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-settings-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (capturing === null && event.code === "Escape") onClose();
        }}
      >
        <header className="shortcut-settings__header">
          <div>
            <strong id="shortcut-settings-title">Atalhos do editor</strong>
            <span>Selecione uma combinação para gravar. Conflitos são recusados.</span>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </header>

        <div className="shortcut-settings__body">
          {!controller.ready ? (
            <p className="shortcut-settings__message">Carregando preferências…</p>
          ) : null}
          {controller.error !== null ? (
            <div className="shortcut-settings__message" data-kind="error" role="alert">
              <span>{controller.error}</span>
              <Button size="sm" variant="ghost" onClick={controller.clearError}>
                Ocultar
              </Button>
            </div>
          ) : null}
          {conflicts.map((conflict) => (
            <p
              className="shortcut-settings__message"
              data-kind="error"
              role="alert"
              key={conflict.chord}
            >
              {formatShortcut(conflict.chord, mac)} está ambíguo e foi desativado.
            </p>
          ))}

          <div className="shortcut-settings__table" role="list">
            {EDITOR_COMMANDS.map((command) => {
              const bindings = controller.registry.bindingFor(command.id);
              const overridden = Object.hasOwn(controller.overrides, command.id);
              return (
                <div className="shortcut-settings__row" role="listitem" key={command.id}>
                  <span className="shortcut-settings__category">{command.category}</span>
                  <span className="shortcut-settings__label">{command.label}</span>
                  <button
                    type="button"
                    className="shortcut-settings__binding"
                    data-capturing={capturing === command.id || undefined}
                    aria-label={`Editar atalho de ${command.label}`}
                    aria-pressed={capturing === command.id}
                    onClick={() => setCapturing(command.id)}
                    onKeyDown={(event) => capture(event, command.id)}
                  >
                    {capturing === command.id
                      ? "Pressione as teclas…"
                      : bindings.length === 0
                        ? "Sem atalho"
                        : bindings.map((chord) => formatShortcut(chord, mac)).join(" / ")}
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!overridden}
                    onClick={() => {
                      controller.restoreDefault(command.id);
                      setCapturing(null);
                    }}
                  >
                    Padrão
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={bindings.length === 0}
                    onClick={() => {
                      controller.rebind(command.id, null);
                      setCapturing(null);
                    }}
                  >
                    Limpar
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="shortcut-settings__footer">
          <span>Atalhos não alteram o projeto nem entram no undo.</span>
          <div className="app__topbar-spacer" />
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setCapturing(null);
              void controller.resetAll();
            }}
          >
            Restaurar todos
          </Button>
        </footer>
      </section>
    </div>
  );
}
