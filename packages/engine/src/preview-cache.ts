import { checksumBytes } from "./checksum.js";

export interface PreviewFrameKeyInput {
  readonly compositionId: string;
  /** Hash/revisão que muda quando qualquer entrada visual muda. */
  readonly documentFingerprint: string;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** Ex.: `composite:png`, `overlay:webp`; evita colisão entre codificações. */
  readonly variant: string;
}

export interface PreviewCacheEntry {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly checksum: string;
}

export interface PreviewCachePutResult {
  readonly stored: boolean;
  readonly reason?: "over-budget";
  readonly evicted: readonly string[];
}

export interface PreviewCacheStats {
  readonly budgetBytes: number;
  readonly usedBytes: number;
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly writes: number;
  readonly evictions: number;
  readonly corruptions: number;
}

export interface TieredPreviewCachePutResult {
  readonly ram: PreviewCachePutResult;
  readonly disk: PreviewCachePutResult;
}

interface RamRecord {
  readonly bytes: Uint8Array;
  readonly checksum: string;
}

/**
 * Cache síncrono para o caminho quente do preview.
 *
 * `Map` preserva ordem de inserção; tocar uma entrada é delete+set, portanto a
 * primeira chave é sempre a menos recentemente usada.
 */
export class RamPreviewCache {
  #budgetBytes: number;
  #usedBytes = 0;
  #records = new Map<string, RamRecord>();
  #hits = 0;
  #misses = 0;
  #writes = 0;
  #evictions = 0;
  #corruptions = 0;

  constructor(budgetBytes: number) {
    this.#budgetBytes = validBudget(budgetBytes);
  }

  get(key: string): PreviewCacheEntry | null {
    const record = this.#records.get(validKey(key));
    if (record === undefined) {
      this.#misses += 1;
      return null;
    }
    if (checksumBytes(record.bytes) !== record.checksum) {
      this.#remove(key);
      this.#misses += 1;
      this.#corruptions += 1;
      return null;
    }
    this.#records.delete(key);
    this.#records.set(key, record);
    this.#hits += 1;
    return cacheEntry(key, record);
  }

  put(key: string, bytes: Uint8Array): PreviewCachePutResult {
    validKey(key);
    validBytes(bytes);
    const copy = bytes.slice();
    const previous = this.#records.get(key);
    if (previous !== undefined) this.#remove(key);
    if (copy.byteLength > this.#budgetBytes) {
      return Object.freeze({ stored: false, reason: "over-budget", evicted: Object.freeze([]) });
    }
    this.#records.set(key, { bytes: copy, checksum: checksumBytes(copy) });
    this.#usedBytes += copy.byteLength;
    this.#writes += 1;
    const evicted = this.#evictToBudget();
    return Object.freeze({ stored: true, evicted: Object.freeze(evicted) });
  }

  delete(key: string): boolean {
    validKey(key);
    return this.#remove(key);
  }

  clear(): void {
    this.#records.clear();
    this.#usedBytes = 0;
  }

  setBudgetBytes(budgetBytes: number): readonly string[] {
    this.#budgetBytes = validBudget(budgetBytes);
    return Object.freeze(this.#evictToBudget());
  }

  keysMostRecentFirst(): readonly string[] {
    return Object.freeze([...this.#records.keys()].reverse());
  }

  stats(): PreviewCacheStats {
    return Object.freeze({
      budgetBytes: this.#budgetBytes,
      usedBytes: this.#usedBytes,
      entries: this.#records.size,
      hits: this.#hits,
      misses: this.#misses,
      writes: this.#writes,
      evictions: this.#evictions,
      corruptions: this.#corruptions,
    });
  }

  #evictToBudget(): string[] {
    const evicted: string[] = [];
    while (this.#usedBytes > this.#budgetBytes) {
      const oldest = this.#records.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#remove(oldest);
      this.#evictions += 1;
      evicted.push(oldest);
    }
    return evicted;
  }

  #remove(key: string): boolean {
    const record = this.#records.get(key);
    if (record === undefined) return false;
    this.#records.delete(key);
    this.#usedBytes -= record.bytes.byteLength;
    return true;
  }
}

export interface PreviewDiskRecordMetadata {
  readonly key: string;
  readonly checksum: string;
  readonly byteLength: number;
  /** Contador lógico persistido; não depende do relógio da máquina. */
  readonly lastAccess: number;
}

export interface PreviewDiskRecord extends PreviewDiskRecordMetadata {
  readonly bytes: Uint8Array;
}

/**
 * Porta estreita implementada pelo processo com acesso ao disco.
 *
 * `write` deve substituir bytes+metadata de uma chave de forma atômica. `touch`
 * atualiza somente metadata e evita regravar um frame grande a cada hit.
 */
export interface PreviewDiskStoragePort {
  list(): Promise<readonly PreviewDiskRecordMetadata[]>;
  read(key: string): Promise<PreviewDiskRecord | null>;
  write(record: PreviewDiskRecord): Promise<void>;
  touch(key: string, lastAccess: number): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Política de cache persistente sobre uma porta de disco.
 *
 * Todas as operações são serializadas: puts concorrentes não podem ultrapassar
 * o orçamento por observar o mesmo total antigo.
 */
export class PreviewDiskCacheAdapter {
  readonly #storage: PreviewDiskStoragePort;
  #budgetBytes: number;
  #usedBytes = 0;
  #records = new Map<string, PreviewDiskRecordMetadata>();
  #access = 0;
  #initialized = false;
  #tail: Promise<void> = Promise.resolve();
  #hits = 0;
  #misses = 0;
  #writes = 0;
  #evictions = 0;
  #corruptions = 0;

