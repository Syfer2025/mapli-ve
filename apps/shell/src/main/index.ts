/**
 * Processo main do Electron.
 *
 * Responsabilidade: janelas, menus e adapters do sistema operacional. Nenhuma
 * lógica de domínio mora aqui — o motor vive no renderer, e o main é o
 * adapter que lhe dá acesso a disco e a processos.
 */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEditorWindow } from "./windows/editor.js";
import { buildMenu } from "./menu.js";
import {
  flushWorkspace,
  loadWorkspace,
  resetWorkspace,
  saveWorkspace,
} from "./services/workspace-store.js";
import { registerDataProtocol, registerDataScheme } from "./services/data-protocol.js";
import {
  listProjectExamples,
  openProjectExample,
  openProjectFile,
  saveProjectFile,
  saveProjectFileAs,
} from "./services/project-files.js";
import {
  closeRecoveryClean,
  discardRecovery,
  heartbeatRecovery,
  listRecoveryCandidates,
  recordRecovery,
  recoverDocument,
  shouldPreserveRecoveryOnQuit,
  startRecovery,
} from "./services/recovery.js";
import { appendExportBytes, beginExport, writeExportFrame } from "./services/export-writer.js";
import { encodeExportFrames } from "./services/ffmpeg-export.js";
import {
  IPC_CHANNELS,
  MENU_ACTION_CHANNEL,
  WORKSPACE_FLUSH_CHANNEL,
  type AppInfo,
  type ExportAppendRequest,
  type ExportBeginRequest,
  type ExportEncodeRequest,
  type ExportFrameRequest,
  type IpcChannel,
  type ProjectSaveRequest,
  type RecoveryRecordRequest,
  type RecoveryStartRequest,
  type WorkspaceState,
} from "../ipc/contracts.js";

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

/** electron-vite injeta esta variável no dev; em produção fica indefinida. */
const DEV_SERVER_URL = process.env["ELECTRON_RENDERER_URL"];

const IS_DEV = DEV_SERVER_URL !== undefined;

// Electron exige que esquemas privilegiados sejam declarados antes de ready.
registerDataScheme();

/**
 * Depuração remota, só em desenvolvimento.
 *
 * Sem isto não há como inspecionar o renderer real de fora do app — e o
 * navegador comum não serve de substituto, porque lá `window.theatrum` não
 * existe e o fallback em memória entra no lugar da persistência de verdade.
 * `tools/inspect-renderer.mjs` fala com esta porta.
 *
 * Nunca em produção: expor CDP daria execução arbitrária de código na janela.
 */
if (IS_DEV) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
  app.commandLine.appendSwitch("remote-allow-origins", "http://localhost:9222");
}

let editorWindow: BrowserWindow | null = null;
let recoveryCleanedForQuit = false;

function appInfo(): AppInfo {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? "desconhecida",
    chromeVersion: process.versions.chrome ?? "desconhecida",
    nodeVersion: process.versions.node,
    platform: process.platform,
    userDataPath: app.getPath("userData"),
    isPackaged: app.isPackaged,
  };
}

/**
 * Registra os handlers de IPC.
 *
 * A asserção `satisfies` no fim é o que impede um canal declarado em
 * contracts.ts de ficar sem implementação: acrescentar um canal lá e esquecer
 * aqui não compila.
 */
function registerIpc(): void {
  const handlers = {
    "app:info": () => appInfo(),
    "workspace:load": () => loadWorkspace(),
    "workspace:save": (_event: unknown, state: WorkspaceState) => saveWorkspace(state),
    "workspace:reset": () => resetWorkspace(),
    "project:open": () => {
      if (editorWindow === null) throw new Error("A janela do editor não está disponível.");
      return openProjectFile(editorWindow);
    },
    "project:examples": () => listProjectExamples(),
    "project:open-example": (_event: unknown, id: string) => openProjectExample(id),
    "project:save": (_event: unknown, request: ProjectSaveRequest) => {
      if (editorWindow === null) throw new Error("A janela do editor não está disponível.");
      return saveProjectFile(editorWindow, request);
    },
    "project:save-as": (_event: unknown, request: ProjectSaveRequest) => {
      if (editorWindow === null) throw new Error("A janela do editor não está disponível.");
      return saveProjectFileAs(editorWindow, request);
    },
    "recovery:start": (_event: unknown, request: RecoveryStartRequest) => startRecovery(request),
    "recovery:record": (_event: unknown, request: RecoveryRecordRequest) => recordRecovery(request),
    "recovery:heartbeat": () => heartbeatRecovery(),
    "recovery:candidates": () => listRecoveryCandidates(),
    "recovery:recover": (_event: unknown, projectId: string) => recoverDocument(projectId),
    "recovery:discard": (_event: unknown, projectId: string) => discardRecovery(projectId),
    "recovery:close-clean": () => closeRecoveryClean(),
    "window:set-title": (_event: unknown, title: string) => {
      editorWindow?.setTitle(title);
    },
    "export:begin": (_event: unknown, request: ExportBeginRequest) => {
      if (editorWindow === null) throw new Error("A janela do editor não está disponível.");
      return beginExport(editorWindow, request);
    },
    // Sem a janela como argumento: escrever um frame não abre diálogo nenhum, e
    // um export não pode morrer porque a janela foi fechada no meio.
    "export:frame": (_event: unknown, request: ExportFrameRequest) => writeExportFrame(request),
    "export:append": (_event: unknown, request: ExportAppendRequest) => appendExportBytes(request),
    "export:encode": (_event: unknown, request: ExportEncodeRequest) => encodeExportFrames(request),
  } satisfies Record<IpcChannel, unknown>;

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, handlers[channel] as never);
  }

  ipcMain.on(WORKSPACE_FLUSH_CHANNEL, (event, state: WorkspaceState) => {
    flushWorkspace(state);
    event.returnValue = undefined;
  });
}

async function openEditor(): Promise<void> {
  editorWindow = createEditorWindow({
    // .cjs, não .mjs: preload em ESM é incompatível com `sandbox: true`.
    preloadPath: path.join(DIRNAME, "..", "preload", "index.cjs"),
    devServerUrl: DEV_SERVER_URL,
    rendererHtmlPath: path.join(DIRNAME, "..", "renderer", "index.html"),
  });

  buildMenu(editorWindow, {
    resetWorkspace: () => {
      void resetWorkspace().then(() => {
        editorWindow?.webContents.reload();
      });
    },
    perform: (action) => {
      editorWindow?.webContents.send(MENU_ACTION_CHANNEL, action);
    },
  });

  editorWindow.on("closed", () => {
    editorWindow = null;
  });
}

// Uma instância só: duas janelas do editor sobre o mesmo projeto seriam duas
// fontes de verdade, e o autosave de uma sobrescreveria a outra.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (editorWindow === null) return;
    if (editorWindow.isMinimized()) editorWindow.restore();
    editorWindow.focus();
  });

  void app.whenReady().then(async () => {
    registerIpc();
    registerDataProtocol();
    await openEditor();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openEditor();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (recoveryCleanedForQuit) return;
    if (shouldPreserveRecoveryOnQuit()) {
      // Sem prompt nativo ainda: preservar é a escolha sem perda. Na próxima
      // abertura o editor oferece recuperar a sessão não salva.
      recoveryCleanedForQuit = true;
      return;
    }
    event.preventDefault();
    void closeRecoveryClean().finally(() => {
      recoveryCleanedForQuit = true;
      app.quit();
    });
  });
}
