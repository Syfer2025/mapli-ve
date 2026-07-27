/**
 * Provas da biblioteca 3D local. O que importa aqui é a **fronteira**: listar não
 * traz bytes para o projeto, e importar traz — pelo mesmo caminho que arrastar um
 * arquivo, não por um paralelo.
 */

import { describe, expect, it, vi } from "vitest";
import {
  filterLocalModels,
  groupLocalModels,
  importLocalModel,
  localModelLabel,
  type LocalModel,
} from "./local-models.js";

function model(overrides: Partial<LocalModel> = {}): LocalModel {
  return {
    file: "t-90m.glb",
    label: "T-90m",
    category: "blindado",
    bytes: 54_000_000,
    variant: null,
    ...overrides,
  };
}

describe("biblioteca 3D local", () => {
  it("variação aparece no nome, em vez de virar duplicata silenciosa", () => {
    expect(localModelLabel(model())).toBe("T-90m");
    expect(localModelLabel(model({ variant: 2 }))).toBe("T-90m · variação 2");
    // Variação 0 é número, não ausência — `null` é que significa principal.
    expect(localModelLabel(model({ variant: 0 }))).toBe("T-90m · variação 0");
  });

  it("busca cobre nome, categoria e arquivo", () => {
    const lista = [
      model({ file: "t-90m.glb", label: "T-90m", category: "blindado" }),
      model({ file: "ka-52_alligator.glb", label: "Ka-52 Alligator", category: "helicoptero" }),
      model({ file: "mq-1_predator_uav.glb", label: "Mq-1 Predator UAV", category: "drone" }),
    ];
    expect(filterLocalModels(lista, "t-90").map((m) => m.file)).toEqual(["t-90m.glb"]);
    expect(filterLocalModels(lista, "helicoptero")).toHaveLength(1);
    expect(filterLocalModels(lista, "alligator")).toHaveLength(1);
    // Sem consulta devolve tudo, e a mesma referência de lista.
    expect(filterLocalModels(lista, "")).toBe(lista);
    expect(filterLocalModels(lista, "   ")).toBe(lista);
    expect(filterLocalModels(lista, "porta-aviões")).toEqual([]);
  });

  it("busca ignora caixa", () => {
    const lista = [model({ label: "Ka-52 Alligator" })];
    expect(filterLocalModels(lista, "KA-52")).toHaveLength(1);
    expect(filterLocalModels(lista, "ka-52")).toHaveLength(1);
  });

  it("agrupa por categoria preservando a ordem de entrada", () => {
    const lista = [
      model({ file: "a.glb", category: "aviao" }),
      model({ file: "b.glb", category: "blindado" }),
      model({ file: "c.glb", category: "aviao" }),
    ];
    const grupos = groupLocalModels(lista);
    expect(grupos.map(([categoria]) => categoria)).toEqual(["aviao", "blindado"]);
    expect(grupos[0]?.[1].map((m) => m.file)).toEqual(["a.glb", "c.glb"]);
  });

  it("importar passa pelo mesmo caminho de arquivo arrastado", async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200 })),
    );
    const importFiles = vi.fn(async (_files: readonly File[]) => undefined);

    const result = await importLocalModel(model(), importFiles);

    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(4);
    // Um `File` com o nome e o MIME certos: daqui para frente é o AssetStore que
    // calcula hash, gera thumbnail e registra — não há caminho paralelo.
    expect(importFiles).toHaveBeenCalledTimes(1);
    const files = importFiles.mock.calls[0]?.[0] ?? [];
    expect(files[0]?.name).toBe("t-90m.glb");
    expect(files[0]?.type).toBe("model/gltf-binary");
    vi.unstubAllGlobals();
  });

  it("gltf de texto recebe o MIME de texto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })),
    );
    const importFiles = vi.fn(async (_files: readonly File[]) => undefined);
    await importLocalModel(model({ file: "cena.gltf" }), importFiles);
    const files = importFiles.mock.calls[0]?.[0] ?? [];
    expect(files[0]?.type).toBe("model/gltf+json");
    vi.unstubAllGlobals();
  });

  it("arquivo ausente não importa nada, e diz por quê", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const importFiles = vi.fn(async (_files: readonly File[]) => undefined);

    const result = await importLocalModel(model(), importFiles);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("404");
    // Nada de import a meio caminho: o projeto não muda.
    expect(importFiles).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("falha de rede vira mensagem, não exceção que derruba o painel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("protocolo indisponível");
      }),
    );
    const importFiles = vi.fn(async (_files: readonly File[]) => undefined);

    const result = await importLocalModel(model(), importFiles);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("protocolo indisponível");
    vi.unstubAllGlobals();
  });

  it("nome de arquivo com espaço e parêntese é escapado na URL", async () => {
    const spy = vi.fn(async (_url: string) => new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await importLocalModel(model({ file: "su-25_grach (1).glb" }), async () => undefined);
    // Sem escapar, o parêntese e o espaço quebrariam a requisição do protocolo.
    expect(spy.mock.calls[0]?.[0] ?? "").toContain("su-25_grach%20(1).glb");
    vi.unstubAllGlobals();
  });
});