  constructor(storage: PreviewDiskStoragePort, budgetBytes: number) {
    this.#storage = storage;
    this.#budgetBytes = validBudget(budgetBytes);
  }

  get(key: string): Promise<PreviewCacheEntry | null> {
    validKey(key);
    return this.#exclusive(async () => {
      await this.#initialize();
      const expected = this.#records.get(key);
      if (expected === undefined) {
        this.#misses += 1;
        return null;
      }
      const record = await this.#storage.read(key);
      if (record === null) {
        await this.#storage.remove(key);
        this.#forget(key);
        this.#misses += 1;
        return null;
      }
      const actualChecksum = checksumBytes(record.bytes);
      if (
        record.key !== key ||
        record.byteLength !== record.bytes.byteLength ||
        record.byteLength !== expected.byteLength ||
        record.checksum !== expected.checksum ||
        actualChecksum !== expected.checksum
      ) {
        await this.#storage.remove(key);
        this.#forget(key);
        this.#misses += 1;
        this.#corruptions += 1;
        return null;
      }

      const lastAccess = this.#nextAccess();
      await this.#storage.touch(key, lastAccess);
      this.#records.set(key, { ...expected, lastAccess });
      this.#hits += 1;
      return cacheEntry(key, record);
    });
  }

  put(key: string, bytes: Uint8Array): Promise<PreviewCachePutResult> {
    validKey(key);
    validBytes(bytes);
    const copy = bytes.slice();
    return this.#exclusive(async () => {
      await this.#initialize();
      const previous = this.#records.get(key);
      if (copy.byteLength > this.#budgetBytes) {
        if (previous !== undefined) {
          await this.#storage.remove(key);
          this.#forget(key);
        }
        return Object.freeze({
          stored: false,
          reason: "over-budget" as const,
          evicted: Object.freeze([]),
        });
      }

      const record: PreviewDiskRecord = {
        key,
        bytes: copy,
        byteLength: copy.byteLength,
        checksum: checksumBytes(copy),
        lastAccess: this.#nextAccess(),
      };
      await this.#storage.write(record);
      if (previous !== undefined) this.#usedBytes -= previous.byteLength;
      this.#records.set(key, metadataOf(record));
      this.#usedBytes += record.byteLength;
      this.#writes += 1;
      const evicted = await this.#evictToBudget();
      return Object.freeze({ stored: true, evicted: Object.freeze(evicted) });
    });
  }

  delete(key: string): Promise<boolean> {
    validKey(key);
    return this.#exclusive(async () => {
      await this.#initialize();
      if (!this.#records.has(key)) return false;
      await this.#storage.remove(key);
      this.#forget(key);
      return true;
    });
  }

  clear(): Promise<void> {
    return this.#exclusive(async () => {
      await this.#initialize();
      for (const key of [...this.#records.keys()].sort()) await this.#storage.remove(key);
      this.#records.clear();
      this.#usedBytes = 0;
    });
  }

  setBudgetBytes(budgetBytes: number): Promise<readonly string[]> {
    const valid = validBudget(budgetBytes);
    return this.#exclusive(async () => {
      await this.#initialize();
      this.#budgetBytes = valid;
      return Object.freeze(await this.#evictToBudget());
    });
  }

  keysMostRecentFirst(): Promise<readonly string[]> {
    return this.#exclusive(async () => {
      await this.#initialize();
      return Object.freeze(
        [...this.#records.values()].sort(compareMostRecent).map((record) => record.key),
      );
    });
  }

  stats(): PreviewCacheStats & { readonly initialized: boolean } {
    return Object.freeze({
      budgetBytes: this.#budgetBytes,
      usedBytes: this.#usedBytes,
      entries: this.#records.size,
      hits: this.#hits,
      misses: this.#misses,
      writes: this.#writes,
      evictions: this.#evictions,
      corruptions: this.#corruptions,
      initialized: this.#initialized,
    });
  }

  async #initialize(): Promise<void> {
    if (this.#initialized) return;
    const listed = await this.#storage.list();
    const validRecords = new Map<string, PreviewDiskRecordMetadata>();
    for (const metadata of listed) {
      if (!isValidMetadata(metadata)) {
        await this.#storage.remove(metadata.key);
        continue;
      }
      const previous = validRecords.get(metadata.key);
      if (previous === undefined || compareMostRecent(metadata, previous) < 0) {
        validRecords.set(metadata.key, Object.freeze({ ...metadata }));
      }
    }
    this.#records = validRecords;
    this.#usedBytes = 0;
    this.#access = 0;
    for (const metadata of validRecords.values()) {
      this.#usedBytes += metadata.byteLength;
      this.#access = Math.max(this.#access, metadata.lastAccess);
    }
    await this.#evictToBudget();
    this.#initialized = true;
  }

  async #evictToBudget(): Promise<string[]> {
    const evicted: string[] = [];
    while (this.#usedBytes > this.#budgetBytes) {
      const oldest = [...this.#records.values()].sort(compareLeastRecent)[0];
      if (oldest === undefined) break;
      await this.#storage.remove(oldest.key);
      this.#forget(oldest.key);
      this.#evictions += 1;
      evicted.push(oldest.key);
    }
    return evicted;
  }

  #forget(key: string): void {
    const metadata = this.#records.get(key);
    if (metadata === undefined) return;
    this.#records.delete(key);
    this.#usedBytes -= metadata.byteLength;
  }

  #nextAccess(): number {
    this.#access += 1;
    if (!Number.isSafeInteger(this.#access)) {
      throw new RangeError("contador LRU excedeu o limite seguro");
    }
    return this.#access;
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const execution = this.#tail.then(operation, operation);
    this.#tail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
}

