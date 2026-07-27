/**
 * Registro dos comportamentos da Fase 5. Um comportamento novo entra com um
 * arquivo de definição e uma linha nesta lista.
 */

import { autoOrientBehavior } from "./auto-orient.js";
import { bankingBehavior } from "./banking.js";
import { followBehavior } from "./follow.js";
import { motionPathBehavior } from "./motion-path.js";
import { createBehaviorRegistry, type BehaviorRegistry } from "./registry.js";
import type { BehaviorDefinition } from "./contracts.js";
import { wiggleBehavior } from "./wiggle.js";

export const BUILTIN_BEHAVIOR_TYPES = Object.freeze([
  "motion-path",
  "auto-orient",
  "banking",
  "follow",
  "wiggle",
] as const);

export type BuiltinBehaviorType = (typeof BUILTIN_BEHAVIOR_TYPES)[number];

export const BUILTIN_BEHAVIORS: readonly BehaviorDefinition<never>[] = Object.freeze([
  motionPathBehavior,
  autoOrientBehavior,
  bankingBehavior,
  followBehavior,
  wiggleBehavior,
] as unknown as readonly BehaviorDefinition<never>[]);

export function createBuiltinBehaviorRegistry(): BehaviorRegistry {
  return createBehaviorRegistry(BUILTIN_BEHAVIORS);
}
