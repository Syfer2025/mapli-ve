import { describe, expect, it } from "vitest";
import {
  andThen,
  collect,
  err,
  expectOk,
  isErr,
  isOk,
  mapErr,
  mapOk,
  ok,
  unwrapOr,
  unwrapOrElse,
} from "./result.js";

describe("Result", () => {
  it("distingue sucesso de falha", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isOk(err("x"))).toBe(false);
    expect(isErr(err("x"))).toBe(true);
  });

  it("mapOk transforma valor e preserva erro", () => {
    expect(mapOk(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(mapOk(err<string>("boom"), (n: number) => n * 3)).toEqual({ ok: false, error: "boom" });
  });

  it("mapErr transforma erro e preserva valor", () => {
    expect(mapErr(err("boom"), (e) => e.length)).toEqual({ ok: false, error: 4 });
    expect(mapErr(ok(7), (e: string) => e.length)).toEqual({ ok: true, value: 7 });
  });

  it("andThen encadeia e curto-circuita no primeiro erro", () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err("ímpar"));
    expect(andThen(ok(8), half)).toEqual({ ok: true, value: 4 });
    expect(andThen(ok(7), half)).toEqual({ ok: false, error: "ímpar" });
    expect(andThen(err<string>("antes"), half)).toEqual({ ok: false, error: "antes" });
  });

  it("unwrapOr e unwrapOrElse usam o fallback só na falha", () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOr(err<string>("x"), 99)).toBe(99);
    expect(unwrapOrElse(err("abc"), (e) => e.length)).toBe(3);
  });

  it("expectOk lança com contexto no erro", () => {
    expect(expectOk(ok(5), "devia dar")).toBe(5);
    expect(() => expectOk(err({ kind: "not-found" }), "abrir projeto")).toThrow(
      /abrir projeto: not-found/,
    );
    expect(() => expectOk(err(new Error("io falhou")), "salvar")).toThrow(/salvar: io falhou/);
  });

  describe("collect", () => {
    it("devolve todos os valores quando tudo passa", () => {
      expect(collect([ok(1), ok(2), ok(3)])).toEqual({ ok: true, value: [1, 2, 3] });
    });

    it("devolve TODOS os erros, não só o primeiro", () => {
      // É isso que permite ao compilador de Scene Script relatar 5 problemas
      // de uma vez em vez de um por rodada de correção.
      const r = collect([ok(1), err("a"), ok(2), err("b")]);
      expect(r).toEqual({ ok: false, error: ["a", "b"] });
    });

    it("lista vazia é sucesso vazio", () => {
      expect(collect([])).toEqual({ ok: true, value: [] });
    });
  });
});
