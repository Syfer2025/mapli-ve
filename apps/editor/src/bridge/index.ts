/**
 * Cliente da ponte IPC.
 *
 * A UI fala com o sistema operacional só por aqui. Um fallback em memória
 * mantém o app utilizável fora do Electron (ex.: `vite dev` puro para iterar
 * em CSS sem subir o processo main).
 */

import {
  BRIDGE_KEY,
  type ShortcutPreferences,
  type TheatrumBridge,
  type WorkspaceState,
} from "@theatrum/shell";

declare global {
  interface Window {
    readonly theatrum?: TheatrumBridge;
  }
}

let memoryWorkspace: WorkspaceState | null = null;
let memoryPreferences: ShortcutPreferences | null = null;

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
    metrics: () => Promise.resolve([]),
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
  preferences: {
    load: () => Promise.resolve(memoryPreferences),
    save: (preferences) => {
      memoryPreferences = preferences;
      return Promise.resolve();
    },
    reset: () => {
      memoryPreferences = null;
      return Promise.resolve();
    },
  },
  project: {
    open: () => Promise.resolve({ status: "cancelled" }),
    examples: () => Promise.resolve([]),
    openExample: () => Promise.resolve({ status: "cancelled" }),
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
  /**
   * Fora do Electron não há disco, então o export recusa em vez de fingir. Um
   * fallback que devolvesse `ok` produziria um relatório com hashes inventados —
   * exatamente o tipo de sucesso falso que o critério byte-idêntico não perdoa.
   */
  export: {
    begin: () =>
      Promise.resolve({
        ok: false,
        directory: "",
        message: "Export exige o aplicativo Electron.",
      }),
    frame: () =>
      Promise.resolve({
        ok: false,
        bytes: 0,
        sha256: "",
        message: "Export exige o aplicativo Electron.",
      }),
    verifyFrames: () =>
      Promise.resolve({
        ok: false,
        verified: 0,
        message: "Export exige o aplicativo Electron.",
      }),
    append: () =>
      Promise.resolve({ ok: false, bytes: 0, message: "Export exige o aplicativo Electron." }),
    finalize: (request) =>
      Promise.resolve({
        ok: false,
        filename: request.action === "publish" ? request.finalFilename : request.temporaryFilename,
        bytes: 0,
        sha256: "",
        temporaryDisposition: "preserved",
        message: "Export exige o aplicativo Electron.",
      }),
    encode: (request) =>
      Promise.resolve({
        ok: false,
        filename: request.outputFilename,
        bytes: 0,
        sha256: "",
        message: "Export exige o aplicativo Electron.",
      }),
  },
};

export const bridge: TheatrumBridge = window.theatrum ?? fallback;

export const isElectron = window.theatrum !== undefined;

export { BRIDGE_KEY };
