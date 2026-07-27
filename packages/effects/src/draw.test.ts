/**
 * Prova de que a nuvem chega ao backend como **um único nó** — um material, um
 * draw call — e que mover o playhead não reconstrói buffer.
 */

import {
  createHeadlessRenderBackend,
  createRenderer,
  registerBuiltinRenderables,
  RenderableRegistry,
  type ScreenNode,
  type ScreenScene,
} from "@theatrum/renderer";
import { MAT2D_IDENTITY } from "@theatrum/core-math";
import { describe, expect, it } from "vitest";
import { BUILTIN_EMITTERS } from "./emitters.js";
import {
  clearParticleBufferCache,
  particleBufferFor,
  particleBufferId,
  particleDrawProps,
  particleNodeId,
} from "./draw.js";
import type { ParticleSystemSpec } from "./contracts.js";

function specFor(type: string, seed = 99, fps = 60): ParticleSystemSpec {
  const definition = BUILTIN_EMITTERS.find((entry) => entry.type === type);
  if (definition === undefined) throw new Error(`emissor ausente: `);
  const spec = definition.spec(definition.defaultParams, seed, fps);
  if (spec.kind !== "particles") throw new Error(` não é emissor`);
  return spec.particles;
}

function sceneWith(props: Record<string, unknown>, frame: number): ScreenScene {
  const node: ScreenNode = {
    id: "nd_alvo#fx_boom",
    type: "effect.particles",
    slot: "scene",
    props,
    layout: {
      matrix: MAT2D_IDENTITY,
      size: [1, 1],
      opacity: 1,
      visible: true,
      blendMode: "normal",
    },
  };
  return {
    frame,
    size: [1920, 1080],
    pixelRatio: 1,
    nodes: new Map([[node.id, node]]),
    drawOrder: [node.id],
  };
}

describe("ponte de desenho de partículas", () => {
  it("5.000 partículas viram um nó só na cena", async () => {
    const registry = new RenderableRegistry();
    registerBuiltinRenderables(registry);
    const backend = createHeadlessRenderBackend();
    const renderer = createRenderer({ backend, registry });
    await renderer.init({ overlay: {} });

    const spec = specFor("explosion");
    expect(spec.count).toBe(5000);
    renderer.render(sceneWith({ ...particleDrawProps(spec, 10) }, 10), ["scene"]);

    const slot = backend.snapshot().slots[0];
    expect(slot?.nodes).toHaveLength(1);
    const visual = slot?.nodes[0]?.visual;
    expect(visual?.kind).toBe("particles");
    if (visual?.kind !== "particles") return;
    expect(visual.count).toBe(5000);
    expect(visual.data).toHaveLength(5000 * visual.stride);
    expect(visual.frame).toBe(10);
    expect(visual.blend).toBe("add");
  });

  it("o buffer é reaproveitado entre frames e recriado quando o parâmetro muda", () => {
    clearParticleBufferCache();
    const spec = specFor("sparks");
    const first = particleBufferFor(spec);
    const again = particleBufferFor(spec);
    expect(again).toBe(first);
    // O mesmo buffer serve a qualquer frame: o frame é uniform, não conteúdo.
    expect(particleDrawProps(spec, 0).data).toBe(particleDrawProps(spec, 240).data);

    const heavier = particleBufferFor({ ...spec, count: spec.count + 1 });
    expect(heavier).not.toBe(first);
    expect(particleBufferId({ ...spec, count: spec.count + 1 })).not.toBe(particleBufferId(spec));
  });

  it("id do buffer resume a especificação, e a semente entra nele", () => {
    const base = specFor("explosion", 1);
    expect(particleBufferId(base)).toBe(particleBufferId(specFor("explosion", 1)));
    expect(particleBufferId(base)).not.toBe(particleBufferId(specFor("explosion", 2)));
    expect(particleBufferId(base)).not.toBe(particleBufferId({ ...base, fade: "flash" }));
  });

  it("id do nó sintético combina nó e instância", () => {
    const id = particleNodeId("nd_alvo", {
      id: "fx_boom",
      type: "explosion",
      enabled: true,
      params: {},
    });
    expect(id).toBe("nd_alvo#fx_boom");
  });

  it("props levam wobble só quando o movimento é de deriva", () => {
    expect(particleDrawProps(specFor("smoke"), 5).drift).toBe(true);
    expect(particleDrawProps(specFor("explosion"), 5).drift).toBe(false);
    expect(particleDrawProps(specFor("smoke"), 5).wobble).toBeGreaterThan(0);
  });

  it("opacidade do nó multiplica a das partículas", () => {
    expect(particleDrawProps(specFor("fire"), 3, 0.4).opacity).toBeCloseTo(0.4, 9);
  });
});
