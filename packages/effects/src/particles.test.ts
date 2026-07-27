/**
 * As provas que a Fase 6 exige da matemática de partículas: determinismo por
 * seed, scrub para trás idêntico ao scrub para frente, e frame direto igual a
 * frame alcançado por sequência.
 */

import { describe, expect, it } from "vitest";
import {
  aliveCount,
  buildParticleBuffer,
  fadeAt,
  particleBirth,
  sampleParticle,
  PARTICLE_FIELDS,
  PARTICLE_STRIDE,
} from "./particles.js";
import { effectSeed } from "./seed.js";
import { BUILTIN_EMITTERS } from "./emitters.js";
import type { EffectDefinition, ParticleSystemSpec } from "./contracts.js";

function emitter(type: string): EffectDefinition<never> {
  const found = BUILTIN_EMITTERS.find((definition) => definition.type === type);
  if (found === undefined) throw new Error(`emissor ausente: ${type}`);
  return found;
}

function specFor(type: string, seed = 1234, fps = 60): ParticleSystemSpec {
  const definition = emitter(type);
  const spec = definition.spec(definition.defaultParams, seed, fps);
  if (spec.kind !== "particles") throw new Error(`${type} não é emissor`);
  return spec.particles;
}

/** Assinatura estável de um frame — o "hash de frame" do critério 2. */
function frameHash(buffer: ReturnType<typeof buildParticleBuffer>, frame: number): string {
  const parts: string[] = [];
  for (let index = 0; index < buffer.count; index += 1) {
    const sample = sampleParticle(buffer, index, frame);
    if (!sample.alive) continue;
    parts.push(
      [
        index,
        sample.position[0].toFixed(6),
        sample.position[1].toFixed(6),
        sample.size.toFixed(6),
        sample.rotation.toFixed(6),
        sample.opacity.toFixed(6),
        sample.color,
      ].join(":"),
    );
  }
  return parts.join("|");
}

