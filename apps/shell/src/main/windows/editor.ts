/**
 * Janela do editor.
 *
 * `contextIsolation` ligado e `nodeIntegration` desligado nas duas janelas do
 * app (esta e, na Fase 8, a Render Window). Todo acesso a Node passa pelo
 * preload, com superfície explícita em ipc/contracts.ts.
 */

import { BrowserWindow, shell } from "electron";
import path from "node:path";

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 640;

export interface EditorWindowOptions {
  readonly preloadPath: string;
  readonly devServerUrl: string | undefined;
  readonly rendererHtmlPath: string;
}

export function createEditorWindow(options: EditorWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1680,
    height: 1000,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: "#101418",
    autoHideMenuBar: false,
    title: "Theatrum",
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
      // O inspector CDP roda com a janela nativa escondida; sem isto Chromium
      // suspende requestAnimationFrame e torna impossível provar playback.
      // Builds normais preservam o throttling ao minimizar.
      backgroundThrottling: options.devServerUrl === undefined,
      // Sem spellcheck: economiza memória e não há campo de texto longo.
      spellcheck: false,
    },
  });

  // Mostrar só quando o primeiro frame estiver pronto evita o flash branco.
  window.once("ready-to-show", () => {
    window.show();
  });

  // Link externo abre no navegador do sistema, nunca dentro do app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (options.devServerUrl !== undefined) {
    void window.loadURL(options.devServerUrl);
  } else {
    void window.loadFile(path.resolve(options.rendererHtmlPath));
  }

  return window;
}
