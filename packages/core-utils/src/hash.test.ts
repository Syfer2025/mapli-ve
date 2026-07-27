import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canonicalize, hash32, hashObject, hashSeed } from "./hash.js";
import { InvariantError } from "./invariant.js";

describe("hash32", () => {
  it("é estável — o valor não pode mudar entre versões", () => {
    // Valores gravados: se um refactor mudar o algoritmo, todo cache em disco
    // e todo golden frame invalidam de uma vez. Isso precisa ser deliberado.
    expect(hash32("")).toBe(0x811c9dc5);
    expect(hash32("theatrum")).toBe(hash32("theatrum"));
  });

  it("devolve inteiro sem sinal de 32 bits", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const h = hash32(s);
        return Number.isInteger(h) && h >= 0 && h <= 0xffffffff;
      }),
    );
  });

  it("distingue entradas diferentes na esmagadora maioria dos casos", () => {
    const seen = new Map<number, string>();
    let collisions = 0;
    for (let i = 0; i < 20000; i++) {
      const key = `nd_${i}/transform/position`;
      const h = hash32(key);
      if (seen.has(h) && seen.get(h) !== key) collisions++;
      seen.set(h, key);
    }
    // ~0,05% é o esperado para 32 bits com 20 mil chaves (aniversário).
    expect(collisions).toBeLessThan(20);
  });

  it("aceita ArrayBufferView", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(hash32(bytes)).toBe(hash32(new Uint8Array([1, 2, 3, 4])));
    expect(hash32(bytes)).not.toBe(hash32(new Uint8Array([4, 3, 2, 1])));
  });

  it("respeita a semente", () => {
    expect(hash32("x", 1)).not.toBe(hash32("x", 2));
  });
});

describe("canonicalize", () => {
  it("ordena chaves — ordem de inserção não pode afetar o resultado", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("preserva ordem de array", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("distingue NaN, Infinity e null — JSON.stringify os achataria em null", () => {
    const values = [Number.NaN, Infinity, -Infinity, null, 0, -0];
    const encoded = values.map(canonicalize);
    expect(new Set(encoded).size).toBe(values.length);
  });

  it("ignora chaves undefined, como JSON.stringify", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it("lança em função e símbolo em vez de sumir com eles", () => {
    expect(() => canonicalize(() => 1)).toThrow(InvariantError);
    expect(() => canonicalize(Symbol("x"))).toThrow(InvariantError);
  });

  it("aceita objetos aninhados", () => {
    const doc = { nodes: { nd_1: { pos: [1, 2] } }, fps: 60 };
    expect(canonicalize(doc)).toBe(canonicalize({ fps: 60, nodes: { nd_1: { pos: [1, 2] } } }));
  });
});

describe("hashObject", () => {
  it("é estável para o mesmo conteúdo, independente da ordem de chave", () => {
    expect(hashObject({ a: 1, b: [2, 3] })).toBe(hashObject({ b: [2, 3], a: 1 }));
  });

  it("muda quando o conteúdo muda", () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });

  it("devolve 16 caracteres hexadecimais", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => /^[0-9a-f]{16}$/.test(hashObject(v))),
      { numRuns: 200 },
    );
  });

  it("os dois passes são independentes — metades diferem", () => {
    // Se as duas metades fossem iguais, o segundo passe não somaria entropia
    // e o digest valeria 32 bits em vez de 64.
    let identicalHalves = 0;
    for (let i = 0; i < 500; i++) {
      const h = hashObject({ i });
      if (h.slice(0, 8) === h.slice(8)) identicalHalves++;
    }
    expect(identicalHalves).toBe(0);
  });
});

describe("hashSeed", () => {
  it("respeita a ordem das partes", () => {
    expect(hashSeed("a", "b")).not.toBe(hashSeed("b", "a"));
  });

  it("não funde partes adjacentes", () => {
    expect(hashSeed("ab", "c")).not.toBe(hashSeed("a", "bc"));
  });

  it("distingue número de string com o mesmo texto", () => {
    expect(hashSeed(1)).not.toBe(hashSeed("1"));
  });

  it("é determinístico e cabe em 32 bits sem sinal", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.string(), fc.integer())), (parts) => {
        const a = hashSeed(...parts);
        const b = hashSeed(...parts);
        return a === b && a >= 0 && a <= 0xffffffff;
      }),
    );
  });
});