describe("partículas analíticas", () => {
  it("o buffer tem um registro por partícula, na ordem documentada", () => {
    const buffer = buildParticleBuffer(specFor("sparks"));
    expect(PARTICLE_FIELDS).toHaveLength(PARTICLE_STRIDE);
    expect(buffer.stride).toBe(PARTICLE_STRIDE);
    expect(buffer.data).toHaveLength(buffer.count * PARTICLE_STRIDE);
    expect(buffer.colors).toHaveLength(buffer.count);
    // O primeiro registro corresponde ao nascimento derivado do índice 0.
    const birth = particleBirth(buffer.spec, 0);
    expect(buffer.data[0]).toBeCloseTo(birth.birthFrame, 5);
    expect(buffer.data[4]).toBeCloseTo(birth.velocity[0], 5);
  });

  it("nascimento é derivado do índice, não de sorteio sequencial", () => {
    const spec = specFor("explosion");
    // Calcular a partícula 4.000 sem passar pelas anteriores dá o mesmo valor.
    const direct = particleBirth(spec, 4000);
    const buffer = buildParticleBuffer(spec);
    const fromBuffer = {
      birthFrame: buffer.data[4000 * PARTICLE_STRIDE],
      velocityX: buffer.data[4000 * PARTICLE_STRIDE + 4],
    };
    expect(fromBuffer.birthFrame).toBeCloseTo(direct.birthFrame, 5);
    expect(fromBuffer.velocityX).toBeCloseTo(direct.velocity[0], 5);
  });

  it("scrub para trás dá exatamente o mesmo frame que scrub para frente", () => {
    const buffer = buildParticleBuffer(specFor("explosion"));
    const frames = [0, 5, 12, 20, 33, 41];
    const forward = frames.map((frame) => frameHash(buffer, frame));
    const backward = [...frames].reverse().map((frame) => frameHash(buffer, frame));
    expect(backward.reverse()).toEqual(forward);
  });

  it("frame direto é igual a frame alcançado por sequência", () => {
    const buffer = buildParticleBuffer(specFor("smoke"));
    const direct = frameHash(buffer, 120);
    let sequential = "";
    for (let frame = 0; frame <= 120; frame += 1) sequential = frameHash(buffer, frame);
    expect(sequential).toBe(direct);
  });

  it("mudar o seed varia tudo; voltar o seed restaura", () => {
    const original = buildParticleBuffer(specFor("explosion", 1234));
    const changed = buildParticleBuffer(specFor("explosion", 9876));
    const restored = buildParticleBuffer(specFor("explosion", 1234));

    expect(frameHash(changed, 15)).not.toBe(frameHash(original, 15));
    expect(frameHash(restored, 15)).toBe(frameHash(original, 15));
    // A diferença é ampla, não um detalhe: quase toda partícula muda de lugar.
    const moved = Array.from({ length: original.count }, (_unused, index) => {
      const a = sampleParticle(original, index, 15);
      const b = sampleParticle(changed, index, 15);
      return Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) > 1;
    }).filter(Boolean).length;
    expect(moved / original.count).toBeGreaterThan(0.9);
  });

  it("semente deriva de identidade, então duplicar um efeito varia", () => {
    const base = effectSeed(7, "nd_alvo", "fx_boom");
    expect(effectSeed(7, "nd_alvo", "fx_boom")).toBe(base);
    expect(effectSeed(7, "nd_alvo", "fx_boom_2")).not.toBe(base);
    expect(effectSeed(7, "nd_outro", "fx_boom")).not.toBe(base);
    expect(effectSeed(8, "nd_alvo", "fx_boom")).not.toBe(base);
  });

  it("nada vive antes do nascimento nem depois da vida", () => {
    const buffer = buildParticleBuffer(specFor("explosion"));
    expect(aliveCount(buffer, -1)).toBe(0);
    expect(aliveCount(buffer, 0)).toBe(buffer.count);
    // A vida varia por partícula, então a morte é escalonada.
    expect(aliveCount(buffer, 30)).toBeGreaterThan(0);
    expect(aliveCount(buffer, 30)).toBeLessThan(buffer.count);
    expect(aliveCount(buffer, 400)).toBe(0);
  });

  it("explosão sobe e cai: gravidade agindo na trajetória", () => {
    const buffer = buildParticleBuffer(specFor("explosion"));
    // Alguma partícula lançada para cima precisa voltar a descer.
    const rising = Array.from({ length: buffer.count }, (_unused, index) => index).find((index) => {
      const early = sampleParticle(buffer, index, 2);
      const mid = sampleParticle(buffer, index, 10);
      return early.alive && mid.alive && mid.position[1] < early.position[1] - 5;
    });
    expect(rising).toBeDefined();
    if (rising === undefined) return;
    const mid = sampleParticle(buffer, rising, 10);
    const late = sampleParticle(buffer, rising, 26);
    expect(late.position[1]).toBeGreaterThan(mid.position[1]);
  });

  it("fumaça deriva para cima e cresce", () => {
    const buffer = buildParticleBuffer(specFor("smoke"));
    const index = Array.from({ length: buffer.count }, (_unused, i) => i).find(
      (i) => (buffer.data[i * PARTICLE_STRIDE] ?? 0) === 0,
    );
    expect(index).toBeDefined();
    if (index === undefined) return;
    const early = sampleParticle(buffer, index, 4);
    const late = sampleParticle(buffer, index, 90);
    expect(late.position[1]).toBeLessThan(early.position[1]);
    expect(late.size).toBeGreaterThan(early.size);
  });

  it("curvas de fade ficam em [0,1] e terminam apagando", () => {
    for (const fade of ["out", "in-out", "flash", "hold"] as const) {
      for (let step = 0; step <= 20; step += 1) {
        const value = fadeAt(fade, step / 20, 0.42);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(fadeAt(fade, 1, 0.42)).toBeCloseTo(0, 6);
    }
  });

  it("contagem zero não quebra o buffer", () => {
    const empty = buildParticleBuffer({ ...specFor("sparks"), count: 0 });
    expect(empty.count).toBe(0);
    expect(empty.data).toHaveLength(0);
    expect(aliveCount(empty, 3)).toBe(0);
  });
});
