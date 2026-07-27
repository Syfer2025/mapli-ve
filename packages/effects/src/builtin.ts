/** Registro dos efeitos da Fase 6. Um efeito novo entra com uma linha aqui. */

import { BUILTIN_EMITTERS } from "./emitters.js";
import { BUILTIN_FILTERS } from "./filters.js";
import { createEffectRegistry, type EffectRegistry } from "./registry.js";

export function createBuiltinEffectRegistry(): EffectRegistry {
  return createEffectRegistry([...BUILTIN_EMITTERS, ...BUILTIN_FILTERS]);
}
