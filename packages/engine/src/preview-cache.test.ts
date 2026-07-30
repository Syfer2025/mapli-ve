import { describe, expect, it } from "vitest";
import { checksumBytes, createByteChecksum } from "./checksum.js";
import {
  PreviewDiskCacheAdapter,
  RamPreviewCache,
  TieredPreviewCache,
  createPreviewFrameKey,
  type PreviewDiskRecord,
  type PreviewDiskRecordMetadata,
  type PreviewDiskStoragePort,
} from "./preview-cache.js";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe("checksum de artefatos derivados", () => {
  it("implementa o vetor conhecido de CRC32 e respeita views", () => {
    const encoded = new TextEncoder().encode("xx123456789yy");
    expect(checksumBytes(encoded.subarray(2, 11))).toBe("crc32:cbf43926");
    const streaming = createByteChecksum();
    streaming.update(encoded.subarray(2, 6));
    streaming.update(encoded.subarray(6, 11));
    expect(streaming.digest()).toBe("crc32:cbf43926");
    expect(streaming.digest()).toBe("crc32:cbf43926");
    expect(() => streaming.update(bytes(0))).toThrow(/finalizado/);
  });
});

describe("chave canônica de preview", () => {
  it("inclui entradas visuais e não colide quando strings contêm separadores", () => {
    const base = {
      compositionId: "cmp:1",
      documentFingerprint: "rev|2",
      frame: 120,
      width: 1920,
      height: 1080,
      scale: 2,
      variant: "composite:png",
    };
    expect(createPreviewFrameKey(base)).toBe(
      'preview:v1:["cmp:1","rev|2",120,1920,1080,2,"composite:png"]',
    );
    expect(createPreviewFrameKey({ ...base, frame: 121 })).not.toBe(createPreviewFrameKey(base));
    expect(() => createPreviewFrameKey({ ...base, width: 0 })).toThrow(/width/);
    expect(() => createPreviewFrameKey({ ...base, frame: 0.5 })).toThrow(/frame/);
  });
});

describe("cache de preview em RAM", () => {
  it("aplica orçamento por bytes, LRU real e cópia defensiva", () => {
    const cache = new RamPreviewCache(6);
    const source = bytes(1, 2, 3);
    expect(cache.put("a", source)).toMatchObject({ stored: true, evicted: [] });
    source[0] = 99;
    cache.put("b", bytes(4, 5, 6));

    const first = cache.get("a");
    expect(first?.bytes).toEqual(bytes(1, 2, 3));
    if (first === null) throw new Error("fixture ausente");
    first.bytes[0] = 88;
    expect(cache.get("a")?.bytes).toEqual(bytes(1, 2, 3));

    expect(cache.put("c", bytes(7, 8, 9))).toEqual({
      stored: true,
      evicted: ["b"],
    });
    expect(cache.keysMostRecentFirst()).toEqual(["c", "a"]);
    expect(cache.get("b")).toBeNull();
    expect(cache.stats()).toMatchObject({
      budgetBytes: 6,
      usedBytes: 6,
      entries: 2,
      hits: 2,
      misses: 1,
      writes: 3,
      evictions: 1,
    });
  });

  it("recusa item maior que o orçamento e evicta ao reduzir o limite", () => {
    const cache = new RamPreviewCache(8);
    cache.put("a", bytes(1, 2, 3, 4));
    cache.put("b", bytes(5, 6, 7, 8));
    expect(cache.put("gigante", bytes(1, 2, 3, 4, 5, 6, 7, 8, 9))).toEqual({
      stored: false,
      reason: "over-budget",
      evicted: [],
    });
    expect(cache.setBudgetBytes(3)).toEqual(["a", "b"]);
    expect(cache.stats()).toMatchObject({ budgetBytes: 3, usedBytes: 0, entries: 0 });
  });

  it("recusa payload overbudget antes de tentar copiá-lo", () => {
    const cache = new RamPreviewCache(4);
    const oversized = bytesWhoseSliceFails(5);
    expect(cache.put("grande", oversized)).toMatchObject({
      stored: false,
      reason: "over-budget",
    });
  });
});

