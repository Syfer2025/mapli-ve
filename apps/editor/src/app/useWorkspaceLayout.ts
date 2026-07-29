import { useCallback, useEffect, useRef, useState } from "react";
import type { DockviewApi, DockviewReadyEvent } from "dockview-react";
import { bridge } from "../bridge/index.js";
import { WORKSPACE_VERSION, type WorkspaceState } from "@theatrum/shell";
import { applyDefaultLayout } from "./default-layout.js";
import { PANEL_DEFINITIONS } from "./panels.js";
import { bindWorkspaceContentMode } from "./workspace-content-mode.js";

const SAVE_DEBOUNCE_MS = 400;
const MAX_LAYOUT_WAIT_FRAMES = 120;

/**
 * Espera o container ter tamanho medido.
 *
 * O dockview calcula posição de grid a partir do DOM: `addPanel` com
 * `referencePanel` chama `getGridLocation`, que lê `parentElement` do elemento
 * de referência. Com o container em 0×0 os grupos ficariam presos no tamanho
 * mínimo de 100 px.
 */
function waitForContainerSize(api: DockviewApi): Promise<boolean> {
  return new Promise((resolve) => {
    let frames = 0;
    const tick = (): void => {
      if (api.width > 0 && api.height > 0) {
        resolve(true);
        return;
      }
      if (++frames >= MAX_LAYOUT_WAIT_FRAMES) {
        resolve(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * Painel registrado que não existe no layout restaurado entra como aba.
 *
 * Sem isto, **todo painel novo é invisível para quem já usou o aplicativo**: o
 * layout salvo do usuário não conhece o painel, `fromJSON` restaura só o que está
 * lá, e o recurso recém-entregue simplesmente não aparece. Não é layout inválido
 * — o `catch` acima não pega —, é layout velho, e ele é restaurado com sucesso.
 * Aconteceu com o Palco 3D ([ADR-014](../../../../docs/adr/ADR-014-studio-own-panel.md)):
 * a aba não apareceu e o motivo não tinha nada a ver com o painel.
 *
 * A aba entra ao lado do primeiro grupo existente, sem tentar adivinhar a posição
 * "certa": layout é do usuário, e mover painéis dele por conta própria seria pior
 * que colocar o novo num lugar previsível. Quem quiser o arranjo padrão tem
 * "Restaurar layout".
 */
function adoptMissingPanels(api: DockviewApi): void {
  const reference = api.panels[0];
  if (reference === undefined) return;
  for (const definition of PANEL_DEFINITIONS) {
    if (api.getPanel(definition.id) !== undefined) continue;
    api.addPanel({
      id: definition.id,
      component: definition.id,
      title: definition.title,
      position: { referencePanel: reference, direction: "within" },
      inactive: true,
    });
  }
}

function snapshotWorkspace(api: DockviewApi): WorkspaceState {
  return {
    layout: api.toJSON(),
    version: WORKSPACE_VERSION,
    // Timestamp é metadado de sessão e não entra em nada determinístico.
    savedAtMs: Date.now(),
  };
}

export interface WorkspaceLayout {
  readonly onReady: (event: DockviewReadyEvent) => void;
  readonly restored: boolean;
  readonly resetLayout: () => void;
}

/**
 * Restaura o layout salvo na inicialização e persiste mudanças com debounce.
 *
 * Layout é estado de **sessão**, não do documento: mora no userData do app, não
 * no `.theatrum`, e nunca influencia o pixel renderizado
 * (docs/01-ARCHITECTURE.md § 2).
 */
export function useWorkspaceLayout(): WorkspaceLayout {
  const apiRef = useRef<DockviewApi | null>(null);
  const contentModeBinding = useRef<{ dispose(): void } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<WorkspaceState | null>(null);
  const [restored, setRestored] = useState(false);

  /**
   * Contador de geração para descartar montagens obsoletas.
   *
   * React StrictMode monta, desmonta e remonta em desenvolvimento, então
   * `onReady` dispara mais de uma vez. Sem este guarda, a cadeia assíncrona da
   * PRIMEIRA instância continua rodando depois de o DOM dela ser destruído, e
   * `addPanel` estoura com `Cannot read properties of null (reading
   * 'parentElement')` — o erro que aparecia no console do dev.
   *
   * StrictMode fica ligado de propósito: foi ele que expôs o bug.
   */
  const generation = useRef(0);

  const flushPendingSave = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    const state = pendingSave.current;
    pendingSave.current = null;
    if (state !== null) void bridge.workspace.save(state);
  }, []);

  const persist = useCallback(
    (api: DockviewApi) => {
      // Captura o snapshot agora: quando o debounce terminar, a instância pode
      // já ter sido desmontada pelo StrictMode ou pelo fechamento da janela.
      pendingSave.current = snapshotWorkspace(api);

      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS);
    },
    [flushPendingSave],
  );

  const flushCurrentWorkspace = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingSave.current = null;

    const api = apiRef.current;
    if (api !== null) bridge.workspace.flush(snapshotWorkspace(api));
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const mine = ++generation.current;
      const isStale = (): boolean => generation.current !== mine;

      contentModeBinding.current?.dispose();
      contentModeBinding.current = null;
      apiRef.current = event.api;

      void (async () => {
        const sized = await waitForContainerSize(event.api);
        if (isStale()) return;

        if (!sized) {
          // Container nunca ganhou tamanho (aba oculta, viewport 0×0). Montar
          // aqui produziria um layout degenerado que depois seria salvo por
          // cima do bom — melhor não montar e deixar o próximo mount tratar.
          return;
        }

        const saved = await bridge.workspace.load();
        if (isStale()) return;

        try {
          let usedSaved = false;
          if (saved !== null) {
            try {
              event.api.fromJSON(saved.layout as never);
              usedSaved = true;
            } catch {
              // Layout inválido (painel removido, formato mudou): cai para o
              // padrão em vez de deixar a janela vazia. É estado descartável.
              event.api.clear();
            }
          }

          if (usedSaved) adoptMissingPanels(event.api);
          else applyDefaultLayout(event.api);
        } catch (error: unknown) {
          // Última linha de defesa: nunca deixar a janela sem painel algum.
          if (isStale()) return;
          throw error;
        }

        if (isStale()) return;
        setRestored(true);
        contentModeBinding.current = bindWorkspaceContentMode(event.api);

        // Só assina DEPOIS de restaurar, senão a própria restauração
        // dispararia um save e sobrescreveria o layout com o padrão.
        event.api.onDidLayoutChange(() => {
          if (isStale()) return;
          persist(event.api);
        });
      })();
    },
    [persist],
  );

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (api === null) return;
    api.clear();
    applyDefaultLayout(api);
    contentModeBinding.current?.dispose();
    contentModeBinding.current = bindWorkspaceContentMode(api);
    persist(api);
  }, [persist]);

  useEffect(() => {
    // Electron dispara `beforeunload` ao fechar a janela; `pagehide` cobre
    // reload/navegação. O guarda evita duas escritas quando ambos acontecem.
    let flushedForExit = false;
    const flushForExit = (): void => {
      if (flushedForExit) return;
      flushedForExit = true;
      flushCurrentWorkspace();
    };

    window.addEventListener("beforeunload", flushForExit);
    window.addEventListener("pagehide", flushForExit);

    return () => {
      window.removeEventListener("beforeunload", flushForExit);
      window.removeEventListener("pagehide", flushForExit);
      contentModeBinding.current?.dispose();
      contentModeBinding.current = null;
      flushPendingSave();
    };
  }, [flushCurrentWorkspace, flushPendingSave]);

  return { onReady, restored, resetLayout };
}
