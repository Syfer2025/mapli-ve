import { err, ok, type Result } from "@theatrum/core-utils";
import {
  CURRENT_SCHEMA_VERSION,
  FutureSchemaVersionError,
  InvalidSchemaVersionError,
  safeParseProjectDocument,
  type ProjectDocument,
} from "@theatrum/schema";

import { encodeCanonicalJson, parseJsonBytes } from "./canonical-json.js";
import { describeCause, projectError, type ProjectError } from "./errors.js";
import { joinPath, readFile, writeAtomic, type ProjectFileSystemPort } from "./filesystem.js";
import { applyJsonPatch, diffJson, type JsonPatchOperation } from "./json-patch.js";

const DEFAULT_PATCH_INTERVAL_MS = 30_000;
const DEFAULT_BASE_INTERVAL_MS = 10 * 60_000;
const DEFAULT_COMMAND_INTERVAL = 20;
const DEFAULT_STALE_AFTER_MS = 15_000;

export interface RecoveryClockPort {
  now(): number;
}

export interface RecoverySession {
  readonly projectId: string;
  readonly projectPath: string | null;
  readonly pid: number;
  readonly heartbeat: number;
  readonly sequence: number;
  readonly schemaVersion: number;
  readonly baseGeneration: number;
}

export interface RecoveryPatch {
  readonly baseGeneration: number;
  readonly sequence: number;
  readonly operations: readonly JsonPatchOperation[];
}

interface RecoveryBase {
  readonly generation: number;
  readonly document: ProjectDocument;
}

export interface RecoveryCandidate {
  readonly projectId: string;
  readonly projectPath: string | null;
  readonly heartbeat: number;
  readonly sequence: number;
  readonly directory: string;
}

export interface AutosaveOptions {
  readonly fileSystem: ProjectFileSystemPort;
  readonly recoveryRoot: string;
  readonly projectId: string;
  readonly projectPath: string | null;
  readonly pid: number;
  readonly clock: RecoveryClockPort;
  readonly patchIntervalMs?: number;
  readonly baseIntervalMs?: number;
  readonly commandInterval?: number;
}

export interface RecordAutosaveOptions {
  readonly commands?: number;
  readonly force?: boolean;
}

export interface AutosaveManager {
  initialize(document: ProjectDocument): Promise<Result<void, ProjectError>>;
  record(
    document: ProjectDocument,
    options?: RecordAutosaveOptions,
  ): Promise<Result<"base" | "patch" | "skipped", ProjectError>>;
  heartbeat(): Promise<Result<void, ProjectError>>;
  closeClean(): Promise<Result<void, ProjectError>>;
}

