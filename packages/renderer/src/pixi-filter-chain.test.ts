/**
 * A lógica de cadeia é verificável sem GPU: um módulo Pixi de mentira registra
 * quantos filtros foram construídos e o que foi escrito nos uniforms. O que isto
 * prova é o ponto caro — **animar um parâmetro não recompila shader**.
 */

import { describe, expect, it } from "vitest";
import type { ScreenFilter } from "./contracts.js";
import {
  destroyFilterChain,
  syncFilterChain,
  SUPPORTED_FILTER_TYPES,
} from "./pixi-filter-chain.js";

interface FakeFilter {
  readonly resources?: { readonly filterUniforms: { uniforms: Record<string, unknown> } };
  padding: number;
  enabled: boolean;
  strength?: number;
  quality?: number;
  matrix?: readonly number[];
  destroyed: boolean;
  destroy(): void;
}

interface FakeModule {
  readonly built: FakeFilter[];
  readonly compiled: string[];
}

/** Módulo mínimo com a mesma forma que `pixi-filter-chain` consome. */
function fakePixi(): { readonly module: never; readonly log: FakeModule } {
  const log: FakeModule = { built: [], compiled: [] };

  const module = {
    GlProgram: {
      from(options: { readonly name: string; readonly fragment: string }) {
        log.compiled.push(options.name);
        return { name: options.name, fragment: options.fragment };
      },
    },
    UniformGroup: class {
      readonly uniforms: Record<string, unknown>;
      constructor(definition: Record<string, { readonly value: unknown }>) {
        this.uniforms = {};
        for (const [key, entry] of Object.entries(definition)) this.uniforms[key] = entry.value;
      }
    },
    Filter: class {
      readonly resources: { readonly filterUniforms: { uniforms: Record<string, unknown> } };
      padding = 0;
      enabled = true;
      destroyed = false;
      constructor(options: {
        readonly glProgram: { readonly name: string };
        readonly resources: { readonly filterUniforms: { uniforms: Record<string, unknown> } };
      }) {
        this.resources = options.resources;
        log.built.push(this as unknown as FakeFilter);
      }
      destroy(): void {
        this.destroyed = true;
      }
    },
    BlurFilter: class {
      strength = 0;
      quality = 0;
      padding = 0;
      enabled = true;
      destroyed = false;
      constructor(options: { readonly strength: number; readonly quality: number }) {
        this.strength = options.strength;
        this.quality = options.quality;
        log.built.push(this as unknown as FakeFilter);
      }
      destroy(): void {
        this.destroyed = true;
      }
    },
    ColorMatrixFilter: class {
      matrix: readonly number[] = [];
      padding = 0;
      enabled = true;
      destroyed = false;
      constructor() {
        log.built.push(this as unknown as FakeFilter);
      }
      destroy(): void {
        this.destroyed = true;
      }
    },
  };

  return { module: module as unknown as never, log };
}

function spec(type: string, params: Record<string, number> = {}, color = "#ffffff"): ScreenFilter {
  return { type, params, color };
}

function uniformsOf(filter: unknown): Record<string, unknown> {
  const resources = (filter as { readonly resources?: unknown }).resources;
  const group = (
    resources as Record<string, { readonly uniforms: Record<string, unknown> } | undefined>
  )["filterUniforms"];
  if (group === undefined) throw new Error("filtro sem grupo de uniforms");
  return group.uniforms;
}

