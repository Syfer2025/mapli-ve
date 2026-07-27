/**
 * @theatrum/effects — L3 · motores
 *
 * Partículas e filtros determinísticos. A regra que atravessa o pacote:
 * partícula é função fechada do tempo, resolvida no vertex shader, sem estado
 * entre frames. Ver `contracts.ts` e docs/02-MODULES.md § effects.
 *
 * Superfície pública única deste pacote. Importar
 * `@theatrum/effects/src/...` é erro de lint.
 */

export {
  EffectError,
  type EffectDefinition,
  type EffectInstanceLike,
  type EffectKind,
  type EffectSpec,
  type FilterSpec,
  type ParticleBirth,
  type ParticleFade,
  type ParticleMotion,
  type ParticleSample,
  type ParticleSystemSpec,
} from "./contracts.js";

export {
  aliveCount,
  buildParticleBuffer,
  fadeAt,
  particleBirth,
  sampleParticle,
  PARTICLE_FIELDS,
  PARTICLE_STRIDE,
  type ParticleBuffer,
} from "./particles.js";

export {
  BUILTIN_EMITTERS,
  BUILTIN_EMITTER_TYPES,
  EmitterParamsSchema,
  type EmitterParams,
} from "./emitters.js";

export { BUILTIN_FILTERS, BUILTIN_FILTER_TYPES } from "./filters.js";

export { createEffectRegistry, type EffectRegistry, type EffectResolution } from "./registry.js";

export {
  clearParticleBufferCache,
  particleBufferFor,
  particleBufferId,
  particleDrawProps,
  particleNodeId,
  type ParticleDrawProps,
} from "./draw.js";

export { effectSeed } from "./seed.js";

export { EFFECT_PRESETS, presetsFor, type EffectPreset } from "./presets.js";

export { createBuiltinEffectRegistry } from "./builtin.js";
