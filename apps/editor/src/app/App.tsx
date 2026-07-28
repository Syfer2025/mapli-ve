import { useEffect, useState, type ReactNode } from "react";
import { DockviewReact } from "dockview-react";
import { APP_NAME } from "@theatrum/schema";
import type { ProjectExampleInfo } from "@theatrum/shell";
import "dockview-react/dist/styles/dockview.css";
import { PANEL_COMPONENTS } from "./panels.js";
import { THEATRUM_DOCKVIEW_THEME } from "./theme.js";
import { useWorkspaceLayout } from "./useWorkspaceLayout.js";
import { bridge, isElectron } from "../bridge/index.js";
import { editorActions, initializeEditorSession } from "../document/editor-session.js";
import { useEditorSession } from "../document/useEditorSession.js";
import { Button } from "../ui/index.js";
import "./App.css";

export function App(): ReactNode {
  const { onReady, restored, resetLayout } = useWorkspaceLayout();

  useEffect(() => {
    void initializeEditorSession();
    return bridge.menu.onAction((action) => editorActions.handleMenu(action));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntry(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) editorActions.redo();
        else editorActions.undo();
      } else if (modifier && key === "c") {
        event.preventDefault();
        editorActions.copySelection();
      } else if (modifier && key === "v") {
        event.preventDefault();
        editorActions.pasteNodes();
      } else if (modifier && key === "d") {
        event.preventDefault();
        editorActions.duplicateSelection();
      } else if (modifier && key === "g") {
        event.preventDefault();
        if (event.shiftKey) editorActions.ungroupSelection();
        else editorActions.groupSelection();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        editorActions.deleteSelection();
      } else if (event.code === "Space") {
        event.preventDefault();
        editorActions.togglePlayback();
      } else if (event.key === "Escape") {
        editorActions.clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app">
      <TopBar onResetLayout={resetLayout} />
      <RecoveryBanner />

      <main className="app__workspace" data-restored={restored || undefined}>
        <DockviewReact
          components={PANEL_COMPONENTS}
          onReady={onReady}
          theme={THEATRUM_DOCKVIEW_THEME}
        />
      </main>

      <StatusBar />
    </div>
  );
}

function TopBar({ onResetLayout }: { readonly onResetLayout: () => void }): ReactNode {
  const session = useEditorSession();
  const [examples, setExamples] = useState<readonly ProjectExampleInfo[]>([]);

  useEffect(() => {
    void bridge.project.examples().then(setExamples);
  }, []);

  return (
    <header className="app__topbar">
      <span className="app__brand">{APP_NAME}</span>
      <span className="app__phase">mapa · ações · export offline</span>

      <div className="app__file-actions">
        <Button size="sm" variant="ghost" onClick={() => void editorActions.newProject()}>
          Novo
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void editorActions.openProject()}>
          Abrir
        </Button>
        <select
          className="app__example-select"
          aria-label="Abrir projeto de exemplo"
          value=""
          disabled={examples.length === 0}
          onChange={(event) => {
            const id = event.target.value;
            if (id !== "") void editorActions.openExample(id);
          }}
        >
          <option value="">Exemplos…</option>
          {examples.map((example) => (
            <option key={example.id} value={example.id}>
              {example.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={() => void editorActions.saveProject()}>
          Salvar
        </Button>
      </div>

      <div className="app__history-actions">
        <Button
          size="sm"
          iconOnly
          variant="ghost"
          aria-label="Desfazer"
          title="Desfazer (Ctrl+Z)"
          disabled={!session.history.canUndo}
          onClick={() => editorActions.undo()}
        >
          ↶
        </Button>
        <Button
          size="sm"
          iconOnly
          variant="ghost"
          aria-label="Refazer"
          title="Refazer (Ctrl+Shift+Z)"
          disabled={!session.history.canRedo}
          onClick={() => editorActions.redo()}
        >
          ↷
        </Button>
      </div>

      <div className="app__topbar-spacer" />

      <span className="app__document-name" title={session.file?.path}>
        {session.document.name}
        {session.dirty ? " *" : ""}
      </span>
      <Button size="sm" variant="ghost" onClick={onResetLayout}>
        Restaurar layout
      </Button>
    </header>
  );
}

function StatusBar(): ReactNode {
  const [info, setInfo] = useState<string>("carregando…");
  const session = useEditorSession();

  useEffect(() => {
    void bridge.app.info().then((i) => {
      setInfo(
        isElectron
          ? `Electron ${i.electronVersion} · Chromium ${i.chromeVersion} · Node ${i.nodeVersion}`
          : `navegador · layout não persistido`,
      );
    });
  }, []);

  return (
    <footer className="app__statusbar">
      <span>{info}</span>
      <span className="app__status-separator">·</span>
      <span data-error={session.error !== null || undefined}>
        {session.error ?? session.status}
      </span>
      <div className="app__topbar-spacer" />
      <span className="app__statusbar-note">
        {session.dirty
          ? "alterações não salvas"
          : session.file === null
            ? "projeto novo"
            : "documento em disco sincronizado"}
      </span>
    </footer>
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function RecoveryBanner(): ReactNode {
  const session = useEditorSession();
  const candidate = session.recoveryCandidate;

  if (candidate === null) {
    if (session.error === null) return null;
    return (
      <aside className="app__notice" data-kind="error" role="alert">
        <span>{session.error}</span>
        <Button size="sm" variant="ghost" onClick={() => editorActions.clearError()}>
          Fechar
        </Button>
      </aside>
    );
  }

  return (
    <aside className="app__notice" data-kind="recovery" role="alert">
      <div>
        <strong>Recuperação disponível</strong>
        <span>
          {candidate.projectPath ?? candidate.projectId} · {candidate.sequence} autosaves
        </span>
      </div>
      <Button size="sm" variant="primary" onClick={() => void editorActions.recover(candidate)}>
        Recuperar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void editorActions.discardRecovery(candidate)}
      >
        Descartar
      </Button>
    </aside>
  );
}
