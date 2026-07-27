import { projectError, type ProjectError } from "./errors.js";

export function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];

  for (const character of value) {
    const rawCodePoint = character.codePointAt(0);
    if (rawCodePoint === undefined) continue;
    // Igual a TextEncoder: surrogate isolado vira U+FFFD.
    const codePoint = rawCodePoint >= 0xd800 && rawCodePoint <= 0xdfff ? 0xfffd : rawCodePoint;

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

export function decodeUtf8(bytes: Uint8Array): string | ProjectError {
  let result = "";

  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    if (first === undefined) break;

    let codePoint: number;
    let length: number;
    let minimum: number;

    if (first <= 0x7f) {
      codePoint = first;
      length = 1;
      minimum = 0;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      length = 2;
      minimum = 0x80;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      length = 3;
      minimum = 0x800;
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07;
      length = 4;
      minimum = 0x10000;
    } else {
      return invalidUtf8(index);
    }

    if (index + length > bytes.length) return invalidUtf8(index);

    for (let offset = 1; offset < length; offset++) {
      const continuation = bytes[index + offset];
      if (continuation === undefined || (continuation & 0xc0) !== 0x80) {
        return invalidUtf8(index + offset);
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    if (
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return invalidUtf8(index);
    }

    result += String.fromCodePoint(codePoint);
    index += length;
  }

  return result;
}

function invalidUtf8(offset: number): ProjectError {
  return projectError("invalid-container", `Texto UTF-8 inválido no byte ${offset}.`, {
    pointer: `/byte/${offset}`,
  });
}
