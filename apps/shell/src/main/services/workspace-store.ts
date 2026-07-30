/**
 * Persistência do layout de painéis.
 *
 * Escrita atômica (tmp + rename) pelo mesmo motivo do arquivo de projeto: uma
 * queda de energia no meio do save não deve deixar um JSON truncado que impeça
 * o app de abrir. Um layout perdido é irritante; um layout corrompido que
 * quebra a inicialização é pior.
 */

import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_VERSION, type WorkspaceState } from "../../ipc/contracts.js";

const FILE_NAME = "workspace.json";
let workspaceGeneration = 0;
let latestSavedAtMs = Number.NEGATIVE_INFINITY;
let saveTail: Promise<void> = Promise.resolve();

function filePath(): string {
  return path.join(app.getPath("userData"), FILE_NAME);
}

export async function loadWorkspace(): Promise<WorkspaceState | null> {
  try {
    const raw = await readFile(filePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      (parsed as { version: unknown }).version !== WORKSPACE_VERSION
    ) {
      // Versão desconhecida: cai para o layout padrão em silêncio. É estado de
      // sessão, não dado do usuário — não vale um diálogo de erro.
      return null;
    }

    const state = parsed as WorkspaceState;
    if (Number.isFinite(state.savedAtMs)) {
      latestSavedAtMs = Math.max(latestSavedAtMs, state.savedAtMs);
    }
    return state;
  } catch {
    return null;
  }
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  if (!Number.isFinite(state.savedAtMs)) {
    throw new RangeError("workspace precisa de savedAtMs finito");
  }
  const generation = ++workspaceGeneration;
  const target = filePath();
  const serialized = JSON.stringify(state, null, 2);
  const operation = async (): Promise<void> => {
    if (generation !== workspaceGeneration || state.savedAtMs <= latestSavedAtMs) return;
    const temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(temporary, serialized, "utf8");
      if (generation !== workspaceGeneration || state.savedAtMs <= latestSavedAtMs) {
        await unlink(temporary).catch(() => {});
        return;
      }
      await rename(temporary, target);
      latestSavedAtMs = state.savedAtMs;
    } catch (error: unknown) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  };
  const execution = saveTail.then(operation, operation);
  saveTail = execution.then(
    () => undefined,
    () => undefined,
  );
  return execution;
}

/**
 * Variante bloqueante usada somente quando a janela está sendo destruída.
 *
 * `ipcRenderer.invoke` não tem garantia de terminar durante `pagehide`; um IPC
 * síncrono com esta escrita pequena garante que o último arraste não se perca.
 */
export function flushWorkspace(state: WorkspaceState): void {
  if (!Number.isFinite(state.savedAtMs)) {
    throw new RangeError("workspace precisa de savedAtMs finito");
  }
  workspaceGeneration += 1;
  if (state.savedAtMs <= latestSavedAtMs) return;
  const target = filePath();
  const temporary = `${target}.${randomUUID()}.tmp`;

  mkdirSync(path.dirname(target), { recursive: true });
  try {
    writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
    renameSync(temporary, target);
    latestSavedAtMs = state.savedAtMs;
  } catch (error: unknown) {
    try {
      unlinkSync(temporary);
    } catch {
      // O arquivo temporário pode não ter sido criado.
    }
    throw error;
  }
}

export async function resetWorkspace(): Promise<void> {
  const generation = ++workspaceGeneration;
  latestSavedAtMs = Math.max(latestSavedAtMs, Date.now());
  const operation = async (): Promise<void> => {
    if (generation !== workspaceGeneration) return;
    await unlink(filePath()).catch(() => {});
  };
  const execution = saveTail.then(operation, operation);
  saveTail = execution.then(
    () => undefined,
    () => undefined,
  );
  return execution;
}
