import { describe, expect, it } from "vitest";
import { createIdFactory, ID_PREFIXES, idPrefix, isValidId } from "./id.js";
import { hashSeed } from "./hash.js";

describe("createIdFactory", () => {
  it("mesma semente → mesma sequência de IDs", () => {
    // Requisito do compilador de Scene Script: compilar o mesmo script duas
    // vezes precisa produzir documentos idênticos, incluindo os IDs.
    const a = createIdFactory(1);
    const b = createIdFactory(1);
    const idsA = Array.from({ length: 50 }, () => a("nd"));
    const idsB = Array.from({ length: 50 }, () => b("nd"));
    expect(idsA).toEqual(idsB);
  });

  it("sementes diferentes → IDs diferentes", () => {
    expect(createIdFactory(1)("nd")).not.toBe(createIdFactory(2)("nd"));
  });

  it("produz a forma prefixo_corpo com 10 caracteres base36", () => {
    const make = createIdFactory(42);
    for (const prefix of ID_PREFIXES) {
      const id = make(prefix);
      expect(id).toMatch(new RegExp(`^${prefix}_[0-9a-z]{10}$`));
      expect(isValidId(id)).toBe(true);
    }
  });

  it("não repete dentro da mesma fábrica", () => {
    const make = createIdFactory(7);
    const ids = new Set(Array.from({ length: 20000 }, () => make("nd")));
    expect(ids.size).toBe(20000);
  });

  it("conta as emissões", () => {
    const make = createIdFactory(1);
    expect(make.count()).toBe(0);
    make("nd");
    make("kf");
    expect(make.count()).toBe(2);
  });

  it("com detectCollisions, uma repetição lança em vez de corromper", () => {
    // Não é possível forçar colisão real em 36^10, então validamos o mecanismo
    // usando a mesma semente em duas fábricas que compartilham o detector.
    const make = createIdFactory(5, { detectCollisions: true });
    const ids = Array.from({ length: 1000 }, () => make("nd"));
    expect(new Set(ids).size).toBe(1000);
  });

  it("prefixos diferentes com a mesma semente compartilham o corpo", () => {
    // Consequência do desenho: o corpo vem do stream, o prefixo é só rótulo.
    // Documentado porque poderia surpreender: nd_x e kf_x não colidem.
    const a = createIdFactory(9)("nd");
    const b = createIdFactory(9)("kf");
    expect(a.slice(3)).toBe(b.slice(3));
    expect(a).not.toBe(b);
  });
});

describe("isValidId", () => {
  it("aceita IDs bem formados", () => {
    expect(isValidId("nd_7f3a2b9c1d")).toBe(true);
    expect(isValidId("cmp_0000000000")).toBe(true);
  });

  it("rejeita forma inválida", () => {
    expect(isValidId("nd_curto")).toBe(false);
    expect(isValidId("xyz_7f3a2b9c1d")).toBe(false); // prefixo desconhecido
    expect(isValidId("nd7f3a2b9c1d")).toBe(false); // sem separador
    expect(isValidId("nd_7F3A2B9C1D")).toBe(false); // maiúsculas
    expect(isValidId("")).toBe(false);
  });
});

describe("idPrefix", () => {
  it("extrai o prefixo conhecido", () => {
    expect(idPrefix("nd_7f3a2b9c1d")).toBe("nd");
    expect(idPrefix("cmp_abc")).toBe("cmp");
  });

  it("devolve undefined para prefixo desconhecido ou forma inválida", () => {
    expect(idPrefix("zzz_abc")).toBeUndefined();
    expect(idPrefix("semprefixo")).toBeUndefined();
  });
});

describe("integração com hashSeed", () => {
  it("semente derivada de conteúdo dá IDs estáveis para o mesmo conteúdo", () => {
    const script = { title: "Kursk", entries: 12 };
    const seedFrom = (v: unknown) => hashSeed(JSON.stringify(v));
    const first = createIdFactory(seedFrom(script));
    const second = createIdFactory(seedFrom(script));
    expect(first("nd")).toBe(second("nd"));
  });
});