describe("adaptador de cache em disco", () => {
  it("persiste toque LRU e reaplica orçamento ao abrir uma nova sessão", async () => {
    const storage = new MemoryDiskStorage();
    const first = new PreviewDiskCacheAdapter(storage, 6);
    await first.put("a", bytes(1, 2, 3));
    await first.put("b", bytes(4, 5, 6));
    expect(await first.get("a")).toMatchObject({ key: "a", byteLength: 3 });

    const reopened = new PreviewDiskCacheAdapter(storage, 3);
    expect(await reopened.keysMostRecentFirst()).toEqual(["a"]);
    expect(await reopened.get("a")).toMatchObject({
      key: "a",
      bytes: bytes(1, 2, 3),
      checksum: checksumBytes(bytes(1, 2, 3)),
    });
    expect(await reopened.get("b")).toBeNull();
    expect(reopened.stats()).toMatchObject({
      initialized: true,
      budgetBytes: 3,
      usedBytes: 3,
      entries: 1,
      evictions: 1,
    });
  });

  it("transforma checksum ou tamanho corrompido em miss e remove o registro", async () => {
    const storage = new MemoryDiskStorage();
    const cache = new PreviewDiskCacheAdapter(storage, 32);
    await cache.put("frame", bytes(10, 20, 30, 40));
    storage.corrupt("frame");

    expect(await cache.get("frame")).toBeNull();
    expect(await storage.read("frame")).toBeNull();
    expect(cache.stats()).toMatchObject({
      usedBytes: 0,
      entries: 0,
      misses: 1,
      corruptions: 1,
    });
  });

  it("remove metadata persistida quando o payload desapareceu", async () => {
    const storage = new MemoryDiskStorage();
    const cache = new PreviewDiskCacheAdapter(storage, 32);
    await cache.put("sem-payload", bytes(1, 2, 3));
    storage.losePayload("sem-payload");

    expect(await cache.get("sem-payload")).toBeNull();
    expect(await storage.list()).toEqual([]);
    expect(cache.stats()).toMatchObject({ usedBytes: 0, entries: 0, misses: 1 });
  });

  it("serializa puts concorrentes e nunca termina acima do orçamento", async () => {
    const storage = new MemoryDiskStorage();
    const cache = new PreviewDiskCacheAdapter(storage, 6);
    const results = await Promise.all([
      cache.put("a", bytes(1, 1, 1)),
      cache.put("b", bytes(2, 2, 2)),
      cache.put("c", bytes(3, 3, 3)),
    ]);

    expect(results.map((result) => result.stored)).toEqual([true, true, true]);
    expect(await cache.keysMostRecentFirst()).toEqual(["c", "b"]);
    expect(cache.stats()).toMatchObject({ usedBytes: 6, entries: 2, evictions: 1 });
    expect(storage.maximumConcurrentOperations).toBe(1);
  });

  it("recusa oversized, permite reduzir orçamento e limpar", async () => {
    const storage = new MemoryDiskStorage();
    const cache = new PreviewDiskCacheAdapter(storage, 8);
    await cache.put("a", bytes(1, 2, 3, 4));
    await cache.put("b", bytes(5, 6, 7, 8));
    await expect(cache.put("a", bytes(1, 2, 3, 4, 5, 6, 7, 8, 9))).resolves.toEqual({
      stored: false,
      reason: "over-budget",
      evicted: [],
    });
    expect(await cache.setBudgetBytes(3)).toEqual(["b"]);
    await cache.clear();
    expect(cache.stats()).toMatchObject({ usedBytes: 0, entries: 0 });
    expect(await storage.list()).toEqual([]);
  });

  it("não copia para o adapter de disco um payload já acima do orçamento", async () => {
    const cache = new PreviewDiskCacheAdapter(new MemoryDiskStorage(), 4);
    await expect(cache.put("grande", bytesWhoseSliceFails(5))).resolves.toMatchObject({
      stored: false,
      reason: "over-budget",
    });
  });

  it("compõe RAM+disco e aquece o primeiro nível após um hit persistente", async () => {
    const storage = new MemoryDiskStorage();
    const disk = new PreviewDiskCacheAdapter(storage, 32);
    await disk.put("persistido", bytes(8, 7, 6));
    const ram = new RamPreviewCache(16);
    const tiered = new TieredPreviewCache(ram, disk);

    expect(await tiered.get("persistido")).toMatchObject({ bytes: bytes(8, 7, 6) });
    expect(ram.keysMostRecentFirst()).toEqual(["persistido"]);
    const diskHits = disk.stats().hits;
    expect(await tiered.get("persistido")).toMatchObject({ bytes: bytes(8, 7, 6) });
    expect(disk.stats().hits).toBe(diskHits);

    await tiered.put("novo", bytes(1, 2, 3));
    expect(ram.get("novo")).toMatchObject({ bytes: bytes(1, 2, 3) });
    expect(await disk.get("novo")).toMatchObject({ bytes: bytes(1, 2, 3) });
    await tiered.clear();
    expect(ram.stats().entries).toBe(0);
    expect(disk.stats().entries).toBe(0);
  });
});

