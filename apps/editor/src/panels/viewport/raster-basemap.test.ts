/**
 * Provas da descoberta de satélite. O que importa: ausência de imagem é estado
 * normal, não erro, e a distinção entre PMTiles e pirâmide de tiles não pode
 * escorregar — os dois vão em campos diferentes da especificação de estilo, e
 * trocá-los dá um mapa cinza sem nada no console.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadRasterBasemaps,
  parseStyleChoice,
  rasterSourceUrl,
  type RasterBasemap,
} from "./raster-basemap.js";

function basemap(overrides: Partial<RasterBasemap> = {}): RasterBasemap {
  return {
    id: "esri",
    label: "Satélite",
    source: "world.pmtiles",
    tileSize: 256,
    minZoom: 0,
    maxZoom: 14,
    attribution: "local",
    ...overrides,
  };
}

describe("imagem de satélite local", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arquivo .pmtiles vira url com protocolo; pirâmide vira padrão de tiles", () => {
    const single = rasterSourceUrl(basemap());
    expect(single.kind).toBe("pmtiles");
    expect(single.url).toBe("pmtiles://theatrum-data://local/raster/world.pmtiles");

    const pyramid = rasterSourceUrl(basemap({ source: "esri/{z}/{x}/{y}.jpg" }));
    expect(pyramid.kind).toBe("tiles");
    expect(pyramid.url).toBe("theatrum-data://local/raster/esri/{z}/{x}/{y}.jpg");
  });

  it("a extensão é reconhecida sem depender de caixa", () => {
    expect(rasterSourceUrl(basemap({ source: "MUNDO.PMTILES" })).kind).toBe("pmtiles");
  });

  it("o manifesto pode informar a cobertura para o enquadramento", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: 1,
          basemaps: [
            {
              id: "hormuz",
              source: "sentinel/{z}/{x}/{y}.jpg",
              bounds: [54, 24.2, 58.8, 28.1],
            },
          ],
        }),
      }),
    );

    const [regional] = await loadRasterBasemaps();
    expect(regional?.bounds).toEqual([54, 24.2, 58.8, 28.1]);
  });

  it("o seletor distingue vetorial detalhado, satélite puro e satélite com rótulos", () => {
    expect(parseStyleChoice("dark-relief")).toEqual({
      kind: "vector",
      id: "dark-relief",
      labels: true,
    });
    expect(parseStyleChoice("sat:esri")).toEqual({
      kind: "satellite",
      id: "esri",
      labels: false,
    });
    expect(parseStyleChoice("sat+:esri")).toEqual({
      kind: "satellite",
      id: "esri",
      labels: true,
    });
    expect(parseStyleChoice("detail:iran-hormuz")).toEqual({
      kind: "detailed",
      id: "iran-hormuz",
      labels: true,
    });
  });

  it("id de imagem com dois-pontos no nome não confunde o prefixo", () => {
    // `sat+:` consome só o prefixo; o resto é o id, inteiro.
    expect(parseStyleChoice("sat+:a:b").id).toBe("a:b");
    expect(parseStyleChoice("sat:a:b").id).toBe("a:b");
  });
});
