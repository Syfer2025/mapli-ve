import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parse, roundingError } from "./parse.js";
import { format } from "./format.js";
import { frame, timeBase } from "./units.js";
import { expectOk } from "@theatrum/core-utils";

const FPS_60 = timeBase(60);
const FPS_30 = timeBase(30);
const NTSC_DF = timeBase(29.97, true);

const at = (input: string, base = FPS_60): number =>
  expectOk(parse(input, base), `parse falhou para "${input}"`);

describe("parse — sufixos explícitos", () => {
  it('"f" são frames', () => {
    expect(at("90f")).toBe(90);
    expect(at("0f")).toBe(0);
    expect(at("-30f")).toBe(-30);
  });

  it('"s" são segundos', () => {
    expect(at("1.5s")).toBe(90);
    expect(at("2s")).toBe(120);
    expect(at("1.5s", FPS_30)).toBe(45);
  });

  it('"ms" são milissegundos', () => {
    expect(at("500ms")).toBe(30);
    expect(at("1000ms")).toBe(60);
    expect(at("16ms")).toBe(1);
  });
});

describe("parse — número puro", () => {
  it("é interpretado como SEGUNDOS, não frames", () => {
    // Regra deliberada: é o que um LLM assume por padrão. Interpretar como
    // frames geraria erro silencioso de fator 60.
    expect(at("2")).toBe(120);
    expect(at("1.5")).toBe(90);
    expect(at("2", FPS_30)).toBe(60);
  });
});

describe("parse — forma compacta", () => {
  it('"1m30s"', () => {
    expect(at("1m30s")).toBe(90 * 60);
    expect(at("1m")).toBe(3600);
    expect(at("90s")).toBe(5400);
    expect(at("2m5.5s")).toBe(Math.round(125.5 * 60));
  });

  it("ignora espaços", () => {
    expect(at("1m 30s")).toBe(90 * 60);
    expect(at("  2s  ")).toBe(120);
  });

  it("aceita maiúsculas", () => {
    expect(at("1M30S")).toBe(90 * 60);
    expect(at("90F")).toBe(90);
  });
});

describe("parse — formas com dois-pontos", () => {
  it("2 campos = minutos:segundos", () => {
    expect(at("0:02")).toBe(120);
    expect(at("1:30")).toBe(5400);
    expect(at("1:30", FPS_30)).toBe(2700);
  });

  it("2 campos com decimal = fração de segundo", () => {
    expect(at("1:23.5")).toBe(Math.round(83.5 * 60));
  });

  it("3 campos = horas:minutos:segundos", () => {
    expect(at("1:00:00")).toBe(3600 * 60);
    expect(at("0:01:30")).toBe(5400);
  });

  it("4 campos = timecode completo hh:mm:ss:ff", () => {
    expect(at("00:00:01:30")).toBe(90);
    expect(at("00:01:30:00")).toBe(5400);
    expect(at("01:23:45:14")).toBe((3600 + 23 * 60 + 45) * 60 + 14);
  });

  it("negativo é aceito", () => {
    expect(at("-1:30")).toBe(-5400);
    expect(at("-00:00:01:30")).toBe(-90);
  });

  it('";" antes dos frames força drop-frame', () => {
    // Convenção de broadcast. Respeitá-la evita ler um timecode drop-frame
    // como non-drop e deslocar tudo em alguns frames.
    const dropNotation = at("00:01:00;02", timeBase(29.97, false));
    const asDropFrame = at("00:01:00:02", NTSC_DF);
    expect(dropNotation).toBe(asDropFrame);
  });
});

describe("parse — erros", () => {
  it("entrada vazia", () => {
    for (const input of ["", "   "]) {
      const r = parse(input, FPS_60);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("empty");
    }
  });

  it("nunca lança, mesmo com lixo", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const r = parse(input, FPS_60);
        return typeof r.ok === "boolean";
      }),
      { numRuns: 1000 },
    );
  });

  it("forma inválida devolve malformed com dica útil", () => {
    for (const input of ["abc", "12x", "1:2:3:4:5", "::", "1::2", "s", "1.2.3s"]) {
      const r = parse(input, FPS_60);
      expect(r.ok, `"${input}" deveria falhar`).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).not.toBe("empty");
        if (r.error.kind === "malformed") expect(r.error.hint.length).toBeGreaterThan(0);
      }
    }
  });

  it("campo de frames >= fps nominal é out-of-range", () => {
    const r = parse("00:00:00:60", FPS_60);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("out-of-range");
      if (r.error.kind === "out-of-range") expect(r.error.detail).toContain("60");
    }
  });

  it("minutos ou segundos acima de 59 em timecode é out-of-range", () => {
    expect(parse("00:60:00:00", FPS_60).ok).toBe(false);
    expect(parse("00:00:60:00", FPS_60).ok).toBe(false);
  });

  it("campo de frames fracionário é rejeitado", () => {
    expect(parse("00:00:01:15.5", FPS_60).ok).toBe(false);
  });
});

describe("parse ∘ format — ida e volta", () => {
  it("timecode faz round-trip em todos os fps", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500000 }),
        fc.constantFrom(timeBase(24), timeBase(25), FPS_30, FPS_60, NTSC_DF),
        (n, base) => {
          const text = format(frame(n), base, "timecode");
          const back = parse(text, base);
          return back.ok && back.value === n;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('estilo "frames" faz round-trip', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100000, max: 100000 }), (n) => {
        const back = parse(format(frame(n), FPS_60, "frames"), FPS_60);
        return back.ok && back.value === n;
      }),
    );
  });

  it('estilo "compact" faz round-trip dentro de um frame', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500000 }), (n) => {
        const back = parse(format(frame(n), FPS_60, "compact"), FPS_60);
        return back.ok && Math.abs(back.value - n) <= 1;
      }),
      { numRuns: 300 },
    );
  });
});

describe("roundingError", () => {
  it("é zero quando o tempo cai exatamente num frame", () => {
    expect(roundingError("1.5s", FPS_60)).toBe(0);
    expect(roundingError("2s", FPS_60)).toBe(0);
  });

  it("mede o deslocamento quando não cai", () => {
    // 1,008 s a 60 fps = 60,48 → frame 60. Erro 0,48 frame.
    expect(roundingError("1.008s", FPS_60)).toBeCloseTo(0.48, 6);
  });

  it("nunca passa de meio frame", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), (s) => {
        const e = roundingError(`${s}s`, FPS_60);
        return e === null || e <= 0.5 + 1e-9;
      }),
    );
  });

  it("devolve null para entrada inválida", () => {
    expect(roundingError("lixo", FPS_60)).toBeNull();
  });
});
