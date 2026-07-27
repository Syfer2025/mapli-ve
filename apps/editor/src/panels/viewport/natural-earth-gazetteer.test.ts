import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNaturalEarthGazetteer } from "./natural-earth-gazetteer.js";

const PLACES_URL = "theatrum-data://local/natural-earth/ne_10m_populated_places_simple.geojson";

function stubGeoJson(body: unknown, status = 200): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadNaturalEarthGazetteer", () => {
  it("busca somente o GeoJSON local e transforma features válidas", async () => {
    const fetchMock = stubGeoJson({
      type: "FeatureCollection",
      features: [
        {
          id: 42,
          geometry: { type: "Point", coordinates: [-46.6333, -23.5505] },
          properties: {
            NAME: "São Paulo",
            ISO_A2: "BR",
            ADM1NAME: "São Paulo",
            POP_MAX: 22_620_000,
            FEATURECLA: "Admin-1 capital",
            NE_ID: "sp",
          },
        },
        {
          geometry: { type: "LineString", coordinates: [] },
          properties: { NAME: "não deve entrar", ISO_A2: "BR" },
        },
        {
          geometry: { type: "Point", coordinates: [10, 20] },
          properties: { NAME: "-99", ISO_A2: "ZZ" },
        },
        {
          geometry: { type: "Point", coordinates: [11, 21] },
          properties: {
            name: "Aldeia",
            iso_a2: "PT",
            featurecla: "Village",
          },
        },
        {
          geometry: { type: "Point", coordinates: [12, 22] },
          properties: {
            NAME: "Vila",
            ISO_A2: "PT",
            FEATURECLA: "Town",
          },
        },
        {
          id: 7,
          geometry: { type: "Point", coordinates: [13, 23] },
          properties: { name: "Lugar sem país" },
        },
        {
          geometry: { type: "Point", coordinates: ["não", 23] },
          properties: { name: "coordenada inválida" },
        },
      ],
    });

    const gazetteer = await loadNaturalEarthGazetteer();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(PLACES_URL, {});
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toMatch(/(?:https?:\/\/|mapbox:\/\/|cdn\.)/i);

    expect(gazetteer.resolveExact("São Paulo, BR")).toMatchObject({
      id: "natural_earth_sp_0",
      name: "São Paulo",
      country: "BR",
      admin1: "São Paulo",
      population: 22_620_000,
      kind: "capital",
      lngLat: [-46.6333, -23.5505],
    });
    expect(gazetteer.resolveExact("Aldeia, PT")).toMatchObject({ kind: "village" });
    expect(gazetteer.resolveExact("Vila, PT")).toMatchObject({ kind: "town" });
    expect(gazetteer.resolveExact("Lugar sem país, —")).toMatchObject({
      id: "natural_earth_7_5",
      kind: "city",
      country: "—",
    });
    expect(gazetteer.resolveExact("não deve entrar")).toBeUndefined();
  });

  it("mantém a fixture essencial: Kursk resolve e Springfield é ambíguo", async () => {
    stubGeoJson({ type: "FeatureCollection", features: [] });
    const gazetteer = await loadNaturalEarthGazetteer();

    expect(gazetteer.resolveResult("Kursk, RU")).toMatchObject({
      status: "resolved",
      hit: { name: "Kursk", country: "RU" },
    });

    const springfield = gazetteer.resolveResult("Springfield");
    expect(springfield.status).toBe("ambiguous");
    if (springfield.status === "ambiguous") {
      expect(springfield.hits).toHaveLength(4);
      expect(new Set(springfield.hits.map((hit) => hit.admin1))).toEqual(
        new Set(["Illinois", "Massachusetts", "Missouri", "Oregon"]),
      );
    }
  });

  it("encaminha AbortSignal sem alterar a origem local", async () => {
    const fetchMock = stubGeoJson({ type: "FeatureCollection", features: [] });
    const controller = new AbortController();

    await loadNaturalEarthGazetteer(controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(PLACES_URL, {
      signal: controller.signal,
    });
  });

  it("reporta status HTTP local e payload inválido", async () => {
    stubGeoJson({ error: "offline" }, 503);
    await expect(loadNaturalEarthGazetteer()).rejects.toThrow("gazetteer local respondeu 503");

    vi.unstubAllGlobals();
    stubGeoJson({ type: "Feature", features: [] });
    await expect(loadNaturalEarthGazetteer()).rejects.toThrow(
      "gazetteer local não é um FeatureCollection",
    );
  });
});
