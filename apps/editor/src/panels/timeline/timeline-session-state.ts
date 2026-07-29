import { useSyncExternalStore } from "react";
import type { WorkspaceContentMode } from "../../app/workspace-content-mode.js";
import type { TimelineViewState } from "./timeline-canvas.js";

/**
 * Estado de navegação da Timeline, separado do documento e por superfície.
 *
 * Fica no módulo para sobreviver à desmontagem que o dockview faz quando outra
 * aba inferior é ativada. Reiniciar o renderer o descarta de propósito
 * ([ADR-019](../../../../../docs/adr/ADR-019-studio-aware-timeline.md)).
 */
export interface TimelineSessionState {
  readonly compositionId: string | null;
  readonly view: TimelineViewState;
  readonly scrollY: number;
  readonly expandedNodeIds: ReadonlySet<string>;
}

const listeners = new Set<() => void>();
const states: Record<WorkspaceContentMode, TimelineSessionState> = {
  map: createInitialState(),
  studio: createInitialState(),
};

export function getTimelineSessionState(mode: WorkspaceContentMode): TimelineSessionState {
  return states[mode];
}

export function subscribeTimelineSessionState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTimelineSessionState(mode: WorkspaceContentMode): TimelineSessionState {
  return useSyncExternalStore(
    subscribeTimelineSessionState,
    () => getTimelineSessionState(mode),
    () => getTimelineSessionState(mode),
  );
}

export function updateTimelineSessionState(
  mode: WorkspaceContentMode,
  update: (current: TimelineSessionState) => TimelineSessionState,
): void {
  const current = states[mode];
  const next = normalizeState(update(current));
  if (sameState(current, next)) return;
  states[mode] = next;
  for (const listener of listeners) listener();
}

/**
 * Composição nova começa no frame zero e com as linhas essenciais abertas.
 * Reencontrar a mesma composição não faz nada: reabrir um id "obrigatório"
 * apagaria a escolha explícita de recolhê-lo.
 */
export function enterTimelineComposition(
  mode: WorkspaceContentMode,
  compositionId: string | null,
  initiallyExpanded: readonly string[],
): void {
  updateTimelineSessionState(mode, (current) => {
    if (current.compositionId === compositionId) return current;
    return {
      compositionId,
      view: { startFrame: 0, pixelsPerFrame: 2 },
      scrollY: 0,
      expandedNodeIds: new Set(initiallyExpanded),
    };
  });
}

/** Normalização explícita usada pelos testes; não faz parte de persistência. */
export function resetTimelineSessionState(): void {
  states.map = createInitialState();
  states.studio = createInitialState();
  for (const listener of listeners) listener();
}

function createInitialState(): TimelineSessionState {
  return Object.freeze({
    compositionId: null,
    view: Object.freeze({ startFrame: 0, pixelsPerFrame: 2 }),
    scrollY: 0,
    expandedNodeIds: new Set<string>(),
  });
}

function normalizeState(state: TimelineSessionState): TimelineSessionState {
  return Object.freeze({
    compositionId: state.compositionId,
    view: Object.freeze({
      startFrame: state.view.startFrame,
      pixelsPerFrame: state.view.pixelsPerFrame,
    }),
    scrollY: state.scrollY,
    expandedNodeIds: new Set(state.expandedNodeIds),
  });
}

function sameState(left: TimelineSessionState, right: TimelineSessionState): boolean {
  return (
    left.compositionId === right.compositionId &&
    left.view.startFrame === right.view.startFrame &&
    left.view.pixelsPerFrame === right.view.pixelsPerFrame &&
    left.scrollY === right.scrollY &&
    sameIds(left.expandedNodeIds, right.expandedNodeIds)
  );
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
}
