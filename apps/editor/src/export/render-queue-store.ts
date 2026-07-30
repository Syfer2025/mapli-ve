import type { MotionBlurSpec } from "@theatrum/export";

export type ExportFormat = "png" | "png-alpha" | "mp4" | "gif" | "prores4444";
export type RenderQueueStatus = "pending" | "running" | "paused" | "done" | "failed";

export interface QueuedExportOptions {
  readonly format: ExportFormat;
  readonly range?: { readonly first: number; readonly last: number };
  readonly outputFps?: number;
  readonly directory?: string;
  readonly scale?: number;
  readonly supersampling?: number;
  readonly motionBlur?: MotionBlurSpec;
}

export interface RenderQueueCheckpoint {
  readonly completedFrames: number;
  readonly totalFrames: number;
  readonly directory: string;
  readonly framesDirectory?: string;
  readonly hashes: readonly {
    readonly filename: string;
    readonly sha256: string;
  }[];
}

export interface RenderQueueJob {
  readonly id: string;
  readonly compositionId: string;
  readonly compositionName: string;
  /** Impede retomar uma sequência com frames produzidos por outro documento. */
  readonly documentFingerprint: string;
  readonly options: QueuedExportOptions;
  readonly status: RenderQueueStatus;
  readonly checkpoint?: RenderQueueCheckpoint;
  readonly message?: string;
}

export interface RenderQueueSnapshot {
  readonly jobs: readonly RenderQueueJob[];
  readonly activeJobId: string | null;
}

export interface RenderQueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "theatrum.render-queue.v3";
const EMPTY: RenderQueueSnapshot = Object.freeze({
  jobs: Object.freeze([]),
  activeJobId: null,
});

let snapshot = EMPTY;
let hydrated = false;
let idSequence = 0;
let storageOverride: RenderQueueStorage | null = null;
const listeners = new Set<() => void>();

export function subscribeRenderQueue(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRenderQueueSnapshot(): RenderQueueSnapshot {
  ensureHydrated();
  return snapshot;
}

export function enqueueRenderJob(input: {
  readonly compositionId: string;
  readonly compositionName: string;
  readonly documentFingerprint: string;
  readonly options: QueuedExportOptions;
  readonly id?: string;
}): string {
  ensureHydrated();
  const id = input.id ?? nextJobId();
  if (snapshot.jobs.some((job) => job.id === id)) {
    throw new Error(`job duplicado na fila: "${id}"`);
  }
  const job = freezeJob({
    id,
    compositionId: input.compositionId,
    compositionName: input.compositionName,
    documentFingerprint: validFingerprint(input.documentFingerprint),
    options: input.options,
    status: "pending",
  });
  publish({ ...snapshot, jobs: Object.freeze([...snapshot.jobs, job]) });
  return id;
}

export function nextRunnableRenderJob(): RenderQueueJob | undefined {
  ensureHydrated();
  return snapshot.jobs.find(({ status }) => status === "pending");
}

export function setRenderQueueJobStatus(
  id: string,
  status: RenderQueueStatus,
  message?: string,
): void {
  mutateJob(id, (job) =>
    message === undefined ? { ...dropMessage(job), status } : { ...job, status, message },
  );
}

export function setRenderQueueActiveJob(id: string | null): void {
  ensureHydrated();
  if (id !== null && !snapshot.jobs.some((job) => job.id === id)) {
    throw new Error(`job ausente na fila: "${id}"`);
  }
  publish({ ...snapshot, activeJobId: id });
}

export function updateRenderQueueCheckpoint(id: string, checkpoint: RenderQueueCheckpoint): void {
  validateCheckpoint(checkpoint);
  // Um checkpoint só existe quando chegou ao armazenamento durável. Se o
  // perfil estiver presente mas não aceitar escrita, propagar a falha faz o
  // frame pump parar antes de avançar mais 300 frames sem ponto de retomada.
  mutateJob(id, (job) => ({ ...job, checkpoint: Object.freeze({ ...checkpoint }) }), true);
}

export function resumeRenderQueueJob(id: string): void {
  mutateJob(id, (job) => ({
    ...dropMessage(job),
    status: "pending",
  }));
}

/** Reinicia do zero depois de uma mudança no documento, sem reutilizar pixels antigos. */
export function restartRenderQueueJob(id: string, documentFingerprint: string): void {
  const fingerprint = validFingerprint(documentFingerprint);
  mutateJob(id, (job) => {
    const { checkpoint: _checkpoint, message: _message, ...withoutResumeState } = job;
    return {
      ...withoutResumeState,
      documentFingerprint: fingerprint,
      status: "pending",
    };
  });
}

export function removeRenderQueueJob(id: string): void {
  ensureHydrated();
  if (snapshot.activeJobId === id) throw new Error("não é possível remover o job ativo");
  publish({ ...snapshot, jobs: Object.freeze(snapshot.jobs.filter((job) => job.id !== id)) });
}

export function clearFinishedRenderJobs(): void {
  ensureHydrated();
  publish({
    ...snapshot,
    jobs: Object.freeze(
      snapshot.jobs.filter(({ status }) => status !== "done" && status !== "failed"),
    ),
  });
}

/** Só para testes: injeta armazenamento e volta ao estado ainda não hidratado. */
export function resetRenderQueueForTest(nextStorage: RenderQueueStorage | null = null): void {
  snapshot = EMPTY;
  hydrated = false;
  idSequence = 0;
  storageOverride = nextStorage;
  listeners.clear();
}

function mutateJob(
  id: string,
  update: (job: RenderQueueJob) => RenderQueueJob,
  requirePersistence = false,
): void {
  ensureHydrated();
  let found = false;
  const jobs = snapshot.jobs.map((job) => {
    if (job.id !== id) return job;
    found = true;
    return freezeJob(update(job));
  });
  if (!found) throw new Error(`job ausente na fila: "${id}"`);
  publish({ ...snapshot, jobs: Object.freeze(jobs) }, requirePersistence);
}

function publish(next: RenderQueueSnapshot, requirePersistence = false): void {
  snapshot = Object.freeze({
    jobs: Object.freeze([...next.jobs]),
    activeJobId: next.activeJobId,
  });
  const persistenceError = persist();
  for (const listener of listeners) listener();
  if (requirePersistence && persistenceError !== undefined) {
    throw new Error(`não foi possível persistir o checkpoint: ${describeError(persistenceError)}`);
  }
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  const storage = resolveStorage();
  if (storage === null) return;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (raw === null) return;
  try {
    const parsed = parseSnapshot(JSON.parse(raw) as unknown);
    if (parsed !== null) snapshot = parsed;
  } catch {
    // Fila corrompida não impede o editor de abrir; ela recomeça vazia.
  }
}

function persist(): unknown | undefined {
  const storage = resolveStorage();
  if (storage === null) return undefined;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        jobs: snapshot.jobs,
        activeJobId: snapshot.activeJobId,
      }),
    );
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

