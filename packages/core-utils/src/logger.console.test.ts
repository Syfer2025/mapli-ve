import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleSink, createLogger } from "./logger.js";

/**
 * O sink de console é o único ponto do projeto autorizado a chamar `console`.
 * Testado separadamente porque precisa espionar o global.
 */
describe("consoleSink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mapeia debug para console.log e os demais para o método homônimo", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleSink({ level: "debug", scope: "x", message: "d", detail: [] });
    consoleSink({ level: "info", scope: "x", message: "i", detail: [] });
    consoleSink({ level: "warn", scope: "x", message: "w", detail: [] });
    consoleSink({ level: "error", scope: "x", message: "e", detail: [] });

    // Não existe console.debug no nosso contrato mínimo — debug vai para log.
    expect(log).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it("prefixa a mensagem com o escopo entre colchetes", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleSink({ level: "info", scope: "export:encoder", message: "aberto", detail: [] });
    expect(info).toHaveBeenCalledWith("[export:encoder] aberto");
  });

  it("repassa os detalhes como argumentos extras", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleSink({ level: "info", scope: "x", message: "m", detail: [1, { a: 2 }] });
    expect(info).toHaveBeenCalledWith("[x] m", 1, { a: 2 });
  });

  it("é o sink padrão de createLogger", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    createLogger("padrao").info("sem sink explícito");
    expect(info).toHaveBeenCalledWith("[padrao] sem sink explícito");
  });
});
