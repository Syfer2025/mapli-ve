import { err, ok, type Result } from "@theatrum/core-utils";

import { projectError, type ProjectError } from "./errors.js";
import { decodeUtf8, encodeUtf8 } from "./utf8.js";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

interface EncodedEntry extends ZipEntry {
  readonly crc: number;
  readonly nameBytes: Uint8Array;
  readonly offset: number;
}

/** ZIP32 determinístico. Todos os membros usam STORE e data/hora DOS zero. */
export function encodeZip(entries: readonly ZipEntry[]): Result<Uint8Array, ProjectError> {
  const seen = new Set<string>();
  const localParts: Uint8Array[] = [];
  const encoded: EncodedEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameError = validateEntryName(entry.name);
    if (nameError !== null) return err(nameError);
    if (seen.has(entry.name)) {
      return err(
        projectError("invalid-container", `Membro ZIP duplicado: "${entry.name}".`, {
          path: entry.name,
        }),
      );
    }
    seen.add(entry.name);

    const nameBytes = encodeUtf8(entry.name);
    if (nameBytes.length > 0xffff || entry.bytes.length > 0xffff_ffff) {
      return err(
        projectError("invalid-container", `Membro ZIP excede o limite ZIP32: "${entry.name}".`, {
          path: entry.name,
        }),
      );
    }

    const crc = crc32(entry.bytes);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_FILE_HEADER, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, STORE_METHOD, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.bytes.length, true);
    view.setUint32(22, entry.bytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    localParts.push(header, entry.bytes);
    encoded.push({ ...entry, crc, nameBytes, offset });
    offset += header.length + entry.bytes.length;
  }

  const centralOffset = offset;
  const centralParts: Uint8Array[] = [];

  for (const entry of encoded) {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, CENTRAL_DIRECTORY_HEADER, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, STORE_METHOD, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.bytes.length, true);
    view.setUint32(24, entry.bytes.length, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    header.set(entry.nameBytes, 46);
    centralParts.push(header);
    offset += header.length;
  }

  if (entries.length > 0xffff || offset > 0xffff_ffff) {
    return err(projectError("invalid-container", "Container excede os limites ZIP32."));
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, offset - centralOffset, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);

  return ok(concatBytes([...localParts, ...centralParts, end]));
}

export function decodeZip(bytes: Uint8Array): Result<readonly ZipEntry[], ProjectError> {
  if (bytes.length < 22) return invalidZip("Arquivo pequeno demais para ser um ZIP.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndRecord(view);
  if (endOffset === -1) return invalidZip("Diretório central ZIP ausente.");

  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const count = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (disk !== 0 || centralDisk !== 0) return invalidZip("ZIP multidisco não é suportado.");
  if (centralOffset + centralSize > endOffset) return invalidZip("Diretório central truncado.");

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;

  for (let index = 0; index < count; index++) {
    if (!fits(bytes, cursor, 46) || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_HEADER) {
      return invalidZip(`Cabeçalho central inválido no membro ${index}.`);
    }

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const centralLength = 46 + nameLength + extraLength + commentLength;
    if (!fits(bytes, cursor, centralLength)) return invalidZip("Diretório central truncado.");

    const nameResult = decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (typeof nameResult !== "string") return err(nameResult);
    const nameError = validateEntryName(nameResult);
    if (nameError !== null) return err(nameError);
    if (names.has(nameResult)) {
      return invalidZip(`Membro ZIP duplicado: "${nameResult}".`, nameResult);
    }
    names.add(nameResult);

    if ((flags & 0x0001) !== 0)
      return invalidZip(`Membro criptografado: "${nameResult}".`, nameResult);
    if (method !== STORE_METHOD || compressedSize !== uncompressedSize) {
      return invalidZip(`Compressão não suportada em "${nameResult}".`, nameResult);
    }
    if (!fits(bytes, localOffset, 30) || view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
      return invalidZip(`Cabeçalho local ausente para "${nameResult}".`, nameResult);
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (!fits(bytes, dataOffset, compressedSize)) {
      return invalidZip(`Conteúdo truncado em "${nameResult}".`, nameResult);
    }

    const content = bytes.slice(dataOffset, dataOffset + compressedSize);
    if (crc32(content) !== expectedCrc) {
      return invalidZip(`CRC inválido em "${nameResult}".`, nameResult);
    }

    entries.push({ name: nameResult, bytes: content });
    cursor += centralLength;
  }

  return ok(entries);
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function validateEntryName(name: string): ProjectError | null {
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return projectError("invalid-container", `Caminho inseguro no ZIP: "${name}".`, { path: name });
  }
  return null;
}

function findEndRecord(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

function fits(bytes: Uint8Array, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= bytes.length;
}

function invalidZip(message: string, path?: string): Result<never, ProjectError> {
  return err(projectError("invalid-container", message, path === undefined ? {} : { path }));
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
