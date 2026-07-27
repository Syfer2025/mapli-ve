import { describe, expect, it } from "vitest";
import { createLogger, createMemorySink } from "./logger.js";

describe("createLogger", () => {
  it("emite o registro com escopo, nível, mensagem e detalhe", () => {
    const { sink, records } = createMemorySink();
    const log = createLogger("export", { sink, level: "debug" });

    log.info("job iniciado", { frames: 5400 });

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      level: "info",
      scope: "export",
      message: "job iniciado",
      detail: [{ frames: 5400 }],
    });
  });

  it("filtra abaixo do nível configurado", () => {
    const { sink, records } = createMemorySink();
    const log = createLogger("gis", { sink, level: "warn" });

    log.debug("ignorado");
    log.info("ignorado");
    log.warn("aparece");
    log.error("aparece");

    expect(records.map((r) => r.level)).toEqual(["warn", "error"]);
  });

  it('nível "silent" descarta tudo', () => {
    const { sink, records } = createMemorySink();
    const log = createLogger("x", { sink, level: "silent" });
    log.error("nem erro passa");
    expect(records).toHaveLength(0);
  });

  it("nível padrão é info", () => {
    const { sink, records } = createMemorySink();
    const log = createLogger("x", { sink });
    log.debug("fora");
    log.info("dentro");
    expect(records.map((r) => r.message)).toEqual(["dentro"]);
  });

  it("child aninha o escopo e herda nível e sink", () => {
    const { sink, records } = createMemorySink();
    const log = createLogger("export", { sink, level: "warn" });
    const child = log.child("encoder");

    expect(child.scope).toBe("export:encoder");
    child.debug("filtrado pelo nível herdado");
    child.warn("passa");

    expect(records).toHaveLength(1);
    expect(records[0]?.scope).toBe("export:encoder");
  });

  it("child aninha em vários níveis", () => {
    const { sink } = createMemorySink();
    const log = createLogger("engine", { sink }).child("export").child("ffmpeg");
    expect(log.scope).toBe("engine:export:ffmpeg");
  });

  it("aceita múltiplos argumentos de detalhe", () => {
    const { sink, records } = createMemorySink();
    createLogger("x", { sink }).info("m", 1, "dois", { tres: 3 });
    expect(records[0]?.detail).toEqual([1, "dois", { tres: 3 }]);
  });

  it("não injeta timestamp — a saída é comparável em golden test", () => {
    const { sink, records } = createMemorySink();
    createLogger("x", { sink }).info("mesma linha");
    createLogger("x", { sink }).info("mesma linha");
    expect(records[0]).toEqual(records[1]);
  });
});
