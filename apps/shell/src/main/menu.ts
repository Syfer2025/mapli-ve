/**
 * Menu da aplicação.
 *
 * Na Fase 1 quase tudo é placeholder desabilitado — os itens existem para
 * fixar a estrutura e os atalhos desde já, porque mudar atalho depois que o
 * operador criou memória muscular custa mais que definir agora.
 *
 * Atalhos seguem o After Effects onde há equivalente (docs/07-CONVENTIONS.md § 10).
 */

import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "../ipc/contracts.js";

export interface MenuActions {
  readonly resetWorkspace: () => void;
  readonly perform: (action: MenuAction) => void;
}

export function buildMenu(window: BrowserWindow, actions: MenuActions): Menu {
  const soon = (label: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    ...(accelerator === undefined ? {} : { accelerator }),
    enabled: false,
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: "Arquivo",
      submenu: [
        {
          label: "Novo projeto",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            actions.perform("project:new");
          },
        },
        {
          label: "Abrir…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            actions.perform("project:open");
          },
        },
        { type: "separator" },
        {
          label: "Salvar",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            actions.perform("project:save");
          },
        },
        {
          label: "Salvar como…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => {
            actions.perform("project:save-as");
          },
        },
        { type: "separator" },
        soon("Importar Scene Script…"),
        soon("Exportar…", "CmdOrCtrl+M"),
        { type: "separator" },
        { role: "quit", label: "Sair" },
      ],
    },
    {
      label: "Editar",
      submenu: [
        {
          label: "Desfazer",
          accelerator: "CmdOrCtrl+Z",
          click: () => {
            actions.perform("history:undo");
          },
        },
        {
          label: "Refazer",
          accelerator: "CmdOrCtrl+Shift+Z",
          click: () => {
            actions.perform("history:redo");
          },
        },
        { type: "separator" },
        soon("Copiar", "CmdOrCtrl+C"),
        soon("Colar", "CmdOrCtrl+V"),
        soon("Duplicar", "CmdOrCtrl+D"),
        { type: "separator" },
        soon("Selecionar tudo", "CmdOrCtrl+A"),
      ],
    },
    {
      label: "Composição",
      submenu: [
        soon("Nova composição…", "CmdOrCtrl+Shift+N"),
        soon("Configurações da composição…", "CmdOrCtrl+K"),
        { type: "separator" },
        soon("Adicionar à fila de render", "CmdOrCtrl+Shift+M"),
      ],
    },
    {
      label: "Janela",
      submenu: [
        {
          label: "Restaurar layout padrão",
          click: () => {
            actions.resetWorkspace();
          },
        },
        { type: "separator" },
        { role: "reload", label: "Recarregar" },
        { role: "toggleDevTools", label: "Ferramentas de desenvolvedor" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tela cheia" },
        { role: "minimize", label: "Minimizar" },
      ],
    },
    {
      label: "Ajuda",
      submenu: [
        {
          label: `Versão ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  window.setMenu(menu);
  return menu;
}
