/**
 * Partículas analíticas.
 *
 * Este arquivo é a **referência de CPU do shader**: o buffer que ele monta é o
 * mesmo que vai para a GPU, e `sampleParticle` calcula exatamente o que o vertex
 * shader vai calcular. Ter as duas implementações permite testar a matemática sem
 * GPU e comparar shader contra referência quando algo divergir.
 *
 * O nascimento de cada partícula vem de `hashSeed(seed, índice)` — derivação, não
 * sorteio sequencial. Isso importa: a partícula 4.000 pode ser calculada sem
 * passar pelas 3.999 anteriores, que é o que permite montar o buffer em paralelo
 * e reproduzir uma explosão isolada.
 */

import { clamp01, type Vec2 } from "@theatrum/core-math";
import { createRng, hashSeed } from "@theatrum/core-utils";
import type { ParticleBirth, ParticleSample, ParticleSystemSpec } from "./contracts.js";

/** Floats por partícula no buffer. Mantenha em sincronia com `PARTICLE_FIELDS`. */
export const PARTICLE_STRIDE = 13;

/** Ordem dos campos no buffer; o shader lê pelos mesmos deslocamentos. */
export const PARTICLE_FIELDS = Object.freeze([
  "birthFrame",
  "lifetime",
  "originX",
  "originY",
  "velocityX",
  "velocityY",
  "accelerationX",
  "accelerationY",
  "size",
  "sizeEnd",
  "rotation",
  "spin",
  "variation",
] as const);

export interface ParticleBuffer {
  readonly count: number;
  readonly stride: number;
  /** Structure of arrays achatado: `count * stride` floats. */
  readonly data: Float32Array;
  /** Índice de cor por partícula, separado porque é inteiro. */
  readonly colors: Uint8Array;
  readonly spec: ParticleSystemSpec;
}

/**
 * Nascimento da partícula `index`. Puro e independente das outras.
 *
 * O RNG é semeado por `hashSeed(spec.seed, index)`, então mudar
 * `composition.seed` muda todas as partículas de todos os efeitos, e voltar o
 * seed devolve exatamente o estado anterior.
 */
export function particleBirth(spec: ParticleSystemSpec, index: number): ParticleBirth {
  const rng = createRng(hashSeed(spec.seed, index));
  const variation = rng.next();
  const angle = rng.angle();
  const speedUnit = rng.next();
  const lifeUnit = rng.next();
  const sizeUnit = rng.next();

  const birthFrame =
    spec.emission === "burst"
      ? 0
      : // Emissão contínua espalha nascimentos pela janela, sem agrupar.
        Math.round(rng.next() * Math.max(0, spec.emissionFrames));
  const lifetime = Math.max(1, spec.lifetime * (0.65 + lifeUnit * 0.7));
  const speed = motionSpeed(spec, speedUnit);

  const direction: Vec2 =
    spec.motion === "trail"
      ? // Rastro: sai para trás, com abertura estreita.
        [Math.cos(Math.PI + (variation - 0.5) * 0.6), Math.sin(Math.PI + (variation - 0.5) * 0.6)]
      : spec.motion === "drift"
        ? // Deriva: sobe, com abertura lateral moderada.
          [(variation - 0.5) * 0.8, -1]
        : [Math.cos(angle), Math.sin(angle)];

  const originRadius = spec.motion === "radial" ? 0 : (spec.wobble * variation) / 4;
  return Object.freeze({
    birthFrame,
    lifetime,
    origin: [Math.cos(angle) * originRadius, Math.sin(angle) * originRadius] as Vec2,
    velocity: [direction[0] * speed, direction[1] * speed] as Vec2,
    acceleration: motionAcceleration(spec, variation),
    size: sizeFor(spec, sizeUnit),
    sizeEnd: spec.motion === "drift" ? 2.4 : spec.motion === "radial" ? 1.6 : 0.15,
    rotation: angle * (180 / Math.PI),
    spin: (variation - 0.5) * 12,
    colorIndex: Math.min(spec.palette.length - 1, Math.floor(rng.next() * spec.palette.length)),
    variation,
  });
}

/** Monta o buffer uma única vez por especificação. */
export function buildParticleBuffer(spec: ParticleSystemSpec): ParticleBuffer {
  const count = Math.max(0, Math.floor(spec.count));
  const data = new Float32Array(count * PARTICLE_STRIDE);
  const colors = new Uint8Array(count);

  for (let index = 0; index < count; index += 1) {
    const birth = particleBirth(spec, index);
    const offset = index * PARTICLE_STRIDE;
    data[offset] = birth.birthFrame;
    data[offset + 1] = birth.lifetime;
    data[offset + 2] = birth.origin[0];
    data[offset + 3] = birth.origin[1];
    data[offset + 4] = birth.velocity[0];
    data[offset + 5] = birth.velocity[1];
    data[offset + 6] = birth.acceleration[0];
    data[offset + 7] = birth.acceleration[1];
    data[offset + 8] = birth.size;
    data[offset + 9] = birth.sizeEnd;
    data[offset + 10] = birth.rotation;
    data[offset + 11] = birth.spin;
    data[offset + 12] = birth.variation;
    colors[index] = birth.colorIndex;
  }

  return Object.freeze({ count, stride: PARTICLE_STRIDE, data, colors, spec });
}

