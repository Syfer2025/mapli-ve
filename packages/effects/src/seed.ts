/**
 * Derivação de semente.
 *
 * O invariante do módulo: **a semente vem da identidade, nunca de um contador
 * global**. Duplicar uma explosão dá variação diferente — o que se quer — mas
 * cada uma continua reproduzível, porque a semente é função de
 * `(seed da composição, id do nó, id do efeito)`.
 *
 * Consequência direta do critério 4 da Fase 6: mudar `composition.seed` varia
 * todas as explosões; voltar o seed devolve exatamente o estado anterior.
 */

import { hashSeed } from "@theatrum/core-utils";

export function effectSeed(compositionSeed: number, nodeId: string, effectId: string): number {
  return hashSeed(compositionSeed, nodeId, effectId);
}
