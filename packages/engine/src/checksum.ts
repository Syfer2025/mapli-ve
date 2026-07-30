/** CRC32 (IEEE) para detectar corrupção acidental de artefatos derivados. */

const CRC32_TABLE = buildTable();

export function checksumBytes(bytes: Uint8Array): string {
  const checksum = createByteChecksum();
  checksum.update(bytes);
  return checksum.digest();
}

export interface ByteChecksum {
  update(bytes: Uint8Array): void;
  digest(): string;
}

/** Permite analisar PCM grande sem alocar uma segunda cópia integral. */
export function createByteChecksum(): ByteChecksum {
  let crc = 0xffff_ffff;
  let finalDigest: string | null = null;
  return {
    update(bytes): void {
      if (finalDigest !== null) throw new Error("checksum já foi finalizado");
      for (const byte of bytes) {
        crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] as number);
      }
    },
    digest(): string {
      finalDigest ??= `crc32:${((crc ^ 0xffff_ffff) >>> 0).toString(16).padStart(8, "0")}`;
      return finalDigest;
    },
  };
}

function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) === 0 ? value >>> 1 : 0xedb8_8320 ^ (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}
