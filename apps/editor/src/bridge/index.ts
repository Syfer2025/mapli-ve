/**
 * Cliente da ponte IPC.
 *
 * A UI fala com o sistema operacional só por aqui. Um fallback em memória
 * mantém o app utilizável fora do Electron (ex.: `vite dev` puro para iterar
 * em CSS sem subir o processo main).
 */

import { BRIDGE_KEY, type TheatrumBridge, type WorkspaceState } from "@theatrum/shell";

declare global {
  interface Window {
    readonly theatrum?: TheatrumBridge;
  }
}

let memoryWorkspace: WorkspaceState | null = null;

/** Fallback sem Electron: workspace vive na memória da aba e some ao recarregar. */
const fallback: TheatrumBridge = {
  app: {
    info: () =>
      Promise.resolve({
        appVersion: "dev",
        electronVersion: "—",
        chromeVersion: "—",
        nodeVersion: "—",
        platform: "browser",
        userDataPath: "",
        isPackaged: false,
      }),
  },
  workspace: {
    load: () => Promise.resolve(memoryWorkspace),
    save: (state) => {
      memoryWorkspace = state;
      return Promise.resolve();
    },
    flush: (state) => {
      memoryWorkspace = state;
    },
    reset: () => {
      memoryWorkspace = null;
      return Promise.resolve();
    },
  },
  project: {
    open: () => Promise.resolve({ status: "cancelled" }),
    save: () => Promise.resolve({ status: "cancelled" }),
    saveAs: () => Promise.resolve({ status: "cancelled" }),
  },
  menu: {
    onAction: () => () => {},
  },
  recovery: {
    start: () => Promise.resolve({ ok: true }),
    record: () => Promise.resolve({ ok: true }),
    heartbeat: () => Promise.resolve({ ok: true }),
    candidates: () => Promise.resolve({ ok: true, candidates: [] }),
    recover: () => Promise.resolve({ ok: false, message: "Recuperação indisponível." }),
    discard: () => Promise.resolve({ ok: true }),
    closeClean: () => Promise.resolve({ ok: true }),
  },
  window: {
    setTitle: (title) => {
      document.title = title;
      return Promise.resolve();
    },
  },
};

export const bridge: TheatrumBridge = window.theatrum ?? fallback;

export const isElectron = window.theatrum !== undefined;

export { BRIDGE_KEY };
