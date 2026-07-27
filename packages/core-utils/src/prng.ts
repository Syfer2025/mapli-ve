/**
 * Gerador pseudoaleatório semeado — a **única** fonte de aleatoriedade do
 * sistema. `Math.random()` é proibido em todo o projeto pela regra de lint
 * `no-nondeterminism`, porque quebraria a reprodutibilidade do export.
 *
 * Ver docs/adr/ADR-003-determinism.md.
 *
 * Algoritmo: sfc32, semeado por splitmix32. Escolhido em vez de PCG32 porque
 * opera só em inteiros de 32 bits — PCG32 exigiria BigInt em JS, ~10× mais
 * lento, sem ganho de qualidade estatística relevante aqui.
 */

export interface Rng {
  /** Próximo float em [0, 1). */
  next(): number;
  /** Inteiro em [0, max). `max` deve ser > 0. */
  int(max: number): number;
  /** Float em [min, max). */
  range(min: number, max: number): number;
  /** Booleano com probabilidade `p` de ser true. */
  bool(p?: number): boolean;
  /** Elemento aleatório. Devolve `undefined` para array vazio. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Distribuição normal padrão (Box-Muller), média 0, desvio 1. */
  gaussian(): number;
  /** Ângulo em radianos, [0, 2π). */
  angle(): number;
}

/** Expande uma semente de 32 bits em quatro palavras de estado descorrelacionadas. */
function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const expand = splitmix32(seed >>> 0);
  let a = expand();
  let b = expand();
  let c = expand();
  let d = expand();

  const next = (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Descarta as primeiras saídas: sfc32 precisa de rodagem para dispersar
  // sementes próximas. Sem isso, createRng(1) e createRng(2) produzem
  // primeiras saídas correlacionadas — visível como explosões "iguais".
  for (let i = 0; i < 12; i++) next();

  let spare: number | null = null;

  return {
    next,
    int(max) {
      return Math.floor(next() * max);
    },
    range(min, max) {
      return min + next() * (max - min);
    },
    bool(p = 0.5) {
      return next() < p;
    },
    pick(items) {
      if (items.length === 0) return undefined;
      return items[Math.floor(next() * items.length)];
    },
    gaussian() {
      // Box-Muller polar produz DOIS valores por rodada; o segundo fica de
      // reserva. Descartá-lo dobraria o consumo do stream — e, como a semente
      // define a sequência, isso mudaria toda a aparência dos efeitos.
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }

      for (;;) {
        const u = next() * 2 - 1;
        const v = next() * 2 - 1;
        const s = u * u + v * v;
        if (s === 0 || s >= 1) continue; // fora do círculo unitário: reamostra
        const mul = Math.sqrt((-2 * Math.log(s)) / s);
        spare = v * mul;
        return u * mul;
      }
    },
    angle() {
      return next() * Math.PI * 2;
    },
  };
}
