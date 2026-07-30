/**
 * Menu da aplicação.
 *
 * Na Fase 1 quase tudo é placeholder desabilitado — os itens existem para
 * fixar a estrutura e os atalhos desde já, porque mudar atalho depois que o
 * operador criou memória muscular custa mais que definir agora.
 *
 * Os aceleradores configuráveis são resolvidos pelo registry do renderer. Itens
 * ativos não registram uma segunda combinação fixa aqui, pois ela contornaria
 * um override do usuário; clicar no menu continua emitindo a mesma `MenuAction`.
 */

import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "../ipc/contracts.js";

export interface MenuActions {
  readonly resetWorkspace: () => void;
  readonly perform: (action: MenuAction) => void;
}

export function buildMenu(window: BrowserWindow, actions: MenuActions): Menu {
  const soon = (label: string): MenuItemConstructorOptions => ({
    label,
    enabled: false,
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: "Arquivo",
      submenu: [
        {
          label: "Novo projeto",
          click: () => {
            actions.perform("project:new");
          },
        },
        {
          label: "Abrir…",
          click: () => {
            actions.perform("project:open");
          },
        },
        { type: "separator" },
        {
          label: "Salvar",
          click: () => {
            actions.perform("project:save");
          },
        },
        {
          label: "Salvar como…",
          click: () => {
            actions.perform("project:save-as");
          },
        },
        { type: "separator" },
        soon("Importar Scene Script…"),
        soon("Exportar…"),
        { type: "separator" },
        { role: "quit", label: "Sair" },
      ],
    },
    {
      label: "Editar",
      submenu: [
        {
          label: "Desfazer",
          click: () => {
            actions.perform("history:undo");
          },
        },
        {
          label: "Refazer",
          click: () => {
            actions.perform("history:redo");
          },
        },
        { type: "separator" },
        soon("Copiar"),
        soon("Colar"),
        soon("Duplicar"),
        { type: "separator" },
        soon("Selecionar tudo"),
      ],
    },
    {
      label: "Composição",
      submenu: [
        soon("Nova composição…"),
        soon("Configurações da composição…"),
        { type: "separator" },
        soon("Adicionar à fila de render"),
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
