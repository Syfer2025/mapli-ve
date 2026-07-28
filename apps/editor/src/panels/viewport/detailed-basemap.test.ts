import { afterEach, describe, expect, it, vi } from "vitest";

const ENTRY = {
  id: "iran-hormuz",
  label: "Detalhado · Irã e Estreito de Hormuz",
  source: "iran-hormuz.pmtiles",
  bounds: [43, 22, 65, 41] as const,
  focusBounds: [55.6, 25.3, 57.7, 27.8] as const,
  minZoom: 0,
  maxZoom: 15,
  attribution: "Protomaps © OpenStreetMap contributors",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("pacotes vetoriais regionais", () => {
  it("só publica uma entrada quando o PMTiles existe", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 1, basemaps: [ENTRY] }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const module = await import("./detailed-basemap.js");
    const found = await module.loadDetailedBasemaps();

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "iran-hormuz", maxZoom: 15 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "theatrum-data://local/basemap/iran-hormuz.pmtiles",
      { method: "HEAD" },
    );
    expect(module.detailedBasemapById("iran-hormuz")).toBe(found[0]);
  });

  it("arquivo ausente é um estado normal e esconde a opção", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 1, basemaps: [ENTRY] }) })
        .mockResolvedValueOnce({ ok: false }),
    );

    const module = await import("./detailed-basemap.js");
    await expect(module.loadDetailedBasemaps()).resolves.toEqual([]);
  });

  it("recusa caminhos e limites inválidos vindos do manifesto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: 1,
          basemaps: [
            { ...ENTRY, source: "../fora.pmtiles" },
            { ...ENTRY, id: "mundo", bounds: [80, 22, 65, 41] },
          ],
        }),
      }),
    );

    const module = await import("./detailed-basemap.js");
    await expect(module.loadDetailedBasemaps()).resolves.toEqual([]);
  });

  it("monta a URL PMTiles inteiramente local", async () => {
    const module = await import("./detailed-basemap.js");
    expect(module.detailedBasemapSourceUrl(ENTRY)).toBe(
      "pmtiles://theatrum-data://local/basemap/iran-hormuz.pmtiles",
    );
  });
});
