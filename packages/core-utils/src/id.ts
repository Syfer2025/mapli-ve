/**
 * IDs prefixados por tipo — legíveis em log, em JSON e em diff.
 *
 * Sem singleton global: cada consumidor cria sua própria fábrica. Isso não é
 * purismo. O compilador de Scene Script **precisa** ser determinístico
 * (docs/05-SCENE-SCRIPT.md), então ele semeia a fábrica a partir do hash do
 * script de entrada e obtém os mesmos IDs a cada compilação. Uma fábrica global
 * com estado compartilhado tornaria isso impossível.
 */

import { createRng, type Rng } from "./prng.js";
import { InvariantError } from "./invariant.js";

export const ID_PREFIXES = [
  "prj", // projeto
  "cmp", // composição
  "nd", //  nó
  "kf", //  keyframe
  "pth", // path
  "ast", // asset
  "geo", // dado geográfico
  "fx", //  instância de efeito
  "bhv", // instância de behavior
  "act", // instância de action
  "job", // job de render
  "pal", // paleta
  "sty", // estilo de mapa
  "mrk", // marcador
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

export interface IdFactory {
  (prefix: IdPrefix): string;
  /** Quantos IDs esta fábrica já emitiu. Útil em teste e diagnóstico. */
  readonly count: () => number;
}

const ID_BODY_LENGTH = 10; // 36^10 ≈ 3.6e15 — colisão desprezível na escala de um projeto

/**
 * Cria uma fábrica de IDs. Mesma semente → mesma sequência de IDs.
 *
 * Em modo de desenvolvimento, uma colisão (teoricamente possível) lança em vez
 * de corromper o documento em silêncio.
 */
export function createIdFactory(seed: number, options?: { detectCollisions?: boolean }): IdFactory {
  const rng: Rng = createRng(seed);
  const detect = options?.detectCollisions ?? false;
  const seen = detect ? new Set<string>() : null;
  let emitted = 0;

  const factory = ((prefix: IdPrefix): string => {
    let body = "";
    // Cada draw de 32 bits rende ~6 caracteres base36; dois bastam para 10.
    while (body.length < ID_BODY_LENGTH) {
      body += Math.floor(rng.next() * 0x100000000)
        .toString(36)
        .padStart(6, "0");
    }
    const id = `${prefix}_${body.slice(0, ID_BODY_LENGTH)}`;
    emitted++;

    if (seen !== null) {
      if (seen.has(id)) {
        throw new InvariantError(`colisão de ID gerado: ${id} (após ${emitted} emissões)`);
      }
      seen.add(id);
    }

    return id;
  }) as { (prefix: IdPrefix): string; count: () => number };

  factory.count = () => emitted;
  return factory as IdFactory;
}

const ID_PATTERN = new RegExp(`^(${ID_PREFIXES.join("|")})_[0-9a-z]{${ID_BODY_LENGTH}}$`);

/** Valida a forma de um ID. Não garante que a entidade exista. */
export function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** Extrai o prefixo de um ID, ou `undefined` se a forma for inválida. */
export function idPrefix(value: string): IdPrefix | undefined {
  const match = /^([a-z]+)_/.exec(value);
  const prefix = match?.[1];
  return prefix !== undefined && (ID_PREFIXES as readonly string[]).includes(prefix)
    ? (prefix as IdPrefix)
    : undefined;
}