export function createAutosaveManager(options: AutosaveOptions): AutosaveManager {
  const patchInterval = options.patchIntervalMs ?? DEFAULT_PATCH_INTERVAL_MS;
  const baseInterval = options.baseIntervalMs ?? DEFAULT_BASE_INTERVAL_MS;
  const commandInterval = options.commandInterval ?? DEFAULT_COMMAND_INTERVAL;
  const directory = recoveryDirectory(options.recoveryRoot, options.projectId);

  let previous: ProjectDocument | null = null;
  let sequence = 0;
  let pendingCommands = 0;
  let lastPatchAt = 0;
  let lastBaseAt = 0;
  let baseGeneration = 1;
  let operationQueue: Promise<void> = Promise.resolve();

  async function writeSession(document: ProjectDocument): Promise<Result<void, ProjectError>> {
    const session: RecoverySession = {
      projectId: options.projectId,
      projectPath: options.projectPath,
      pid: options.pid,
      heartbeat: options.clock.now(),
      sequence,
      schemaVersion: document.schemaVersion,
      baseGeneration,
    };
    return writeJsonAtomic(options.fileSystem, joinPath(directory, "session.json"), session);
  }

  const implementation: AutosaveManager = {
    async initialize(document) {
      if (document["id"] !== options.projectId) {
        return err(
          projectError("invalid-document", "projectId do autosave diverge do documento.", {
            pointer: "/id",
            expected: options.projectId,
            actual: String(document["id"]),
          }),
        );
      }
      try {
        await options.fileSystem.mkdir(options.recoveryRoot);
        await options.fileSystem.mkdir(directory);
      } catch (cause) {
        return ioError("inicializar recuperação", directory, cause);
      }

      const base = await writeJsonAtomic(options.fileSystem, joinPath(directory, "base.json"), {
        generation: baseGeneration,
        document,
      } satisfies RecoveryBase);
      if (!base.ok) return base;
      const cleared = await removePatchFiles(options.fileSystem, directory);
      if (!cleared.ok) return cleared;

      previous = cloneDocument(document);
      sequence = 0;
      pendingCommands = 0;
      lastPatchAt = options.clock.now();
      lastBaseAt = lastPatchAt;
      return writeSession(document);
    },

    async record(document, recordOptions = {}) {
      if (previous === null) {
        return err(
          projectError("io", "Autosave precisa ser inicializado antes de registrar mudanças."),
        );
      }
      pendingCommands += recordOptions.commands ?? 1;
      const currentTime = options.clock.now();

      if (currentTime - lastBaseAt >= baseInterval) {
        const nextGeneration = baseGeneration + 1;
        const base = await writeJsonAtomic(options.fileSystem, joinPath(directory, "base.json"), {
          generation: nextGeneration,
          document,
        } satisfies RecoveryBase);
        if (!base.ok) return base;
        // O novo snapshot já é a fonte de verdade. Patches da geração anterior
        // podem permanecer após um crash: recoverAutosave os ignora pelo token.
        baseGeneration = nextGeneration;
        previous = cloneDocument(document);
        sequence = 0;
        pendingCommands = 0;
        lastBaseAt = currentTime;
        lastPatchAt = currentTime;
        const cleared = await removePatchFiles(options.fileSystem, directory);
        if (!cleared.ok) return cleared;
        const session = await writeSession(document);
        return session.ok ? ok("base") : session;
      }

      const due =
        recordOptions.force === true ||
        currentTime - lastPatchAt >= patchInterval ||
        pendingCommands >= commandInterval;
      if (!due) return ok("skipped");

      const operations = diffJson(previous, document);
      pendingCommands = 0;
      lastPatchAt = currentTime;
      if (operations.length === 0) {
        const session = await writeSession(document);
        return session.ok ? ok("skipped") : session;
      }

      const nextSequence = sequence + 1;
      const patch: RecoveryPatch = { baseGeneration, sequence: nextSequence, operations };
      const saved = await writeJsonAtomic(
        options.fileSystem,
        joinPath(directory, patchFileName(nextSequence)),
        patch,
      );
      if (!saved.ok) return saved;
      sequence = nextSequence;
      previous = cloneDocument(document);
      const session = await writeSession(document);
      return session.ok ? ok("patch") : session;
    },

    async heartbeat() {
      if (previous === null) {
        return err(projectError("io", "Autosave ainda não foi inicializado."));
      }
      return writeSession(previous);
    },

    async closeClean() {
      try {
        await options.fileSystem.remove(directory, { recursive: true });
        previous = null;
        return ok(undefined);
      } catch (cause) {
        return ioError("limpar recuperação", directory, cause);
      }
    },
  };

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    initialize: (document) => serialize(() => implementation.initialize(document)),
    record: (document, recordOptions) =>
      serialize(() => implementation.record(document, recordOptions)),
    heartbeat: () => serialize(() => implementation.heartbeat()),
    closeClean: () => serialize(() => implementation.closeClean()),
  };
}

export interface FindRecoveryOptions {
  readonly fileSystem: ProjectFileSystemPort;
  readonly recoveryRoot: string;
  readonly clock: RecoveryClockPort;
  readonly staleAfterMs?: number;
  readonly isProcessAlive?: (pid: number) => Promise<boolean>;
}