function parseSnapshot(input: unknown): RenderQueueSnapshot | null {
  if (!isRecord(input) || input["version"] !== 3 || !Array.isArray(input["jobs"])) return null;
  const jobs: RenderQueueJob[] = [];
  for (const raw of input["jobs"]) {
    const job = parseJob(raw);
    if (job === null) continue;
    // Um processo encerrado não pode deixar um job eternamente "running".
    jobs.push(job.status === "running" ? freezeJob({ ...job, status: "paused" }) : job);
  }
  // Um processo recém-aberto não tem job ativo, mesmo que tenha encerrado no
  // meio de um. O job vira pausado acima e só volta a ativo ao usuário retomar.
  return Object.freeze({ jobs: Object.freeze(jobs), activeJobId: null });
}

function parseJob(input: unknown): RenderQueueJob | null {
  if (!isRecord(input) || !isRecord(input["options"])) return null;
  const id = input["id"];
  const compositionId = input["compositionId"];
  const compositionName = input["compositionName"];
  const documentFingerprint = input["documentFingerprint"];
  const status = input["status"];
  const options = parseOptions(input["options"]);
  if (
    typeof id !== "string" ||
    typeof compositionId !== "string" ||
    typeof compositionName !== "string" ||
    typeof documentFingerprint !== "string" ||
    !isFingerprint(documentFingerprint) ||
    !isQueueStatus(status) ||
    options === null
  ) {
    return null;
  }

  const checkpoint = parseCheckpoint(input["checkpoint"]);
  return freezeJob({
    id,
    compositionId,
    compositionName,
    documentFingerprint,
    options,
    status,
    ...(checkpoint === undefined ? {} : { checkpoint }),
    ...(typeof input["message"] === "string" ? { message: input["message"] } : {}),
  });
}

function parseOptions(input: Record<string, unknown>): QueuedExportOptions | null {
  const format = input["format"];
  if (!isExportFormat(format)) return null;

  const range = input["range"];
  if (
    range !== undefined &&
    (!isRecord(range) ||
      !Number.isInteger(range["first"]) ||
      !Number.isInteger(range["last"]) ||
      (range["first"] as number) < 0 ||
      (range["last"] as number) < (range["first"] as number))
  ) {
    return null;
  }
  const outputFps = input["outputFps"];
  if (outputFps !== undefined && !isPositiveFinite(outputFps)) return null;
  const directory = input["directory"];
  if (directory !== undefined && (typeof directory !== "string" || directory.length === 0)) {
    return null;
  }
  const scale = input["scale"];
  if (scale !== undefined && !isPositiveFinite(scale)) return null;
  const supersampling = input["supersampling"];
  if (
    supersampling !== undefined &&
    (!Number.isInteger(supersampling) || (supersampling as number) <= 0)
  ) {
    return null;
  }
  const motionBlur = input["motionBlur"];
  if (
    motionBlur !== undefined &&
    (!isRecord(motionBlur) ||
      !isFiniteInRange(motionBlur["shutterAngle"], 0, 360) ||
      !Number.isInteger(motionBlur["samples"]) ||
      (motionBlur["samples"] as number) < 1 ||
      (motionBlur["samples"] as number) > 64)
  ) {
    return null;
  }

  return Object.freeze({
    format,
    ...(range === undefined
      ? {}
      : {
          range: Object.freeze({
            first: range["first"] as number,
            last: range["last"] as number,
          }),
        }),
    ...(outputFps === undefined ? {} : { outputFps: outputFps as number }),
    ...(directory === undefined ? {} : { directory }),
    ...(scale === undefined ? {} : { scale: scale as number }),
    ...(supersampling === undefined ? {} : { supersampling: supersampling as number }),
    ...(motionBlur === undefined
      ? {}
      : {
          motionBlur: Object.freeze({
            shutterAngle: motionBlur["shutterAngle"] as number,
            samples: motionBlur["samples"] as number,
          }),
        }),
  });
}

