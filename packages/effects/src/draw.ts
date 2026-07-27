/**
 * Ponte entre efeito e renderer.
 *
 * O nó sintético de partículas é montado aqui, não no aplicativo: assim quem
 * compõe a cena não precisa conhecer a ordem dos campos do buffer nem a forma da
 * primitiva. `effects` → `renderer` é aresta lateral permitida na matriz L3.
 *
 * O buffer é cacheado por `bufferId`, que resume a especificação inteira. Trocar
 * um parâmetro muda o id e reconstrói; mover o playhead não reconstrói nada.
 */

import { hashSeed } from "@theatrum/core-utils";
import type { EffectInstanceData } from "@theatrum/schema";
import { buildParticleBuffer, type ParticleBuffer } from "./particles.js";
import type { ParticleSystemSpec } from "./contracts.js";

/** Props do nó sintético consumido pelo renderable `effect.particles`. */
export interface ParticleDrawProps {
  readonly bufferId: string;
  readonly count: number;
  readonly stride: number;
  readonly data: Float32Array;
  readonly colors: Uint8Array;
  readonly palette: readonly string[];
  readonly frame: number;
  readonly fade: ParticleSystemSpec["fade"];
  readonly blend: ParticleSystemSpec["blend"];
  readonly opacity: number;
  readonly wobble: number;
  readonly wobbleHz: number;
  readonly fps: number;
  readonly drift: boolean;
}

const cache = new Map<string, ParticleBuffer>();

/** Teto do cache: nove emissores com alguns ajustes cabem folgados. */
const MAX_CACHED_BUFFERS = 32;

export function particleBufferId(spec: ParticleSystemSpec): string {
  return `pb_${hashSeed(
    spec.seed,
    spec.count,
    spec.emission,
    spec.motion,
    spec.fade,
    spec.emissionFrames,
    Math.round(spec.lifetime * 1000),
    Math.round(spec.wobble * 1000),
    Math.round(spec.wobbleHz * 1000),
    spec.fps,
  ).toString(36)}`;
}

/**
 * Buffer da especificação, montado uma vez. O cache é por conteúdo, então dois
 * nós com a mesma explosão e a mesma semente compartilham o mesmo buffer.
 */
export function particleBufferFor(spec: ParticleSystemSpec): ParticleBuffer {
  const id = particleBufferId(spec);
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const built = buildParticleBuffer(spec);
  if (cache.size >= MAX_CACHED_BUFFERS) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(id, built);
  return built;
}

/**
 * Props para desenhar o efeito no frame pedido.
 *
 * `frame` é relativo ao início do efeito: o chamador subtrai o frame de entrada
 * do nó, para que a explosão comece quando o objeto entra em cena.
 */
export function particleDrawProps(
  spec: ParticleSystemSpec,
  frame: number,
  opacity = 1,
): ParticleDrawProps {
  const buffer = particleBufferFor(spec);
  return Object.freeze({
    bufferId: particleBufferId(spec),
    count: buffer.count,
    stride: buffer.stride,
    data: buffer.data,
    colors: buffer.colors,
    palette: spec.palette,
    frame,
    fade: spec.fade,
    blend: spec.blend,
    opacity,
    wobble: spec.wobble,
    wobbleHz: spec.wobbleHz,
    fps: spec.fps,
    drift: spec.motion === "drift",
  });
}

/** Id estável do nó sintético de um efeito, derivado do nó e da instância. */
export function particleNodeId(nodeId: string, effect: EffectInstanceData): string {
  return `${nodeId}#${effect.id}`;
}

/** Esvazia o cache. Existe para testes e para troca de projeto. */
export function clearParticleBufferCache(): void {
  cache.clear();
}