function bytesWhoseSliceFails(length: number): Uint8Array {
  const value = new Uint8Array(length);
  Object.defineProperty(value, "slice", {
    value: () => {
      throw new Error("slice não deveria ser chamado");
    },
  });
  return value;
}

class MemoryDiskStorage implements PreviewDiskStoragePort {
  readonly #records = new Map<string, PreviewDiskRecord>();
  readonly #missingPayloads = new Set<string>();
  #activeOperations = 0;
  maximumConcurrentOperations = 0;

  async list(): Promise<readonly PreviewDiskRecordMetadata[]> {
    return this.#operation(() =>
      [...this.#records.values()].map(({ key, checksum, byteLength, lastAccess }) => ({
        key,
        checksum,
        byteLength,
        lastAccess,
      })),
    );
  }

  async read(key: string): Promise<PreviewDiskRecord | null> {
    return this.#operation(() => {
      const record = this.#records.get(key);
      return record === undefined || this.#missingPayloads.has(key)
        ? null
        : { ...record, bytes: record.bytes.slice() };
    });
  }

  async write(record: PreviewDiskRecord): Promise<void> {
    await this.#operation(() => {
      this.#records.set(record.key, { ...record, bytes: record.bytes.slice() });
      this.#missingPayloads.delete(record.key);
    });
  }

  async touch(key: string, lastAccess: number): Promise<void> {
    await this.#operation(() => {
      const record = this.#records.get(key);
      if (record !== undefined) this.#records.set(key, { ...record, lastAccess });
    });
  }

  async remove(key: string): Promise<void> {
    await this.#operation(() => {
      this.#records.delete(key);
      this.#missingPayloads.delete(key);
    });
  }

  corrupt(key: string): void {
    const record = this.#records.get(key);
    if (record === undefined) return;
    const changed = record.bytes.slice();
    changed[0] = (changed[0] ?? 0) ^ 0xff;
    this.#records.set(key, { ...record, bytes: changed });
  }

  losePayload(key: string): void {
    if (this.#records.has(key)) this.#missingPayloads.add(key);
  }

  async #operation<T>(callback: () => T): Promise<T> {
    this.#activeOperations += 1;
    this.maximumConcurrentOperations = Math.max(
      this.maximumConcurrentOperations,
      this.#activeOperations,
    );
    await Promise.resolve();
    try {
      return callback();
    } finally {
      this.#activeOperations -= 1;
    }
  }
}