/** RAM como primeiro nível; hit de disco aquece RAM automaticamente. */
export class TieredPreviewCache {
  readonly #ram: RamPreviewCache;
  readonly #disk: PreviewDiskCacheAdapter;

  constructor(ram: RamPreviewCache, disk: PreviewDiskCacheAdapter) {
    this.#ram = ram;
    this.#disk = disk;
  }

  async get(key: string): Promise<PreviewCacheEntry | null> {
    const memory = this.#ram.get(key);
    if (memory !== null) return memory;
    const persisted = await this.#disk.get(key);
    if (persisted === null) return null;
    this.#ram.put(key, persisted.bytes);
    return persisted;
  }

  async put(key: string, bytes: Uint8Array): Promise<TieredPreviewCachePutResult> {
    const ram = this.#ram.put(key, bytes);
    const disk = await this.#disk.put(key, bytes);
    return Object.freeze({ ram, disk });
  }

  async delete(key: string): Promise<boolean> {
    const ramDeleted = this.#ram.delete(key);
    const diskDeleted = await this.#disk.delete(key);
    return ramDeleted || diskDeleted;
  }

  async clear(): Promise<void> {
    this.#ram.clear();
    await this.#disk.clear();
  }
}

export function createPreviewFrameKey(input: PreviewFrameKeyInput): string {
  nonEmpty("compositionId", input.compositionId);
  nonEmpty("documentFingerprint", input.documentFingerprint);
  nonEmpty("variant", input.variant);
  nonNegativeInteger("frame", input.frame);
  positiveInteger("width", input.width);
  positiveInteger("height", input.height);
  if (!Number.isFinite(input.scale) || input.scale <= 0) {
    throw new RangeError("scale precisa ser finita e positiva");
  }
  return `preview:v1:${JSON.stringify([
    input.compositionId,
    input.documentFingerprint,
    input.frame,
    input.width,
    input.height,
    input.scale,
    input.variant,
  ])}`;
}

function cacheEntry(key: string, record: RamRecord | PreviewDiskRecord): PreviewCacheEntry {
  const bytes = record.bytes.slice();
  return Object.freeze({
    key,
    bytes,
    byteLength: bytes.byteLength,
    checksum: record.checksum,
  });
}

function metadataOf(record: PreviewDiskRecord): PreviewDiskRecordMetadata {
  return Object.freeze({
    key: record.key,
    checksum: record.checksum,
    byteLength: record.byteLength,
    lastAccess: record.lastAccess,
  });
}

function compareLeastRecent(
  left: PreviewDiskRecordMetadata,
  right: PreviewDiskRecordMetadata,
): number {
  return left.lastAccess - right.lastAccess || left.key.localeCompare(right.key);
}

function compareMostRecent(
  left: PreviewDiskRecordMetadata,
  right: PreviewDiskRecordMetadata,
): number {
  return right.lastAccess - left.lastAccess || left.key.localeCompare(right.key);
}

function isValidMetadata(metadata: PreviewDiskRecordMetadata): boolean {
  return (
    typeof metadata.key === "string" &&
    metadata.key.length > 0 &&
    /^crc32:[0-9a-f]{8}$/.test(metadata.checksum) &&
    Number.isSafeInteger(metadata.byteLength) &&
    metadata.byteLength > 0 &&
    Number.isSafeInteger(metadata.lastAccess) &&
    metadata.lastAccess >= 0
  );
}

function validBudget(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("budgetBytes precisa ser inteiro seguro e não negativo");
  }
  return value;
}

function validKey(key: string): string {
  return nonEmpty("key", key);
}

function validBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new RangeError("bytes precisa conter ao menos um byte");
  }
}

function nonEmpty(label: string, value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(`${label} não pode ser vazio`);
  }
  return value;
}

function nonNegativeInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} precisa ser inteiro seguro e não negativo`);
  }
}

function positiveInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} precisa ser inteiro seguro e positivo`);
  }
}