export async function findRecoveryCandidates(
  options: FindRecoveryOptions,
): Promise<Result<readonly RecoveryCandidate[], ProjectError>> {
  let entries;
  try {
    entries = await options.fileSystem.list(options.recoveryRoot);
  } catch {
    return ok([]);
  }

  const currentTime = options.clock.now();
  const staleAfter = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const candidates: RecoveryCandidate[] = [];

  for (const entry of entries) {
    if (entry.kind !== "directory" || !isSafeProjectId(entry.name)) continue;
    const directory = joinPath(options.recoveryRoot, entry.name);
    const sessionResult = await readJson(options.fileSystem, joinPath(directory, "session.json"));
    if (!sessionResult.ok) continue;
    const session = validateSession(sessionResult.value);
    if (!session.ok) continue;

    const alive =
      options.isProcessAlive === undefined
        ? currentTime - session.value.heartbeat <= staleAfter
        : await options.isProcessAlive(session.value.pid);
    if (alive) continue;

    candidates.push({
      projectId: session.value.projectId,
      projectPath: session.value.projectPath,
      heartbeat: session.value.heartbeat,
      sequence: session.value.sequence,
      directory,
    });
  }

  return ok(candidates.sort((left, right) => right.heartbeat - left.heartbeat));
}

export interface RecoverAutosaveOptions {
  readonly fileSystem: ProjectFileSystemPort;
  readonly recoveryRoot: string;
  readonly projectId: string;
}

export async function recoverAutosave(
  options: RecoverAutosaveOptions,
): Promise<Result<ProjectDocument, ProjectError>> {
  const directory = recoveryDirectory(options.recoveryRoot, options.projectId);
  const baseResult = await readJson(options.fileSystem, joinPath(directory, "base.json"));
  if (!baseResult.ok) return baseResult;

  const baseEnvelope = validateRecoveryBase(baseResult.value);
  if (!baseEnvelope.ok) return baseEnvelope;
  const base = parseRecoveryDocument(baseEnvelope.value.document);
  if (!base.ok) return base;

  let entries;
  try {
    entries = await options.fileSystem.list(directory);
  } catch (cause) {
    return ioError("listar patches de recuperação", directory, cause);
  }

  const patchNames = entries
    .filter((entry) => entry.kind === "file" && /^[0-9]{6}\.patch\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  let document: unknown = base.value;
  let expectedSequence = 1;

  for (const name of patchNames) {
    const raw = await readJson(options.fileSystem, joinPath(directory, name));
    if (!raw.ok) return raw;
    const patch = validatePatch(raw.value);
    if (!patch.ok) return patch;
    if (patch.value.baseGeneration !== baseEnvelope.value.generation) continue;

    const fileSequence = Number(name.slice(0, 6));
    if (fileSequence !== expectedSequence) {
      return err(
        projectError(
          "invalid-container",
          `Sequência de autosave interrompida: esperado ${expectedSequence}, encontrado ${fileSequence}.`,
          {
            path: name,
            expected: expectedSequence,
            actual: fileSequence,
          },
        ),
      );
    }
    if (patch.value.sequence !== fileSequence) {
      return err(
        projectError(
          "invalid-container",
          `O conteúdo de ${name} declara a sequência ${patch.value.sequence}.`,
          {
            path: name,
            expected: fileSequence,
            actual: patch.value.sequence,
          },
        ),
      );
    }
    const applied = applyJsonPatch(document, patch.value.operations);
    if (!applied.ok) return applied;
    document = applied.value;
    expectedSequence++;
  }

  return parseRecoveryDocument(document);
}

async function writeJsonAtomic(
  fileSystem: ProjectFileSystemPort,
  path: string,
  value: unknown,
): Promise<Result<void, ProjectError>> {
  const bytes = encodeCanonicalJson(value);
  return bytes.ok ? writeAtomic(fileSystem, path, bytes.value) : bytes;
}

async function readJson(
  fileSystem: ProjectFileSystemPort,
  path: string,
): Promise<Result<unknown, ProjectError>> {
  const bytes = await readFile(fileSystem, path);
  return bytes.ok ? parseJsonBytes(bytes.value, path) : bytes;
}

async function removePatchFiles(
  fileSystem: ProjectFileSystemPort,
  directory: string,
): Promise<Result<void, ProjectError>> {
  try {
    const entries = await fileSystem.list(directory);
    for (const entry of entries) {
      if (entry.kind === "file" && /^[0-9]{6}\.patch\.json(?:\.tmp)?$/.test(entry.name)) {
        await fileSystem.remove(joinPath(directory, entry.name));
      }
    }
    return ok(undefined);
  } catch (cause) {
    return ioError("compactar autosave", directory, cause);
  }
}

function validateSession(value: unknown): Result<RecoverySession, ProjectError> {
  if (
    !isRecord(value) ||
    typeof value["projectId"] !== "string" ||
    (typeof value["projectPath"] !== "string" && value["projectPath"] !== null) ||
    !Number.isSafeInteger(value["pid"]) ||
    !Number.isFinite(value["heartbeat"]) ||
    !Number.isSafeInteger(value["sequence"]) ||
    !Number.isSafeInteger(value["schemaVersion"]) ||
    !Number.isSafeInteger(value["baseGeneration"])
  ) {
    return err(projectError("invalid-container", "session.json de recuperação é inválido."));
  }
  return ok(value as unknown as RecoverySession);
}

function validatePatch(value: unknown): Result<RecoveryPatch, ProjectError> {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value["baseGeneration"]) ||
    !Number.isSafeInteger(value["sequence"]) ||
    !Array.isArray(value["operations"])
  ) {
    return err(projectError("invalid-container", "Patch de recuperação inválido."));
  }
  for (const operation of value["operations"]) {
    if (
      !isRecord(operation) ||
      !["add", "remove", "replace"].includes(String(operation["op"])) ||
      typeof operation["path"] !== "string" ||
      (operation["op"] !== "remove" && !Object.hasOwn(operation, "value"))
    ) {
      return err(projectError("invalid-container", "Operação inválida em patch de recuperação."));
    }
  }
  return ok(value as unknown as RecoveryPatch);
}

