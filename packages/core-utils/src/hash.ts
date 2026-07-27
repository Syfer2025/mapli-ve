/**
 * Hash determinístico de conteúdo.
 *
 * Usado para: chave de cache de avaliação, dedup de asset, semente de efeito,
 * e detecção de mudança. Precisa ser estável entre execuções e entre máquinas —
 * por isso nada aqui depende de ordem de iteração de objeto ou de locale.
 *
 * Não é criptográfico. Assets no container usam SHA-256, calculado no shell.
 */

import { InvariantError } from "./invariant.js";

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** FNV-1a de 32 bits, semente customizável. Devolve inteiro sem sinal. */
export function hash32(input: string | ArrayBufferView, seed = FNV_OFFSET_32): number {
  let h = seed | 0;

  if (typeof input === "string") {
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h = Math.imul(h ^ (c & 0xff), FNV_PRIME_32);
      h = Math.imul(h ^ (c >>> 8), FNV_PRIME_32);
    }
  } else {
    const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      h = Math.imul(h ^ (bytes[i] as number), FNV_PRIME_32);
    }
  }

  return h >>> 0;
}

/**
 * Serialização canônica: chaves ordenadas, tipos especiais marcados.
 *
 * Difere de `JSON.stringify` em três pontos que importam para hashing:
 * ordem de chave é imposta, `NaN`/`Infinity` são distinguidos de `null`, e
 * função/símbolo lançam em vez de desaparecer em silêncio.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "n";
  if (value === undefined) return "u";

  switch (typeof value) {
    case "boolean":
      return value ? "T" : "F";
    case "number":
      if (Number.isNaN(value)) return "#NaN";
      if (value === Infinity) return "#Inf";
      if (value === -Infinity) return "#-Inf";
      // -0 e 0 são valores distintos e precisam hashear diferente.
      if (value === 0) return Object.is(value, -0) ? "#-0" : "0";
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return `${value.toString()}n`;
    case "function":
    case "symbol":
      throw new InvariantError(`canonicalize não aceita ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return `<${bytes.length}:${hash32(bytes).toString(36)}>`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** Semente alternativa para o segundo passe de `hashObject`. */
const FNV_OFFSET_ALT = 0x9e3779b9;

/**
 * Digest hexadecimal estável de qualquer valor serializável.
 *
 * Dois passes de FNV-1a com **sementes diferentes** — um hash de 32 bits
 * sozinho colide com frequência inaceitável para chave de cache (aniversário:
 * ~1% em 10 mil chaves). Hashear o mesmo input duas vezes não acrescentaria
 * nada; a semente distinta é o que torna o segundo passe independente.
 */
export function hashObject(value: unknown): string {
  const canonical = canonicalize(value);
  const a = hash32(canonical, FNV_OFFSET_32);
  const b = hash32(canonical, FNV_OFFSET_ALT);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Combina partes em uma semente de 32 bits. A ordem importa, e partes
 * adjacentes não se fundem: `hashSeed("ab","c") !== hashSeed("a","bc")`.
 */
export function hashSeed(...parts: readonly (string | number)[]): number {
  let h = FNV_OFFSET_32;
  for (const part of parts) {
    const s = typeof part === "number" ? `#${part}` : part;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h = Math.imul(h ^ (c & 0xff), FNV_PRIME_32);
      h = Math.imul(h ^ (c >>> 8), FNV_PRIME_32);
    }
    h = Math.imul(h ^ 0x1f, FNV_PRIME_32); // separador entre partes
  }
  return h >>> 0;
}
