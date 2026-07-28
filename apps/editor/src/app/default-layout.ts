import type { DockviewApi } from "dockview-react";

/**
 * Layout padrão, no arranjo do After Effects.
 *
 *   ┌──────────┬───────────────────────┬────────────┐
 *   │ Projeto  │                       │ Inspector  │
 *   ├──────────┤       Viewport        ├────────────┤
 *   │ Bibliot. │                       │ Efeitos    │
 *   │          │                       │ Ações      │
 *   ├──────────┴───────────────────────┴────────────┤
 *   │        Timeline · Curvas · Fila de render     │
 *   └───────────────────────────────────────────────┘
 *
 * Construído por API em vez de um JSON gravado: layout serializado do dockview
 * é opaco e quebra em silêncio quando a biblioteca muda de formato.
 *
 * INVARIANT: a ORDEM das chamadas define a topologia. A timeline entra
 * **antes** das colunas laterais para ocupar a faixa inferior inteira —
 * adicioná-la depois a faria dividir apenas a coluna do viewport, deixando-a
 * presa entre Projeto e Inspector. Verificado por teste de geometria.
 */
export function applyDefaultLayout(api: DockviewApi): void {
  // 1. Viewport ocupa tudo.
  const viewport = api.addPanel({
    id: "viewport",
    component: "viewport",
    title: "Viewport",
  });

  // 2. Timeline divide horizontalmente o grid inteiro → faixa full-width.
  const timeline = api.addPanel({
    id: "timeline",
    component: "timeline",
    title: "Timeline",
    position: { referencePanel: viewport, direction: "below" },
  });

  // 3. Histórico, curvas e fila viram abas na faixa inferior.
  api.addPanel({
    id: "history",
    component: "history",
    title: "Histórico",
    position: { referencePanel: timeline, direction: "within" },
  });

  api.addPanel({
    id: "graph",
    component: "graph",
    title: "Editor de curvas",
    position: { referencePanel: timeline, direction: "within" },
  });

  api.addPanel({
    id: "render-queue",
    component: "render-queue",
    title: "Fila de render",
    position: { referencePanel: timeline, direction: "within" },
  });

  // 4. Colunas laterais dividem só a faixa superior.
  const project = api.addPanel({
    id: "project",
    component: "project",
    title: "Projeto",
    position: { referencePanel: viewport, direction: "left" },
  });

  api.addPanel({
    id: "library",
    component: "library",
    title: "Biblioteca",
    position: { referencePanel: project, direction: "below" },
  });

  const inspector = api.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { referencePanel: viewport, direction: "right" },
  });

  const effects = api.addPanel({
    id: "effects",
    component: "effects",
    title: "Efeitos",
    position: { referencePanel: inspector, direction: "below" },
  });

  api.addPanel({
    id: "actions",
    component: "actions",
    title: "Ações",
    position: { referencePanel: effects, direction: "within" },
  });

  timeline.api.setActive();
  sizeGroups(api);
}

/**
 * Proporções iniciais: o viewport recebe o espaço, laterais e timeline ficam no
 * mínimo utilizável.
 *
 * PRECONDIÇÃO: o container já tem tamanho medido. Quem chama garante isso —
 * `useWorkspaceLayout` espera `api.width > 0` antes de montar o layout, porque
 * o dockview lê o DOM para calcular posição de grid.
 */
function sizeGroups(api: DockviewApi): void {
  const width = api.width;
  const height = api.height;
  if (width === 0 || height === 0) return;

  api.getPanel("project")?.api.setSize({ width: Math.round(width * 0.16) });
  api.getPanel("inspector")?.api.setSize({ width: Math.round(width * 0.19) });
  api.getPanel("timeline")?.api.setSize({ height: Math.round(height * 0.34) });
}