/**
 * Estado da partícula no frame pedido. Espelha o vertex shader linha a linha.
 *
 * `frame` é relativo ao início do efeito. Antes do nascimento e depois da morte a
 * partícula não está viva — o shader colapsa o quad em vez de desenhar.
 */
export function sampleParticle(
  buffer: ParticleBuffer,
  index: number,
  frame: number,
): ParticleSample {
  const offset = index * buffer.stride;
  const data = buffer.data;
  const birthFrame = data[offset] ?? 0;
  const lifetime = data[offset + 1] ?? 1;
  const tau = frame - birthFrame;
  const progress = lifetime <= 0 ? 1 : tau / lifetime;

  if (tau < 0 || progress > 1) {
    return Object.freeze({
      alive: false,
      position: [0, 0] as Vec2,
      size: 0,
      rotation: 0,
      opacity: 0,
      color: buffer.spec.palette[0] ?? "#ffffff",
    });
  }

  const originX = data[offset + 2] ?? 0;
  const originY = data[offset + 3] ?? 0;
  const velocityX = data[offset + 4] ?? 0;
  const velocityY = data[offset + 5] ?? 0;
  const accelerationX = data[offset + 6] ?? 0;
  const accelerationY = data[offset + 7] ?? 0;
  const size = data[offset + 8] ?? 1;
  const sizeEnd = data[offset + 9] ?? 0;
  const rotation = data[offset + 10] ?? 0;
  const spin = data[offset + 11] ?? 0;
  const variation = data[offset + 12] ?? 0;

  let x = originX + velocityX * tau + 0.5 * accelerationX * tau * tau;
  let y = originY + velocityY * tau + 0.5 * accelerationY * tau * tau;

  if (buffer.spec.wobble > 0 && buffer.spec.motion === "drift") {
    // Wobble é seno do tempo: continua sendo função fechada de `frame`.
    const phase = variation * Math.PI * 2;
    const omega = (buffer.spec.wobbleHz * 2 * Math.PI) / Math.max(1, buffer.spec.fps);
    x += Math.sin(phase + omega * tau) * buffer.spec.wobble;
    y += Math.cos(phase * 1.7 + omega * 0.6 * tau) * buffer.spec.wobble * 0.35;
  }

  const colorIndex = buffer.colors[index] ?? 0;
  return Object.freeze({
    alive: true,
    position: [x, y] as Vec2,
    size: size * (1 + (sizeEnd - 1) * progress),
    rotation: rotation + spin * tau,
    opacity: fadeAt(buffer.spec.fade, progress, variation),
    color: buffer.spec.palette[colorIndex] ?? buffer.spec.palette[0] ?? "#ffffff",
  });
}

/** Quantas partículas estão vivas no frame — útil para provas e telemetria. */
export function aliveCount(buffer: ParticleBuffer, frame: number): number {
  let alive = 0;
  for (let index = 0; index < buffer.count; index += 1) {
    if (sampleParticle(buffer, index, frame).alive) alive += 1;
  }
  return alive;
}

export function fadeAt(
  fade: ParticleSystemSpec["fade"],
  progress: number,
  variation: number,
): number {
  const t = clamp01(progress);
  switch (fade) {
    case "out":
      return 1 - t * t;
    case "in-out":
      // Sobe rápido, cai devagar: fumaça e poeira.
      return Math.min(1, t * 6) * (1 - t) ** 1.5;
    case "flash":
      // Clarão: quase tudo no primeiro décimo, com cintilação por partícula.
      return (1 - t) ** 4 * (0.7 + 0.3 * Math.sin(variation * 31 + t * 40));
    case "hold":
      return t > 0.92 ? (1 - t) / 0.08 : 1;
  }
  return 1 - t;
}

function motionSpeed(spec: ParticleSystemSpec, unit: number): number {
  const base = spec.motion === "drift" ? 0.6 : spec.motion === "trail" ? 1.1 : 3.2;
  // Distribuição com cauda: a maioria média, algumas bem rápidas.
  return base * (0.35 + unit * unit * 1.9);
}

function motionAcceleration(spec: ParticleSystemSpec, variation: number): Vec2 {
  switch (spec.motion) {
    case "ballistic":
      // Gravidade em pixels por frame², mais leve para partículas menores.
      return [0, 0.055 + variation * 0.03];
    case "radial":
      return [0, 0.004];
    case "drift":
      // Empuxo: fumaça acelera para cima e desacelera lateralmente.
      return [0, -0.012 - variation * 0.01];
    case "trail":
      return [0, 0.012];
  }
  return [0, 0];
}

function sizeFor(spec: ParticleSystemSpec, unit: number): number {
  const base = spec.motion === "drift" ? 26 : spec.motion === "radial" ? 8 : 5;
  return base * (0.55 + unit * 1.1);
}
