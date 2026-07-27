/**
 * Composição do autosave puro com o filesystem do Node.
 *
 * A lógica incremental vive em @theatrum/project-io; este arquivo só fornece
 * o adapter do sistema operacional e traduz Result para o contrato IPC.
 */

import { app } from "electron";
import {
  createAutosaveManager,
  findRecoveryCandidates,
  parseProjectContainer,
  recoverAutosave,
  writeAtomic,
  type AutosaveManager,
  type FileSystemEntry,
  type ProjectFileSystemPort,
} from "@theatrum/project-io";
import { safeParseProjectDocument, type ProjectDocument } from "@theatrum/schema";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  RecoveryCandidatesResult,
  RecoveryDocumentResult,
  RecoveryOperationResult,
  RecoveryRecordRequest,
  RecoveryStartRequest,
} from "../../ipc/contracts.js";

const RECOVERY_DIRECTORY = "recovery";
const RECOVERY_CONTAINER_FILE = "container.theatrum";
const MAX_RECOVERY_CONTAINER_BYTES = 1024 * 1024 * 1024;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const clock = { now: (): number => Date.now() };

const fileSystem: ProjectFileSystemPort = {
  async read(filePath) {
    const bytes = await readFile(filePath);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  },
  async write(filePath, bytes) {
    await writeFile(filePath, bytes);
  },
  async sync(filePath) {
    const metadata = await stat(filePath);
    // Windows não oferece fsync portátil de diretório. O rename continua
    // atômico; o arquivo temporário já foi sincronizado antes dele.
    if (metadata.isDirectory() && process.platform === "win32") return;
    // Windows exige um handle gravável para FlushFileBuffers (fsync).
    const handle = await open(filePath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async rename(source, destination) {
    await rename(source, destination);
  },
  async remove(filePath, options) {
    await rm(filePath, { recursive: options?.recursive ?? false, force: true });
  },
  async mkdir(directory) {
    await mkdir(directory, { recursive: true });
  },
  async list(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry): FileSystemEntry => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
      }));
  },
};

let active: {
  readonly projectId: string;
  readonly manager: AutosaveManager;
  dirty: boolean;
} | null = null;
let serviceQueue: Promise<void> = Promise.resolve();

export function startRecovery(request: RecoveryStartRequest): Promise<RecoveryOperationResult> {
  return serializeRecoveryOperation(async () => {
    const document = parseDocument(request.document);
    if (typeof document === "string") return failure(document);
    const container = validateRecoveryContainer(request.container, document.id);
    if (typeof container === "string") return failure(container);

    const previous = active;
    active = null;
    if (previous !== null) {
      const closed = await previous.manager.closeClean();
      if (!closed.ok) {
        active = previous;
        return failure(closed.error.message);
      }
    }
    const manager = createAutosaveManager({
      fileSystem,
      recoveryRoot: recoveryRoot(),
      projectId: document.id,
      projectPath: request.projectPath,
      pid: process.pid,
      clock,
    });
    const initialized = await manager.initialize(document);
    if (!initialized.ok) return failure(initialized.error.message);
    const containerPath = recoveryContainerPath(document.id);
    if (container === undefined) {
      try {
        await fileSystem.remove(containerPath);
      } catch (cause: unknown) {
        await manager.closeClean();
        return failure(`Não foi possível limpar o container de recuperação: ${String(cause)}`);
      }
    } else {
      const saved = await writeAtomic(fileSystem, containerPath, container);
      if (!saved.ok) {
        await manager.closeClean();
        return failure(saved.error.message);
      }
    }
    active = { projectId: document.id, manager, dirty: false };
    return success();
  });
}

export function recordRecovery(request: RecoveryRecordRequest): Promise<RecoveryOperationResult> {
  const document = parseDocument(request.document);
  if (typeof document === "string") return Promise.resolve(failure(document));
  if (active === null || active.projectId !== document.id) {
    return Promise.resolve(failure("A sessão de autosave não corresponde ao projeto aberto."));
  }
  // A partir do momento em que uma edição chega ao main, uma saída normal
  // precisa preservar a recuperação mesmo se a gravação ainda estiver na fila
  // ou vier a falhar.
  active.dirty = true;
  return serializeRecoveryOperation(async () => {
    if (active === null || active.projectId !== document.id) {
      return failure("A sessão de autosave não corresponde ao projeto aberto.");
    }
    const recorded = await active.manager.record(document, {
      commands: request.commands,
      force: request.force,
    });
    return recorded.ok ? success() : failure(recorded.error.message);
  });
}

