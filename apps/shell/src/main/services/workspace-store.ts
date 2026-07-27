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

    return parsed as WorkspaceState;
  } catch {
    return null;
  }
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  const target = filePath();
  const temporary = `${target}.${randomUUID()}.tmp`;

  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, target);
  } catch (error: unknown) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * Variante bloqueante usada somente quando a janela está sendo destruída.
 *
 * `ipcRenderer.invoke` não tem garantia de terminar durante `pagehide`; um IPC
 * síncrono com esta escrita pequena garante que o último arraste não se perca.
 */
export function flushWorkspace(state: WorkspaceState): void {
  const target = filePath();
  const temporary = `${target}.${randomUUID()}.tmp`;

  mkdirSync(path.dirname(target), { recursive: true });
  try {
    writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
    renameSync(temporary, target);
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
  await unlink(filePath()).catch(() => {});
}
