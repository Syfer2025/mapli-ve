import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilePreviewDiskStorage } from "./preview-cache-storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("storage em disco do cache de preview", () => {
  it("persiste bytes e metadata, toca sem regravar o payload e remove o par", async () => {
    const directory = await temporaryDirectory();
    const storage = new FilePreviewDiskStorage(directory);
    const record = {
      key: 'preview:v1:["cmp",0]',
      checksum: "crc32:55bc801d",
      byteLength: 3,
      lastAccess: 4,
      bytes: new Uint8Array([1, 2, 3]),
    };
    await storage.write(record);

    const files = await readdir(directory);
    const payloadName = files.find((file) => file.endsWith(".frame"));
    if (payloadName === undefined) throw new Error("payload ausente");
    const beforeTouch = await readFile(path.join(directory, payloadName));
    expect(await storage.list()).toEqual([
      {
        key: record.key,
        checksum: record.checksum,
        byteLength: 3,
        lastAccess: 4,
      },
    ]);
    expect(await storage.read(record.key)).toEqual(record);

    await storage.touch(record.key, 9);
    expect(await storage.list()).toEqual([
      expect.objectContaining({ key: record.key, lastAccess: 9 }),
    ]);
    expect(await readFile(path.join(directory, payloadName))).toEqual(beforeTouch);

    await storage.remove(record.key);
    expect(await storage.list()).toEqual([]);
    expect(await storage.read(record.key)).toBeNull();
  });

  it("deriva nomes por SHA-256 e nunca usa a chave como caminho", async () => {
    const directory = await temporaryDirectory();
    const storage = new FilePreviewDiskStorage(directory);
    const key = "../../fora/../../frame";
    await storage.write({
      key,
      checksum: "crc32:352441c2",
      byteLength: 3,
      lastAccess: 1,
      bytes: new Uint8Array([1, 2, 3]),
    });

    const names = await readdir(directory);
    expect(names).toHaveLength(2);
    expect(names.every((name) => /^[0-9a-f]{64}\.(?:json|frame)$/.test(name))).toBe(true);
    expect(await storage.read(key)).toMatchObject({ key, bytes: new Uint8Array([1, 2, 3]) });
  });

  it("ignora e limpa metadata truncada de uma sessão interrompida", async () => {
    const directory = await temporaryDirectory();
    const storage = new FilePreviewDiskStorage(directory);
    await storage.write({
      key: "frame-corrompido",
      checksum: "crc32:352441c2",
      byteLength: 3,
      lastAccess: 1,
      bytes: new Uint8Array([1, 2, 3]),
    });
    const metadata = (await readdir(directory)).find((file) => file.endsWith(".json"));
    if (metadata === undefined) throw new Error("metadata ausente");
    await writeFile(path.join(directory, metadata), '{"version":');

    expect(await storage.list()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("ignora e limpa payload cujo tamanho diverge da metadata", async () => {
    const directory = await temporaryDirectory();
    const storage = new FilePreviewDiskStorage(directory);
    await storage.write({
      key: "frame-truncado",
      checksum: "crc32:352441c2",
      byteLength: 3,
      lastAccess: 1,
      bytes: new Uint8Array([1, 2, 3]),
    });
    const payload = (await readdir(directory)).find((file) => file.endsWith(".frame"));
    if (payload === undefined) throw new Error("payload ausente");
    await writeFile(path.join(directory, payload), new Uint8Array([1, 2]));

    expect(await storage.list()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("limpa payload órfão e temporário abandonado", async () => {
    const directory = await temporaryDirectory();
    const orphanId = "a".repeat(64);
    await writeFile(path.join(directory, `${orphanId}.frame`), "órfão");
    await writeFile(path.join(directory, `${orphanId}.json.qualquer.tmp`), "temporário");

    const storage = new FilePreviewDiskStorage(directory);
    expect(await storage.list()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("recusa raiz relativa e registros inconsistentes", async () => {
    expect(() => new FilePreviewDiskStorage("cache/relativo")).toThrow(/absoluto/);
    const storage = new FilePreviewDiskStorage(await temporaryDirectory());
    await expect(
      storage.write({
        key: "frame",
        checksum: "crc32:00000000",
        byteLength: 4,
        lastAccess: 0,
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/inválido/);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "theatrum-preview-cache-"));
  temporaryDirectories.push(directory);
  return directory;
}