export function heartbeatRecovery(): Promise<RecoveryOperationResult> {
  return serializeRecoveryOperation(async () => {
    if (active === null) return success();
    const result = await active.manager.heartbeat();
    return result.ok ? success() : failure(result.error.message);
  });
}

export function listRecoveryCandidates(): Promise<RecoveryCandidatesResult> {
  return serializeRecoveryOperation(async () => {
    const found = await findRecoveryCandidates({
      fileSystem,
      recoveryRoot: recoveryRoot(),
      clock,
      isProcessAlive,
    });
    if (!found.ok) return failure(found.error.message);
    return {
      ok: true,
      candidates: found.value.map(({ projectId, projectPath, heartbeat, sequence }) => ({
        projectId,
        projectPath,
        heartbeat,
        sequence,
      })),
    };
  });
}

export function recoverDocument(projectId: string): Promise<RecoveryDocumentResult> {
  return serializeRecoveryOperation(async () => {
    if (!PROJECT_ID_PATTERN.test(projectId)) return failure("Identificador de projeto inválido.");
    const result = await recoverAutosave({
      fileSystem,
      recoveryRoot: recoveryRoot(),
      projectId,
    });
    if (!result.ok) return failure(result.error.message);
    const container = await readRecoveryContainer(projectId);
    if (typeof container === "string") return failure(container);
    return { ok: true, document: result.value, container };
  });
}

export function discardRecovery(projectId: string): Promise<RecoveryOperationResult> {
  return serializeRecoveryOperation(async () => {
    if (!PROJECT_ID_PATTERN.test(projectId)) return failure("Identificador de projeto inválido.");
    if (active?.projectId === projectId) active = null;
    await rm(path.join(recoveryRoot(), projectId), { recursive: true, force: true });
    return success();
  });
}

export function closeRecoveryClean(): Promise<RecoveryOperationResult> {
  return serializeRecoveryOperation(async () => {
    const current = active;
    active = null;
    if (current === null) return success();
    const result = await current.manager.closeClean();
    return result.ok ? success() : failure(result.error.message);
  });
}

/** Em saída normal, preserva autosave somente quando há edição não salva. */
export function shouldPreserveRecoveryOnQuit(): boolean {
  return active?.dirty ?? false;
}

function recoveryRoot(): string {
  return path.join(app.getPath("userData"), RECOVERY_DIRECTORY);
}

function recoveryContainerPath(projectId: string): string {
  return path.join(recoveryRoot(), projectId, RECOVERY_CONTAINER_FILE);
}

function parseDocument(value: unknown): ProjectDocument | string {
  const parsed = safeParseProjectDocument(value);
  return parsed.success ? parsed.data : parsed.error.message;
}

function validateRecoveryContainer(
  value: Uint8Array | undefined,
  projectId: string,
): Uint8Array | undefined | string {
  if (value === undefined) return undefined;
  if (!(value instanceof Uint8Array)) return "Container-base de recuperação inválido.";
  if (value.byteLength > MAX_RECOVERY_CONTAINER_BYTES) {
    return "Container-base de recuperação excede o limite de 1 GiB.";
  }
  const bytes = Uint8Array.from(value);
  const parsed = parseProjectContainer(bytes);
  if (!parsed.ok) return `Container-base de recuperação inválido: ${parsed.error.message}`;
  if (parsed.value.document.id !== projectId) {
    return "O container-base de recuperação não pertence ao documento aberto.";
  }
  return bytes;
}

async function readRecoveryContainer(projectId: string): Promise<Uint8Array | null | string> {
  let bytes: Uint8Array;
  try {
    bytes = await fileSystem.read(recoveryContainerPath(projectId));
  } catch (cause: unknown) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") {
      return null;
    }
    return `Não foi possível ler o container-base de recuperação: ${String(cause)}`;
  }

  const parsed = parseProjectContainer(bytes);
  if (!parsed.ok) return `Container-base de recuperação inválido: ${parsed.error.message}`;
  if (parsed.value.document.id !== projectId) {
    return "O container-base de recuperação pertence a outro projeto.";
  }
  return bytes;
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function success(): RecoveryOperationResult {
  return { ok: true };
}

function failure(message: string): { readonly ok: false; readonly message: string } {
  return { ok: false, message };
}

function serializeRecoveryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = serviceQueue.then(operation);
  serviceQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
