import { describe, expect, it } from "vitest";
import { assertDefined, assertNever, invariant, InvariantError, required } from "./invariant.js";

describe("invariant", () => {
  it("passa quando a condição é verdadeira", () => {
    expect(() => invariant(true, "ok")).not.toThrow();
    expect(() => invariant(1, "ok")).not.toThrow();
    expect(() => invariant("x", "ok")).not.toThrow();
  });

  it("lança InvariantError com a mensagem prefixada", () => {
    expect(() => invariant(false, "nó não pode ser pai de si mesmo")).toThrow(InvariantError);
    expect(() => invariant(false, "nó não pode ser pai de si mesmo")).toThrow(
      /Invariante violada: nó não pode ser pai de si mesmo/,
    );
  });

  it("trata valores falsy como violação", () => {
    for (const falsy of [0, "", null, undefined, Number.NaN]) {
      expect(() => invariant(falsy, "x")).toThrow(InvariantError);
    }
  });

  it("estreita o tipo depois da asserção", () => {
    const value: string | null = "presente";
    invariant(value !== null, "não deveria ser null");
    // Se a asserção não estreitasse, isto não compilaria.
    expect(value.length).toBe(8);
  });
});

describe("assertNever", () => {
  it("lança e reporta o valor não tratado", () => {
    expect(() => assertNever("inesperado" as never, "tipo de nó")).toThrow(
      /caso não tratado em tipo de nó/,
    );
  });

  it("funciona sem contexto", () => {
    expect(() => assertNever(42 as never)).toThrow(/caso não tratado: 42/);
  });
});

describe("assertDefined / required", () => {
  it("aceita valores definidos, inclusive falsy", () => {
    expect(() => assertDefined(0, "zero é definido")).not.toThrow();
    expect(() => assertDefined("", "string vazia é definida")).not.toThrow();
    expect(() => assertDefined(false, "false é definido")).not.toThrow();
  });

  it("rejeita null e undefined, dizendo qual dos dois", () => {
    expect(() => assertDefined(null, "nó")).toThrow(/nó \(recebido null\)/);
    expect(() => assertDefined(undefined, "nó")).toThrow(/nó \(recebido undefined\)/);
  });

  it("required devolve o valor estreitado", () => {
    const maybe: number | undefined = 7;
    expect(required(maybe, "número")).toBe(7);
    expect(() => required(null, "número")).toThrow(InvariantError);
  });
});
