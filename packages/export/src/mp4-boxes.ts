/**
 * Escritor de caixas ISO BMFF — o alfabeto do MP4.
 *
 * Uma caixa é `[tamanho de 4 bytes big-endian][tipo de 4 bytes ASCII][conteúdo]`,
 * e caixas contêm caixas. Isso é tudo. O resto do muxer é saber **quais** caixas,
 * em que ordem, com que campos — e isso está em `mp4-muxer.ts`.
 *
 * Função pura sobre bytes, testável sem GPU e sem disco. O
 * [ADR-003](../../../docs/adr/ADR-003-determinism.md) pede que o arquivo seja
 * função da entrada; um escritor de caixas que não consulte nada de fora é o que
 * garante isso na camada do contêiner.
 */

/** Uma caixa montada, pronta para concatenar. */
export type Bytes = Uint8Array;

export function u8(...values: readonly number[]): Bytes {
  return new Uint8Array(values.map((value) => value & 0xff));
}

export function u16(value: number): Bytes {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

export function u24(value: number): Bytes {
  return new Uint8Array([(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

export function u32(value: number): Bytes {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

/**
 * Inteiro de 64 bits, big-endian.
 *
 * Partido em dois de 32 por `Math.floor(value / 2**32)` em vez de `>>>`: os
 * operadores bit a bit do JavaScript truncam para 32 bits, então `value >>> 32`
 * devolve o próprio valor e a metade alta sairia errada em qualquer duração acima
 * de ~4 bilhões de unidades de tempo — o que uma linha de tempo em microssegundos
 * atinge em 71 minutos.
 */
export function u64(value: number): Bytes {
  const high = Math.floor(value / 2 ** 32);
  const low = value >>> 0;
  return new Uint8Array([...u32(high), ...u32(low)]);
}

export function ascii(text: string): Bytes {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

/**
 * Ponto fixo 16.16, como as matrizes e taxas do MP4 usam.
 *
 * `Math.round` e não truncamento: 1.0 tem de sair exatamente `0x00010000`, e
 * truncar `1 * 65536` depois de aritmética de ponto flutuante pode dar 65535.
 */
export function fixed1616(value: number): Bytes {
  return u32(Math.round(value * 65536));
}

export function fixed88(value: number): Bytes {
  return u16(Math.round(value * 256));
}

export function concat(parts: readonly Bytes[]): Bytes {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * Monta uma caixa. O tipo tem de ter exatamente quatro caracteres — um tipo de
 * três bytes desalinha o arquivo inteiro e o player só diz "arquivo corrompido".
 */
export function box(type: string, ...content: readonly Bytes[]): Bytes {
  if (type.length !== 4) throw new Error(`tipo de caixa precisa de 4 caracteres: "${type}"`);
  const body = concat(content);
  return concat([u32(body.byteLength + 8), ascii(type), body]);
}

/**
 * Caixa "completa": tem versão de 1 byte e flags de 3, antes do conteúdo.
 * Metade das caixas do MP4 é assim, e esquecer os quatro bytes desloca todos os
 * campos seguintes.
 */
export function fullBox(
  type: string,
  version: number,
  flags: number,
  ...content: readonly Bytes[]
): Bytes {
  return box(type, u8(version), u24(flags), ...content);
}

/** A matriz identidade de vídeo, em 16.16 (com o último termo em 2.30). */
export const UNITY_MATRIX: Bytes = concat([
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x40000000),
]);
