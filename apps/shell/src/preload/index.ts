/**
 * Preload — a ponte tipada entre renderer e main.
 *
 * Expõe exatamente os canais de ipc/contracts.ts e nada mais. Sem
 * `ipcRenderer` cru no renderer, sem `require`, sem acesso a `process`.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
  BRIDGE_KEY,
  MENU_ACTION_CHANNEL,
  WORKSPACE_FLUSH_CHANNEL,
  type AppInfo,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type MenuAction,
  type TheatrumBridge,
  type WorkspaceState,
} from "../ipc/contracts.js";

function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcRequest<C> extends void ? [] : [IpcRequest<C>]
): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResponse<C>>;
}

/**
 * Superfície publicada em `window.theatrum`.
 *
 * Métodos nomeados por intenção, não por canal: o renderer chama
 * `workspace.save(...)`, não `invoke("workspace:save", ...)`. Assim renomear um
 * canal não vaza para a UI.
 */
const bridge = {
  app: {
    info: (): Promise<AppInfo> => invoke("app:info"),
  },
  workspace: {
    load: (): Promise<WorkspaceState | null> => invoke("workspace:load"),
    save: (state: WorkspaceState): Promise<void> => invoke("workspace:save", state),
    flush: (state: WorkspaceState): void => {
      ipcRenderer.sendSync(WORKSPACE_FLUSH_CHANNEL, state);
    },
    reset: (): Promise<void> => invoke("workspace:reset"),
  },
  window: {
    setTitle: (title: string): Promise<void> => invoke("window:set-title", title),
  },
  project: {
    open: () => invoke("project:open"),
    save: (request) => invoke("project:save", request),
    saveAs: (request) => invoke("project:save-as", request),
  },
  menu: {
    onAction: (listener: (action: MenuAction) => void): (() => void) => {
      const handler = (_event: unknown, action: MenuAction): void => {
        listener(action);
      };
      ipcRenderer.on(MENU_ACTION_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(MENU_ACTION_CHANNEL, handler);
      };
    },
  },
  recovery: {
    start: (request) => invoke("recovery:start", request),
    record: (request) => invoke("recovery:record", request),
    heartbeat: () => invoke("recovery:heartbeat"),
    candidates: () => invoke("recovery:candidates"),
    recover: (projectId) => invoke("recovery:recover", projectId),
    discard: (projectId) => invoke("recovery:discard", projectId),
    closeClean: () => invoke("recovery:close-clean"),
  },
} as const satisfies TheatrumBridge;

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
