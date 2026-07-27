import type { IDockviewPanelProps } from "dockview-react";
import type { ReactNode } from "react";
import { GraphPanel } from "../panels/graph/GraphPanel.js";
import { HistoryPanel } from "../panels/history/HistoryPanel.js";
import { InspectorPanel } from "../panels/inspector/InspectorPanel.js";
import { ProjectPanel } from "../panels/project/ProjectPanel.js";
import { TimelinePanel } from "../panels/timeline/TimelinePanel.js";
import { MapViewport } from "../panels/viewport/MapViewport.js";
import { Panel, PanelPlaceholder } from "../ui/index.js";

/**
 * Registro dos painéis do editor.
 *
 * Cada fase substitui somente a entrada que passa a ser real. O viewport foi o
 * primeiro: os demais placeholders continuam servindo de mapa do roteiro.
 */

export interface PanelDefinition {
  readonly id: string;
  readonly title: string;
  readonly phase: string;
  readonly hint: string;
}

export const PANEL_DEFINITIONS = [
  {
    id: "project",
    title: "Projeto",
    phase: "Fase 3",
    hint: "Árvore de composições, assets e pastas.",
  },
  {
    id: "history",
    title: "Histórico",
    phase: "Fase 3",
    hint: "Undo e redo transacionais por patches.",
  },
  {
    id: "library",
    title: "Biblioteca",
    phase: "Fase 10",
    hint: "Unidades militares por era, nação e categoria. Busca e filtro.",
  },
  {
    id: "viewport",
    title: "Viewport",
    phase: "Fase 2",
    hint: "MapLibre com PMTiles offline, mais o overlay Pixi. O primeiro painel real.",
  },
  {
    id: "inspector",
    title: "Inspector",
    phase: "Fase 4",
    hint: "Gerado a partir dos PropertyDescriptor do tipo de nó — sem código de UI por tipo.",
  },
  {
    id: "effects",
    title: "Efeitos",
    phase: "Fase 6",
    hint: "Pilha de efeitos do nó selecionado, com parâmetros animáveis.",
  },
  {
    id: "timeline",
    title: "Timeline",
    phase: "Fase 4",
    hint: "Trilhas e keyframes desenhados em canvas — DOM não sustenta 3.000 keyframes a 60 fps.",
  },
  {
    id: "graph",
    title: "Editor de curvas",
    phase: "Fase 5",
    hint: "Curvas de valor e velocidade, com handles bezier arrastáveis.",
  },
  {
    id: "render-queue",
    title: "Fila de render",
    phase: "Fase 8",
    hint: "Jobs, progresso, ETA e relatório por frame (settle, tentativas, tamanho).",
  },
] as const satisfies readonly PanelDefinition[];

export type PanelId = (typeof PANEL_DEFINITIONS)[number]["id"];

function placeholderPanel(definition: PanelDefinition) {
  return function PlaceholderPanel(_props: IDockviewPanelProps): ReactNode {
    return (
      <Panel scroll={false}>
        <PanelPlaceholder
          label={definition.title}
          phase={definition.phase}
          hint={definition.hint}
        />
      </Panel>
    );
  };
}

/** Componentes por id, no formato que o dockview espera. */
export const PANEL_COMPONENTS: Record<string, (props: IDockviewPanelProps) => ReactNode> = {
  ...Object.fromEntries(PANEL_DEFINITIONS.map((d) => [d.id, placeholderPanel(d)])),
  viewport: function ViewportPanel(_props: IDockviewPanelProps): ReactNode {
    return <MapViewport />;
  },
  project: function ProjectTreePanel(_props: IDockviewPanelProps): ReactNode {
    return <ProjectPanel />;
  },
  history: function CommandHistoryPanel(_props: IDockviewPanelProps): ReactNode {
    return <HistoryPanel />;
  },
  inspector: function NodeInspectorPanel(_props: IDockviewPanelProps): ReactNode {
    return <InspectorPanel />;
  },
  timeline: function CompositionTimelinePanel(_props: IDockviewPanelProps): ReactNode {
    return <TimelinePanel />;
  },
  graph: function PropertyGraphPanel(_props: IDockviewPanelProps): ReactNode {
    return <GraphPanel />;
  },
};

export const PANEL_TITLES: Record<string, string> = Object.fromEntries(
  PANEL_DEFINITIONS.map((d) => [d.id, d.title]),
);
