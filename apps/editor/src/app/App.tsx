import { useEffect, useState, type ReactNode } from "react";
import { DockviewReact } from "dockview-react";
import { APP_NAME } from "@theatrum/schema";
import type { SceneDiagnostic } from "@theatrum/scripting";
import type { ProjectExampleInfo } from "@theatrum/shell";
import "dockview-react/dist/styles/dockview.css";
import { PANEL_COMPONENTS } from "./panels.js";
import { THEATRUM_DOCKVIEW_THEME } from "./theme.js";
import { useWorkspaceLayout } from "./useWorkspaceLayout.js";
import {
  WORKSPACE_PRESETS,
  isWorkspacePresetId,
  type ApplyWorkspacePresetResult,
  type WorkspacePresetId,
  type WorkspacePresetSelectionId,
} from "./workspace-presets.js";
import { commandDefinition, formatShortcut, type EditorCommandId } from "./command-shortcuts.js";
import {
  useShortcutPreferences,
  type ShortcutPreferencesController,
} from "./useShortcutPreferences.js";
import { ShortcutPreferencesDialog } from "./ShortcutPreferencesDialog.js";
import { bridge, isElectron } from "../bridge/index.js";
import { editorActions, initializeEditorSession } from "../document/editor-session.js";
import { useEditorSession } from "../document/useEditorSession.js";
import { compileScene, formatSceneDiagnostics } from "../scripting/scene-script-import.js";
import { Button } from "../ui/index.js";
import "./App.css";