describe("cadeia de filtros do backend Pixi", () => {
  it("os seis tipos da fase são suportados, e só eles", () => {
    expect([...SUPPORTED_FILTER_TYPES]).toEqual([
      "glow",
      "blur",
      "drop-shadow",
      "color-grade",
      "outline",
      "chromatic",
    ]);
  });

  it("sem filtro aplicável a cadeia é ausente — nada de textura intermediária", () => {
    const { module } = fakePixi();
    expect(syncFilterChain(module, undefined, undefined)).toBeUndefined();
    expect(syncFilterChain(module, undefined, [])).toBeUndefined();
    // Tipo desconhecido é ignorado em silêncio, não vira cadeia vazia.
    expect(syncFilterChain(module, undefined, [spec("teleporte")])).toBeUndefined();
  });

  it("animar um parâmetro reaproveita o filtro: shader compila uma vez só", () => {
    const { module, log } = fakePixi();
    let chain = syncFilterChain(module, undefined, [spec("glow", { radius: 10, strength: 1 })]);
    const first = chain?.filters[0];
    expect(log.compiled).toEqual(["theatrum-glow"]);

    for (let radius = 11; radius <= 40; radius += 1) {
      chain = syncFilterChain(module, chain, [spec("glow", { radius, strength: 1 })]);
    }
    expect(chain?.filters[0]).toBe(first);
    expect(log.compiled).toEqual(["theatrum-glow"]);
    expect(log.built).toHaveLength(1);
    expect(uniformsOf(first)["uRadius"]).toBe(40);
  });

  it("mudar a lista de tipos reconstrói e libera a cadeia antiga", () => {
    const { module, log } = fakePixi();
    const original = syncFilterChain(module, undefined, [spec("glow")]);
    const replaced = syncFilterChain(module, original, [spec("glow"), spec("outline")]);
    expect(replaced).not.toBe(original);
    expect(replaced?.filters).toHaveLength(2);
    expect(log.built).toHaveLength(3);

    destroyFilterChain(original);
    expect((original?.filters[0] as unknown as FakeFilter).destroyed).toBe(true);
    expect((replaced?.filters[0] as unknown as FakeFilter).destroyed).toBe(false);
  });

  it("reordenar dois filtros muda a assinatura, porque a ordem muda o pixel", () => {
    const { module } = fakePixi();
    const forward = syncFilterChain(module, undefined, [spec("blur"), spec("outline")]);
    const reversed = syncFilterChain(module, forward, [spec("outline"), spec("blur")]);
    expect(forward?.signature).toBe("blur,outline");
    expect(reversed?.signature).toBe("outline,blur");
    expect(reversed).not.toBe(forward);
  });

  it("a folga vem do parâmetro em vigor, não de constante", () => {
    const { module } = fakePixi();
    const tight = syncFilterChain(module, undefined, [spec("glow", { radius: 4 })]);
    expect(tight?.filters[0]?.padding).toBe(6);

    const wide = syncFilterChain(module, tight, [spec("glow", { radius: 120 })]);
    expect(wide?.filters[0]?.padding).toBe(122);

    // Sombra soma deslocamento e raio: o halo não pode ser recortado.
    const shadow = syncFilterChain(module, undefined, [
      spec("drop-shadow", { offsetX: 30, offsetY: -10, radius: 12 }),
    ]);
    expect(shadow?.filters[0]?.padding).toBe(44);
  });

  it("a folga é comum à cadeia: o passe mais largo manda", () => {
    const { module } = fakePixi();
    const chain = syncFilterChain(module, undefined, [
      spec("outline", { thickness: 3 }),
      spec("glow", { radius: 50 }),
    ]);
    expect(chain?.filters.map((filter) => filter.padding)).toEqual([52, 52]);
  });

  it("cor hexadecimal chega ao uniform em 0–1", () => {
    const { module } = fakePixi();
    const chain = syncFilterChain(module, undefined, [spec("glow", { radius: 8 }, "#ff8000")]);
    const tint = uniformsOf(chain?.filters[0])["uTint"] as Float32Array;
    expect(tint[0]).toBeCloseTo(1, 5);
    expect(tint[1]).toBeCloseTo(128 / 255, 5);
    expect(tint[2]).toBeCloseTo(0, 5);
  });

  it("ângulo da aberração vira deslocamento em x e y", () => {
    const { module } = fakePixi();
    const chain = syncFilterChain(module, undefined, [
      spec("chromatic", { offset: 10, angle: 90 }),
    ]);
    const shift = uniformsOf(chain?.filters[0])["uShift"] as Float32Array;
    expect(shift[0]).toBeCloseTo(0, 5);
    expect(shift[1]).toBeCloseTo(10, 5);
  });

  it("desfoque e correção de cor usam o núcleo do Pixi, com valores saneados", () => {
    const { module } = fakePixi();
    const chain = syncFilterChain(module, undefined, [
      spec("blur", { radius: 24, quality: 99 }),
      spec("color-grade", { exposure: 1, contrast: 0, saturation: 0, temperature: 0 }),
    ]);
    const blur = chain?.filters[0] as unknown as FakeFilter;
    expect(blur.strength).toBe(24);
    expect(blur.quality).toBe(8);

    const grade = chain?.filters[1] as unknown as FakeFilter;
    expect(grade.matrix).toHaveLength(20);
    expect(grade.enabled).toBe(true);
  });

  it("correção de cor neutra fica desligada em vez de gastar um passe", () => {
    const { module } = fakePixi();
    const chain = syncFilterChain(module, undefined, [
      spec("color-grade", { exposure: 0, contrast: 0, saturation: 0, temperature: 0 }),
    ]);
    expect((chain?.filters[0] as unknown as FakeFilter).enabled).toBe(false);
  });
});