function validateRecoveryBase(value: unknown): Result<RecoveryBase, ProjectError> {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value["generation"]) ||
    !Object.hasOwn(value, "document")
  ) {
    return err(projectError("invalid-container", "base.json de recuperação é inválido."));
  }
  return ok(value as unknown as RecoveryBase);
}

function patchFileName(sequence: number): string {
  return `${sequence.toString().padStart(6, "0")}.patch.json`;
}

function recoveryDirectory(root: string, projectId: string): string {
  if (!isSafeProjectId(projectId)) {
    throw new Error(`projectId inseguro para recovery: "${projectId}"`);
  }
  return joinPath(root, projectId);
}

function isSafeProjectId(projectId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(projectId);
}

function cloneDocument(document: ProjectDocument): ProjectDocument {
  return cloneJson(document);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ioError(action: string, path: string, cause: unknown): Result<never, ProjectError> {
  return err(
    projectError("io", `Não foi possível ${action} em "${path}": ${describeCause(cause)}`, {
      path,
      cause,
    }),
  );
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
    ) as T;
  }
  return value;
}

function parseRecoveryDocument(value: unknown): Result<ProjectDocument, ProjectError> {
  const parsed = safeParseProjectDocument(value);
  if (parsed.success) return ok(parsed.data);
  if (parsed.error instanceof FutureSchemaVersionError) {
    return err(
      projectError("future-schema", parsed.error.message, {
        pointer: "/schemaVersion",
        expected: CURRENT_SCHEMA_VERSION,
        actual: parsed.error.foundVersion,
        cause: parsed.error,
      }),
    );
  }
  if (parsed.error instanceof InvalidSchemaVersionError) {
    return err(
      projectError("invalid-document", parsed.error.message, {
        pointer: "/schemaVersion",
        cause: parsed.error,
      }),
    );
  }
  return err(
    projectError("invalid-document", "Documento de recuperação inválido.", {
      pointer: parsed.error.issues[0]?.path.length
        ? `/${parsed.error.issues[0].path.join("/")}`
        : "/",
      cause: parsed.error,
    }),
  );
}
