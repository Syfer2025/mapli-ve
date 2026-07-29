import { useSyncExternalStore } from "react";
import type { DockviewActivePanelChangeEvent, DockviewApi } from "dockview-react";

/**
 * Qual das duas superfícies de conteúdo dá significado aos painéis auxiliares.
 *
 * É estado de sessão, nunca do documento: trocar de Mapa para Palco não pode
 * sujar o projeto nem entrar no undo ([ADR-019](../../../../docs/adr/ADR-019-studio-aware-timeline.md)).
 */
export type WorkspaceContentMode = "map" | "studio";

interface Disposable {
  dispose(): void;
}

type WorkspaceModeApi = Pick<DockviewApi, "activePanel" | "getPanel" | "onDidActivePanelChange">;

const listeners = new Set<() => void>();
let snapshot: WorkspaceContentMode = "map";

export function getWorkspaceContentMode(): WorkspaceContentMode {
  return snapshot;
}

export function subscribeWorkspaceContentMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceContentMode(): WorkspaceContentMode {
  return useSyncExternalStore(
    subscribeWorkspaceContentMode,
    getWorkspaceContentMode,
    getWorkspaceContentMode,
  );
}

/**
 * Atualiza só quando o sinal realmente é uma superfície de conteúdo.
 *
 * `timeline`, `inspector` e companhia devolvem `false`: quem os ativa veio de
 * algum contexto e esse contexto precisa sobreviver ao foco auxiliar.
 */
export function acceptWorkspaceContentPanel(panelId: string | undefined): boolean {
  const next = contentModeForPanelId(panelId);
  if (next === null || next === snapshot) return next !== null;
  snapshot = next;
  for (const listener of listeners) listener();
  return true;
}

/**
 * Descobre a aba escolhida depois de restaurar o layout.
 *
 * No arranjo normal Viewport e Palco são irmãos no mesmo grupo; o painel ativo
 * desse grupo continua significativo mesmo se a Timeline for o painel ativo
 * global. Se o usuário separou as duas abas em grupos diferentes, só há resposta
 * inequívoca quando uma delas é também o painel global; caso contrário o Mapa é
 * o recuo documentado no ADR-019.
 */
export function inferWorkspaceContentMode(api: WorkspaceModeApi): WorkspaceContentMode {
  const viewport = api.getPanel("viewport");
  const studio = api.getPanel("studio");
  if (viewport !== undefined && studio !== undefined && viewport.group === studio.group) {
    return contentModeForPanelId(viewport.group.activePanel?.id) ?? "map";
  }
  return contentModeForPanelId(api.activePanel?.id) ?? "map";
}

/**
 * Liga o store ao dockview já restaurado.
 *
 * A origem do evento pode ser usuário ou API. Os verificadores ativam abas por
 * API, e a superfície que ficou visível é o contexto correto nos dois casos.
 */
export function bindWorkspaceContentMode(api: WorkspaceModeApi): Disposable {
  setWorkspaceContentMode(inferWorkspaceContentMode(api));
  return api.onDidActivePanelChange((event: DockviewActivePanelChangeEvent) => {
    acceptWorkspaceContentPanel(event.panel?.id);
  });
}

/** Testes e a restauração explícita do layout precisam poder normalizar o store. */
export function setWorkspaceContentMode(next: WorkspaceContentMode): void {
  if (snapshot === next) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function contentModeForPanelId(panelId: string | undefined): WorkspaceContentMode | null {
  if (panelId === "viewport") return "map";
  if (panelId === "studio") return "studio";
  return null;
}
