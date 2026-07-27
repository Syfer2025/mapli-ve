import type { EffectInstanceData } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { BUILTIN_EMITTERS, BUILTIN_EMITTER_TYPES } from "./emitters.js";
import { createBuiltinEffectRegistry } from "./builtin.js";
import { BUILTIN_FILTERS, BUILTIN_FILTER_TYPES } from "./filters.js";
import { createEffectRegistry } from "./registry.js";
import type { EffectDefinition, EffectSpec, ParticleSystemSpec } from "./contracts.js";

/** A união é discriminada: teste de emissor sempre extrai o lado de partícula. */
function particlesOf(spec: EffectSpec): ParticleSystemSpec {
  if (spec.kind !== "particles") throw new Error("esperava especificação de partículas");
  return spec.particles;
}

function instance(type: string, overrides: Partial<EffectInstanceData> = {}): EffectInstanceData {
  const definition = [...BUILTIN_EMITTERS, ...BUILTIN_FILTERS].find((entry) => entry.type === type);
  return {
    id: "fx_1",
    type,
    enabled: true,
    params: (definition?.defaultParams ?? {}) as Record<string, unknown>,
    ...overrides,
  };
}

describe("registry de efeitos", () => {
  it("registra os nove emissores e os seis filtros da fase", () => {
    const registry = createBuiltinEffectRegistry();
    expect(registry.size).toBe(15);
    expect(registry.list()).toEqual([...BUILTIN_EMITTER_TYPES, ...BUILTIN_FILTER_TYPES]);
    expect(registry.list()).toEqual([
      "explosion",
      "smoke",
      "fire",
      "trail",
      "contrail",
      "shockwave",
      "sparks",
      "water",
      "dust",
      "glow",
      "blur",
      "drop-shadow",
      "color-grade",
      "outline",
      "chromatic",
    ]);
  });

  it("emissor produz partícula, filtro produz filtro — a união separa os dois", () => {
    const registry = createBuiltinEffectRegistry();
    const boom = registry.resolve(instance("explosion"), 1, 60);
    const glow = registry.resolve(instance("glow"), 1, 60);
    expect(boom.status).toBe("resolved");
    expect(glow.status).toBe("resolved");
    if (boom.status !== "resolved" || glow.status !== "resolved") return;
    expect(boom.spec.kind).toBe("particles");
    expect(glow.spec.kind).toBe("filter");
    if (glow.spec.kind !== "filter") return;
    expect(glow.spec.filter.type).toBe("glow");
    // Os params saem já resolvidos em número: prontos para virar uniform.
    expect(glow.spec.filter.params["radius"]).toBe(14);
    expect(glow.spec.filter.color).toBe("#ffd9a0");
  });

  it("aceita param cru e param embrulhado, e os dois dão a mesma spec", () => {
    const registry = createBuiltinEffectRegistry();
    const wrapped = registry.resolve(
      instance("glow", {
        params: {
          radius: { value: 40, keyframes: [], expression: null },
          strength: { value: 2, keyframes: [], expression: null },
          tint: { value: "#00ff00ff", keyframes: [], expression: null },
        },
      }),
      1,
      60,
    );
    // Forma avaliada: é assim que `evaluate` entrega os params no frame pedido.
    const evaluated = registry.resolve(
      instance("glow", { params: { radius: 40, strength: 2, tint: "#00ff00ff" } }),
      1,
      60,
    );
    expect(wrapped.status).toBe("resolved");
    expect(evaluated.status).toBe("resolved");
    if (wrapped.status !== "resolved" || evaluated.status !== "resolved") return;
    expect(evaluated.spec).toEqual(wrapped.spec);
    if (evaluated.spec.kind !== "filter") return;
    expect(evaluated.spec.filter.params["radius"]).toBe(40);
    expect(evaluated.spec.filter.color).toBe("#00ff00");
  });

  it("emissor também lê param avaliado — keyframe em efeito anima", () => {
    const registry = createBuiltinEffectRegistry();
    const definition = BUILTIN_EMITTERS.find((entry) => entry.type === "smoke");
    if (definition === undefined) throw new Error("emissor ausente");
    const raw = Object.fromEntries(
      Object.entries(definition.defaultParams as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === "object" && value !== null && "value" in value
          ? (value as { readonly value: unknown }).value
          : value,
      ]),
    );
    const resolution = registry.resolve(
      instance("smoke", { params: { ...raw, scale: 2.5 } }),
      7,
      60,
    );
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(particlesOf(resolution.spec).wobble).toBeCloseTo(35, 6);
  });

  it("resolve params válidos em especificação", () => {
    const registry = createBuiltinEffectRegistry();
    const resolution = registry.resolve(instance("explosion"), 4242, 60);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(particlesOf(resolution.spec).count).toBe(5000);
    expect(particlesOf(resolution.spec).seed).toBe(4242);
    expect(particlesOf(resolution.spec).fps).toBe(60);
    expect(particlesOf(resolution.spec).blend).toBe("add");
    expect(particlesOf(resolution.spec).emission).toBe("burst");
  });

  it("efeito desligado, tipo desconhecido e params inválidos não lançam", () => {
    const registry = createBuiltinEffectRegistry();
    expect(registry.resolve(instance("explosion", { enabled: false }), 1, 60).status).toBe(
      "disabled",
    );
    expect(registry.resolve(instance("teleporte"), 1, 60).status).toBe("unknown-type");
    const invalid = registry.resolve(instance("explosion", { params: { count: "muitas" } }), 1, 60);
    expect(invalid.status).toBe("invalid-params");
  });

  it("escala e duração dos params entram na especificação", () => {
    const registry = createBuiltinEffectRegistry();
    const definition = BUILTIN_EMITTERS.find((entry) => entry.type === "smoke");
    if (definition === undefined) throw new Error("emissor ausente");
    const resolution = registry.resolve(
      instance("smoke", {
        params: {
          ...(definition.defaultParams as Record<string, unknown>),
          scale: { value: 3, keyframes: [], expression: null },
          lifetime: { value: 40, keyframes: [], expression: null },
        },
      }),
      7,
      30,
    );
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(particlesOf(resolution.spec).lifetime).toBe(40);
    expect(particlesOf(resolution.spec).fps).toBe(30);
    // Wobble escala com o parâmetro: 14 × 3.
    expect(particlesOf(resolution.spec).wobble).toBeCloseTo(42, 6);
  });

  it("tipo duplicado é rejeitado e descarte remove", () => {
    const registry = createEffectRegistry();
    const definition = BUILTIN_EMITTERS[0] as EffectDefinition<never>;
    const disposable = registry.register(definition);
    expect(registry.has(definition.type)).toBe(true);
    expect(() => registry.register(definition)).toThrowError(
      expect.objectContaining({ code: "duplicate-type" }),
    );
    disposable.dispose();
    expect(registry.has(definition.type)).toBe(false);
  });

  it("todo emissor declara descriptors e defaults que passam no próprio schema", () => {
    for (const definition of BUILTIN_EMITTERS) {
      expect(definition.kind).toBe("particles");
      expect(definition.paramSchema.safeParse(definition.defaultParams).success).toBe(true);
      expect(definition.properties.length).toBeGreaterThan(0);
      expect(new Set(definition.properties.map((entry) => entry.path)).size).toBe(
        definition.properties.length,
      );
    }
  });
});