function parseCheckpoint(input: unknown): RenderQueueCheckpoint | undefined {
  if (!isRecord(input)) return undefined;
  const completedFrames = input["completedFrames"];
  const totalFrames = input["totalFrames"];
  const directory = input["directory"];
  const framesDirectory = input["framesDirectory"];
  const hashes = input["hashes"];
  if (
    !Number.isInteger(completedFrames) ||
    !Number.isInteger(totalFrames) ||
    typeof directory !== "string" ||
    (framesDirectory !== undefined && typeof framesDirectory !== "string") ||
    !Array.isArray(hashes)
  ) {
    return undefined;
  }
  const parsedHashes: { filename: string; sha256: string }[] = [];
  for (const frame of hashes) {
    if (
      !isRecord(frame) ||
      typeof frame["filename"] !== "string" ||
      typeof frame["sha256"] !== "string"
    ) {
      return undefined;
    }
    parsedHashes.push({ filename: frame["filename"], sha256: frame["sha256"] });
  }
  const checkpoint: RenderQueueCheckpoint = {
    completedFrames: completedFrames as number,
    totalFrames: totalFrames as number,
    directory,
    hashes: Object.freeze(parsedHashes.map((frame) => Object.freeze(frame))),
    ...(typeof framesDirectory === "string" ? { framesDirectory } : {}),
  };
  try {
    validateCheckpoint(checkpoint);
    return Object.freeze(checkpoint);
  } catch {
    return undefined;
  }
}

function validateCheckpoint(checkpoint: RenderQueueCheckpoint): void {
  if (
    !Number.isInteger(checkpoint.completedFrames) ||
    !Number.isInteger(checkpoint.totalFrames) ||
    checkpoint.completedFrames < 0 ||
    checkpoint.totalFrames <= 0 ||
    checkpoint.completedFrames > checkpoint.totalFrames ||
    checkpoint.directory.length === 0 ||
    checkpoint.hashes.length !== checkpoint.completedFrames ||
    checkpoint.hashes.some(
      ({ filename, sha256 }) =>
        filename.length === 0 || !/^[a-f0-9]{64}$/u.test(sha256),
    )
  ) {
    throw new Error("checkpoint da fila inválido");
  }
}

function freezeJob(job: RenderQueueJob): RenderQueueJob {
  return Object.freeze({
    ...job,
    options: Object.freeze({
      ...job.options,
      ...(job.options.range === undefined
        ? {}
        : { range: Object.freeze({ ...job.options.range }) }),
      ...(job.options.motionBlur === undefined
        ? {}
        : { motionBlur: Object.freeze({ ...job.options.motionBlur }) }),
    }),
    ...(job.checkpoint === undefined
      ? {}
      : {
          checkpoint: Object.freeze({
            ...job.checkpoint,
            hashes: Object.freeze(
              job.checkpoint.hashes.map((frame) => Object.freeze({ ...frame })),
            ),
          }),
        }),
  });
}

function dropMessage(job: RenderQueueJob): Omit<RenderQueueJob, "message"> {
  const { message: _message, ...withoutMessage } = job;
  return withoutMessage;
}

function nextJobId(): string {
  idSequence += 1;
  const random = globalThis.crypto?.randomUUID?.();
  return `job_${random ?? String(idSequence).padStart(6, "0")}`;
}

function resolveStorage(): RenderQueueStorage | null {
  if (storageOverride !== null) return storageOverride;
  const candidate = (globalThis as { readonly localStorage?: RenderQueueStorage }).localStorage;
  return candidate ?? null;
}

function isQueueStatus(value: unknown): value is RenderQueueStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "paused" ||
    value === "done" ||
    value === "failed"
  );
}

function isExportFormat(value: unknown): value is ExportFormat {
  return (
    value === "png" ||
    value === "png-alpha" ||
    value === "mp4" ||
    value === "gif" ||
    value === "prores4444"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validFingerprint(value: string): string {
  if (!isFingerprint(value)) throw new Error("fingerprint do documento inválido");
  return value;
}

function isFingerprint(value: string): boolean {
  return /^[0-9a-f]{16}$/u.test(value);
}
