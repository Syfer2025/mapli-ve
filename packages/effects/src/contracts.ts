/**
 * Contratos de efeito.
 *
 * A invariante que manda em tudo aqui: **partícula é função fechada do tempo**.
 *
 *     P(i, f) = origem(i) + v₀(i)·τ + ½·a(i)·τ²,  τ = f − nascimento(i)
 *
 * com todos os termos derivados de `hashSeed(effectId, i)`. Consequências, e são
 * elas que justificam a restrição:
 *
 * - **Custo de CPU por frame é zero.** O buffer é montado uma vez; o frame entra
 *   como uniform e o vertex shader resolve a posição.
 * - **Scrub para trás funciona.** Não há estado acumulado para rebobinar.
 * - **Export é bit-exato.** Renderizar o frame 400 direto dá o mesmo que chegar
 *   nele passando por 0..399.
 *
 * Um efeito que precisasse de estado — colisão, flocking — não entra como
 * partícula analítica; seria simulação de passo fixo com cache, mecanismo
 * separado e fora do escopo da Fase 6. Ver docs/02-MODULES.md § effects.
 */

import type { Vec2 } from "@theatrum/core-math";
import type { PropertyDescriptor } from "@theatrum/scene-graph";
import type { z } from "zod";

export type EffectKind = "particles" | "filter" | "generator";

/** Como a posição evolui no tempo. Todas as formas são fechadas em `τ`. */
export type ParticleMotion = "ballistic" | "radial" | "drift" | "trail";

/** Curva de opacidade ao longo da vida da partícula. */
export type ParticleFade = "out" | "in-out" | "flash" | "hold";

export interface ParticleBirth {
  /** Frame, relativo ao início do efeito, em que a partícula aparece. */
  readonly birthFrame: number;
  readonly lifetime: number;
  /** Deslocamento inicial em relação à âncora do nó, em pixels de tela. */
  readonly origin: Vec2;
  /** Pixels por frame. */
  readonly velocity: Vec2;
  /** Pixels por frame². */
  readonly acceleration: Vec2;
  readonly size: number;
  /** Multiplicador de tamanho no fim da vida; 0 encolhe até desaparecer. */
  readonly sizeEnd: number;
  readonly rotation: number;
  /** Graus por frame. */
  readonly spin: number;
  /** Índice na paleta do emissor. */
  readonly colorIndex: number;
  /** Valor em [0,1) para variação livre — usado por wobble e cintilação. */
  readonly variation: number;
}

export interface ParticleSystemSpec {
  readonly count: number;
  readonly emission: "burst" | "continuous";
  readonly motion: ParticleMotion;
  readonly fade: ParticleFade;
  /** Duração total da emissão em frames; `burst` usa 0. */
  readonly emissionFrames: number;
  readonly lifetime: number;
  /** Cores em `#rrggbb`, escolhidas por `colorIndex`. */
  readonly palette: readonly string[];
  readonly blend: "normal" | "add" | "screen";
  /** Amplitude do wobble de `drift`, em pixels. */
  readonly wobble: number;
  /** Frequência do wobble, em ciclos por segundo. */
  readonly wobbleHz: number;
  readonly seed: number;
  readonly fps: number;
}

/** Estado de uma partícula num frame — o que o shader calcula por vértice. */
export interface ParticleSample {
  readonly alive: boolean;
  readonly position: Vec2;
  readonly size: number;
  readonly rotation: number;
  readonly opacity: number;
  readonly color: string;
}

/** Filtro de imagem, descrito de forma neutra de backend. */
export interface FilterSpec {
  readonly type: "glow" | "blur" | "drop-shadow" | "color-grade" | "outline" | "chromatic";
  /** Já resolvidos em números, prontos para virar uniform. */
  readonly params: Readonly<Record<string, number>>;
  /** Cor no formato hexadecimal de seis dígitos, quando o filtro tem uma. */
  readonly color: string;
}

/**
 * Especificação resolvida de um efeito. A união é discriminada porque partícula
 * e filtro seguem caminhos diferentes no renderer: uma vira geometria, a outra
 * vira passe de imagem sobre o nó já desenhado.
 */
export type EffectSpec =
  | { readonly kind: "particles"; readonly particles: ParticleSystemSpec }
  | { readonly kind: "filter"; readonly filter: FilterSpec };

export interface EffectDefinition<P = Record<string, unknown>> {
  readonly type: string;
  readonly label: string;
  readonly kind: EffectKind;
  readonly paramSchema: z.ZodType<P>;
  readonly defaultParams: P;
  /** Consumidos pelo painel de efeitos e pela timeline, como nos tipos de nó. */
  readonly properties: readonly PropertyDescriptor[];
  /**
   * Especificação resolvida. Puro: mesmos `(params, seed, fps)` → mesma spec.
   * O `seed` vem da identidade do nó e da composição, nunca de contador global.
   */
  spec(params: P, seed: number, fps: number): EffectSpec;
}

export class EffectError extends Error {
  readonly code: "duplicate-type" | "unknown-type" | "invalid-params";
  readonly type: string;

  constructor(
    code: "duplicate-type" | "unknown-type" | "invalid-params",
    type: string,
    message: string,
  ) {
    super(message);
    this.name = "EffectError";
    this.code = code;
    this.type = type;
  }
}