export function App(): ReactNode {
  const { onReady, restored, workspacePresetId, applyPreset, resetLayout } = useWorkspaceLayout();
  const shortcuts = useShortcutPreferences();

  useEffect(() => {
    void initializeEditorSession();
    return bridge.menu.onAction((action) => editorActions.handleMenu(action));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const commandId = shortcuts.registry.resolveKeyboardEvent(event);
      if (commandId === null) return;
      if (isTextEntry(event.target) && commandDefinition(commandId).scope !== "global") return;
      event.preventDefault();
      executeEditorCommand(commandId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts.registry]);

  return (
    <div className="app">
      <TopBar
        workspaceRestored={restored}
        workspacePresetId={workspacePresetId}
        onApplyPreset={applyPreset}
        onResetLayout={resetLayout}
        shortcuts={shortcuts}
      />
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

interface TopBarProps {
  readonly workspaceRestored: boolean;
  readonly workspacePresetId: WorkspacePresetSelectionId;
  readonly onApplyPreset: (presetId: WorkspacePresetId) => ApplyWorkspacePresetResult;
  readonly onResetLayout: () => ApplyWorkspacePresetResult;
  readonly shortcuts: ShortcutPreferencesController;
}

function TopBar({
  workspaceRestored,
  workspacePresetId,
  onApplyPreset,
  onResetLayout,
  shortcuts,
}: TopBarProps): ReactNode {
  const session = useEditorSession();
  const [examples, setExamples] = useState<readonly ProjectExampleInfo[]>([]);
  const [sceneScriptOpen, setSceneScriptOpen] = useState(false);
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const mac = navigator.platform.toLowerCase().includes("mac");

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
        <Button size="sm" variant="ghost" onClick={() => setSceneScriptOpen(true)}>
          Scene Script…
        </Button>
      </div>

      <div className="app__history-actions">
        <Button
          size="sm"
          iconOnly
          variant="ghost"
          aria-label="Desfazer"
          title={shortcutTitle("Desfazer", shortcuts, "history:undo", mac)}
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
          title={shortcutTitle("Refazer", shortcuts, "history:redo", mac)}
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
      <select
        className="app__workspace-select"
        aria-label="Preset de workspace"
        value={workspacePresetId}
        disabled={!workspaceRestored}
        onChange={(event) => {
          if (!isWorkspacePresetId(event.target.value)) return;
          const result = onApplyPreset(event.target.value);
          setLayoutError(result.ok ? null : `Layout anterior preservado: ${result.message}`);
        }}
      >
        {workspacePresetId === "custom" ? <option value="custom">Personalizado</option> : null}
        {WORKSPACE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
      <Button size="sm" variant="ghost" onClick={() => setShortcutSettingsOpen(true)}>
        Atalhos…
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const result = onResetLayout();
          setLayoutError(result.ok ? null : `Layout anterior preservado: ${result.message}`);
        }}
      >
        Restaurar layout
      </Button>
      {layoutError === null ? null : (
        <span className="app__layout-error" role="alert" title={layoutError}>
          Preset não aplicado
        </span>
      )}
      {sceneScriptOpen ? <SceneScriptDialog onClose={() => setSceneScriptOpen(false)} /> : null}
      {shortcutSettingsOpen ? (
        <ShortcutPreferencesDialog
          controller={shortcuts}
          onClose={() => setShortcutSettingsOpen(false)}
        />
      ) : null}
    </header>
  );
}

const EMPTY_SCENE_SCRIPT = `{
  "format": "theatrum-scene",
  "version": 1,
  "meta": {
    "title": "Nova cena",
    "fps": 60,
    "resolution": "1920x1080",
    "duration": "30s"
  },
  "timeline": []
}`;

function SceneScriptDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const [source, setSource] = useState(EMPTY_SCENE_SCRIPT);
  const [diagnostics, setDiagnostics] = useState<readonly SceneDiagnostic[]>([]);
  const [running, setRunning] = useState(false);
  const [imported, setImported] = useState(false);
  const [copied, setCopied] = useState(false);

  const compileAndImport = async (): Promise<void> => {
    setRunning(true);
    setImported(false);
    try {
      const result = await compileScene(source);
      setDiagnostics(result.diagnostics);
      setCopied(false);
      if (result.ok && editorActions.applySceneScript(result.document)) {
        setImported(true);
      }
    } catch (error: unknown) {
      setDiagnostics([
        {
          severity: "error",
          code: "schema",
          path: "",
          message: `falha inesperada ao compilar: ${
            error instanceof Error ? error.message : String(error)
          }`,
          hint: "copie este diagnóstico e reporte como erro do compilador",
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  const loadFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setSource(await file.text());
    setDiagnostics([]);
    setImported(false);
    setCopied(false);
  };

  return (
    <div className="scene-script" role="presentation">
      <section
        className="scene-script__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-script-title"
      >
        <header className="scene-script__header">
          <div>
            <strong id="scene-script-title">Importar Scene Script</strong>
            <span>JSON declarativo para gerar uma animação editável</span>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </header>

        <div className="scene-script__body">
          <label className="scene-script__source">
            <span>Scene Script v1</span>
            <textarea
              value={source}
              spellCheck={false}
              onChange={(event) => {
                setSource(event.target.value);
                setImported(false);
                setCopied(false);
              }}
              aria-label="JSON do Scene Script"
            />
          </label>

          <aside className="scene-script__diagnostics" aria-live="polite">
            <div className="scene-script__diagnostics-title">
              <strong>Diagnósticos</strong>
              <span>
                {diagnostics.length === 0
                  ? "nenhum"
                  : `${diagnostics.length} resultado${diagnostics.length === 1 ? "" : "s"}`}
              </span>
            </div>
            {imported ? (
              <p className="scene-script__success">
                Cena importada como uma única ação. Ctrl+Z desfaz tudo.
              </p>
            ) : null}
            {diagnostics.length === 0 ? (
              <p className="scene-script__empty">
                Compile para validar lugares, tempos, referências e verbos.
              </p>
            ) : (
              <ol className="scene-script__diagnostic-list">
                {diagnostics.map((entry, index) => (
                  <li key={`${entry.path}:${entry.code}:${index}`} data-severity={entry.severity}>
                    <code>{entry.path || "/"}</code>
                    <strong>{entry.message}</strong>
                    {entry.hint === undefined ? null : <span>{entry.hint}</span>}
                    {entry.didYouMean === undefined ? null : (
                      <span>Talvez: {entry.didYouMean.join(" · ")}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>

        <footer className="scene-script__footer">
          <label className="scene-script__file">
            Abrir JSON…
            <input
              type="file"
              accept=".json,.scene.json,application/json"
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            disabled={diagnostics.length === 0}
            onClick={() => {
              void copyText(formatSceneDiagnostics(diagnostics)).then(() => setCopied(true));
            }}
          >
            {copied ? "Copiado" : "Copiar erros"}
          </Button>
          <div className="app__topbar-spacer" />
          <Button
            size="sm"
            variant="primary"
            disabled={running || source.trim() === ""}
            onClick={() => void compileAndImport()}
          >
            {running ? "Compilando…" : "Compilar e importar"}
          </Button>
        </footer>
      </section>
    </div>
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

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // O fallback abaixo também funciona em origens file:// sem permissão.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  try {
    textarea.select();
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function executeEditorCommand(commandId: EditorCommandId): void {
  if (commandId === "project:new") void editorActions.newProject();
  else if (commandId === "project:open") void editorActions.openProject();
  else if (commandId === "project:save") void editorActions.saveProject();
  else if (commandId === "project:save-as") void editorActions.saveProject(true);
  else if (commandId === "history:undo") editorActions.undo();
  else if (commandId === "history:redo") editorActions.redo();
  else if (commandId === "selection:copy") editorActions.copySelection();
  else if (commandId === "selection:paste") editorActions.pasteNodes();
  else if (commandId === "selection:duplicate") editorActions.duplicateSelection();
  else if (commandId === "selection:group") editorActions.groupSelection();
  else if (commandId === "selection:ungroup") editorActions.ungroupSelection();
  else if (commandId === "selection:delete") editorActions.deleteSelection();
  else if (commandId === "selection:clear") editorActions.clearSelection();
  else if (commandId === "playback:toggle") editorActions.togglePlayback();
  else {
    const exhaustive: never = commandId;
    throw new RangeError(`comando sem executor: ${String(exhaustive)}`);
  }
}

function shortcutTitle(
  label: string,
  controller: ShortcutPreferencesController,
  commandId: EditorCommandId,
  mac: boolean,
): string {
  const binding = controller.registry.bindingFor(commandId)[0];
  return binding === undefined ? label : `${label} (${formatShortcut(binding, mac)})`;
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
