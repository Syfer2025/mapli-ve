/**
 * Storage Node para o cache de preview.
 *
 * A política (LRU, budget e checksum) fica em `@theatrum/engine`; este arquivo
 * só traduz registros para pares metadata+bytes no disco.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const METADATA_VERSION = 1;
const MAX_METADATA_BYTES = 64 * 1024;

/**
 * Forma estrutural da porta do engine. Não há import em runtime nem estado
 * compartilhado: uma instância pode ser entregue diretamente ao adapter LRU.
 */
interface PreviewDiskRecordMetadata {
  readonly key: string;
  readonly checksum: string;
  readonly byteLength: number;
  readonly lastAccess: number;
}

interface PreviewDiskRecord extends PreviewDiskRecordMetadata {
  readonly bytes: Uint8Array;
}

interface StoredMetadata extends PreviewDiskRecordMetadata {
  readonly version: typeof METADATA_VERSION;
}

export class FilePreviewDiskStorage {
  readonly #root: string;

  constructor(root: string) {
    if (typeof root !== "string" || root.length === 0 || !path.isAbsolute(root)) {
      throw new RangeError("raiz do cache precisa ser um caminho absoluto");
    }
    this.#root = path.resolve(root);
  }

  async list(): Promise<readonly PreviewDiskRecordMetadata[]> {
    await mkdir(this.#root, { recursive: true });
    const entries = await readdir(this.#root, { withFileTypes: true });
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const result: PreviewDiskRecordMetadata[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".tmp")) {
        await removeIfPresent(path.join(this.#root, entry.name));
        continue;
      }
      if (entry.name.endsWith(".frame")) {
        const id = entry.name.slice(0, -6);
        if (isStorageId(id) && !names.has(`${id}.json`)) {
          await removeIfPresent(this.#payloadPath(id));
        }
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      if (!isStorageId(id)) continue;
      const metadata = await this.#readMetadata(id);
      if (metadata === null || !(await this.#payloadMatches(id, metadata.byteLength))) {
        await removeIfPresent(this.#metadataPath(id));
        await removeIfPresent(this.#payloadPath(id));
        continue;
      }
      result.push(stripVersion(metadata));
    }
    return Object.freeze(result);
  }

  async read(key: string): Promise<PreviewDiskRecord | null> {
    validKey(key);
    await mkdir(this.#root, { recursive: true });
    const id = storageId(key);
    const metadata = await this.#readMetadata(id);
    if (metadata === null || metadata.key !== key) return null;
    try {
      const info = await stat(this.#payloadPath(id));
      if (!info.isFile() || info.size !== metadata.byteLength) return null;
      const bytes = await readFile(this.#payloadPath(id));
      return {
        ...stripVersion(metadata),
        bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice(),
      };
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async write(record: PreviewDiskRecord): Promise<void> {
    validRecord(record);
    await mkdir(this.#root, { recursive: true });
    const id = storageId(record.key);
    const metadata: StoredMetadata = {
      version: METADATA_VERSION,
      key: record.key,
      checksum: record.checksum,
      byteLength: record.byteLength,
      lastAccess: record.lastAccess,
    };
    await writeAtomic(this.#payloadPath(id), record.bytes);
    await writeAtomic(this.#metadataPath(id), new TextEncoder().encode(JSON.stringify(metadata)));
  }

  async touch(key: string, lastAccess: number): Promise<void> {
    validKey(key);
    validAccess(lastAccess);
    const id = storageId(key);
    const metadata = await this.#readMetadata(id);
    if (metadata === null || metadata.key !== key) return;
    await writeAtomic(
      this.#metadataPath(id),
      new TextEncoder().encode(JSON.stringify({ ...metadata, lastAccess })),
    );
  }

  async remove(key: string): Promise<void> {
    validKey(key);
    const id = storageId(key);
    await Promise.all([
      removeIfPresent(this.#metadataPath(id)),
      removeIfPresent(this.#payloadPath(id)),
    ]);
  }

  #metadataPath(id: string): string {
    return path.join(this.#root, `${id}.json`);
  }

  #payloadPath(id: string): string {
    return path.join(this.#root, `${id}.frame`);
  }

  async #readMetadata(id: string): Promise<StoredMetadata | null> {
    const target = this.#metadataPath(id);
    try {
      const info = await stat(target);
      if (!info.isFile() || info.size > MAX_METADATA_BYTES) return null;
      const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
      return isStoredMetadata(parsed) && storageId(parsed.key) === id ? parsed : null;
    } catch (error: unknown) {
      if (isNotFound(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async #payloadMatches(id: string, byteLength: number): Promise<boolean> {
    try {
      const info = await stat(this.#payloadPath(id));
      return info.isFile() && info.size === byteLength;
    } catch (error: unknown) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

function storageId(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function isStorageId(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function stripVersion(metadata: StoredMetadata): PreviewDiskRecordMetadata {
  return Object.freeze({
    key: metadata.key,
    checksum: metadata.checksum,
    byteLength: metadata.byteLength,
    lastAccess: metadata.lastAccess,
  });
}

function isStoredMetadata(value: unknown): value is StoredMetadata {
  if (typeof value !== "object" || value === null) return false;
  return (
    Reflect.get(value, "version") === METADATA_VERSION &&
    typeof Reflect.get(value, "key") === "string" &&
    (Reflect.get(value, "key") as string).length > 0 &&
    typeof Reflect.get(value, "checksum") === "string" &&
    Number.isSafeInteger(Reflect.get(value, "byteLength")) &&
    (Reflect.get(value, "byteLength") as number) > 0 &&
    Number.isSafeInteger(Reflect.get(value, "lastAccess")) &&
    (Reflect.get(value, "lastAccess") as number) >= 0
  );
}

function validRecord(record: PreviewDiskRecord): void {
  validKey(record.key);
  validAccess(record.lastAccess);
  if (
    !(record.bytes instanceof Uint8Array) ||
    record.bytes.byteLength === 0 ||
    !Number.isSafeInteger(record.byteLength) ||
    record.byteLength !== record.bytes.byteLength ||
    typeof record.checksum !== "string" ||
    record.checksum.length === 0
  ) {
    throw new RangeError("registro de preview inválido");
  }
}

function validKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new RangeError("key não pode ser vazia");
  }
}

function validAccess(lastAccess: number): void {
  if (!Number.isSafeInteger(lastAccess) || lastAccess < 0) {
    throw new RangeError("lastAccess precisa ser inteiro seguro e não negativo");
  }
}

async function writeAtomic(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } finally {
    await removeIfPresent(temporary);
  }
}

async function removeIfPresent(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Reflect.get(error, "code") === "ENOENT"
  );
}
