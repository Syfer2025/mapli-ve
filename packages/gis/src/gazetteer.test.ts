import { describe, expect, it } from "vitest";
import {
  classifyGazetteerHits,
  normalizePlaceQuery,
  OfflineGazetteer,
  resolvePlace,
} from "./gazetteer.js";
import type { GazetteerHit, GazetteerPlace, GazetteerPort } from "./types.js";

describe("OfflineGazetteer", () => {
  it('resolve exatamente "Kursk, RU"', async () => {
    const gazetteer = new OfflineGazetteer();
    const exact = gazetteer.resolveExact("Kursk, RU");
    expect(exact).toMatchObject({
      id: "place_kursk_ru",
      name: "Kursk",
      country: "RU",
      kind: "city",
      score: 1,
    });
    expect(exact?.lngLat[0]).toBeCloseTo(36.1874, 6);
    expect(await gazetteer.resolve("Kursk, RU")).toEqual([exact]);
  });

  it("aceita caixa, pontuação, código e nome alternativo do país", () => {
    const gazetteer = new OfflineGazetteer();
    expect(gazetteer.resolveExact("  KURSK — ru  ")?.id).toBe("place_kursk_ru");
    expect(gazetteer.resolveExact("Kursk, Russia")?.id).toBe("place_kursk_ru");
    expect(gazetteer.resolveExact("Курск, RUS")?.id).toBe("place_kursk_ru");
  });

  it('reporta "Springfield" como ambíguo', async () => {
    const gazetteer = new OfflineGazetteer();
    const hits = await gazetteer.resolve("Springfield");
    expect(hits).toHaveLength(4);
    expect(new Set(hits.map((hit) => hit.admin1))).toEqual(
      new Set(["Illinois", "Massachusetts", "Missouri", "Oregon"]),
    );
    expect(gazetteer.resolveExact("Springfield")).toBeUndefined();

    const resolution = gazetteer.resolveResult("Springfield");
    expect(resolution.status).toBe("ambiguous");
    if (resolution.status === "ambiguous") expect(resolution.hits).toHaveLength(4);
  });

  it("desambigua por estado, com ou sem país", () => {
    const gazetteer = new OfflineGazetteer();
    expect(gazetteer.resolveExact("Springfield, IL")?.admin1).toBe("Illinois");
    expect(gazetteer.resolveExact("Springfield, Missouri, USA")?.admin1).toBe("Missouri");
    expect(gazetteer.resolveResult("Springfield, OR").status).toBe("resolved");
    // País sozinho ainda deixa quatro candidatos legítimos.
    expect(gazetteer.resolveExact("Springfield, US")).toBeUndefined();
  });

  it("ordena empates deterministicamente sem mascarar ambiguidade", () => {
    const gazetteer = new OfflineGazetteer();
    const hits = gazetteer.search("Springfield");
    expect(hits.map((hit) => hit.admin1)).toEqual([
      "Missouri",
      "Massachusetts",
      "Illinois",
      "Oregon",
    ]);
    expect(classifyGazetteerHits("Springfield", [...hits].reverse()).status).toBe("ambiguous");
  });

  it("devolve not-found para consulta vazia ou desconhecida", () => {
    const gazetteer = new OfflineGazetteer();
    expect(gazetteer.search("   ")).toEqual([]);
    expect(gazetteer.resolveResult("Atlantis")).toEqual({
      status: "not-found",
      query: "Atlantis",
      hits: [],
    });
  });
});

describe("índice data-driven", () => {
  it("normaliza diacríticos e consulta por prefixos de tokens", () => {
    const places: readonly GazetteerPlace[] = [
      {
        id: "sao-paulo",
        name: "São Paulo",
        country: "BR",
        kind: "city",
        lngLat: [-46.6333, -23.5505],
        admin1: "São Paulo",
        countryAliases: ["Brasil"],
      },
    ];
    const gazetteer = new OfflineGazetteer(places);
    expect(normalizePlaceQuery(" SÃO—PAULO, Brasil ")).toBe("sao paulo brasil");
    expect(gazetteer.resolveExact("Sao Paulo, BR")?.id).toBe("sao-paulo");
    expect(gazetteer.search("sao pau bra")[0]?.id).toBe("sao-paulo");
  });

  it("tira um snapshot dos dados de entrada", () => {
    const mutable: GazetteerPlace[] = [
      {
        id: "original",
        name: "Original",
        country: "ZZ",
        kind: "town",
        lngLat: [1, 2],
        aliases: ["First"],
      },
    ];
    const gazetteer = new OfflineGazetteer(mutable);
    mutable[0] = {
      id: "changed",
      name: "Changed",
      country: "ZZ",
      kind: "town",
      lngLat: [9, 9],
    };
    expect(gazetteer.resolveExact("Original")?.lngLat).toEqual([1, 2]);
    expect(gazetteer.resolveExact("Changed")).toBeUndefined();
  });

  it("rejeita ids duplicados, nomes vazios e coordenadas inválidas", () => {
    const base: GazetteerPlace = {
      id: "same",
      name: "One",
      country: "ZZ",
      kind: "town",
      lngLat: [0, 0],
    };
    expect(() => new OfflineGazetteer([base, { ...base, name: "Two" }])).toThrow(/duplicate/);
    expect(() => new OfflineGazetteer([{ ...base, id: "empty", name: " — " }])).toThrow(
      /empty name/,
    );
    expect(() => new OfflineGazetteer([{ ...base, id: "invalid", lngLat: [NaN, 0] }])).toThrow(
      /invalid coordinates/,
    );
  });
});

describe("resolvePlace", () => {
  it("classifica pelo maior score mesmo se o port não ordenar os hits", async () => {
    const low: GazetteerHit = {
      id: "low",
      name: "Low",
      country: "ZZ",
      kind: "town",
      lngLat: [0, 0],
      score: 0.4,
    };
    const high: GazetteerHit = { ...low, id: "high", name: "High", score: 1 };
    const port: GazetteerPort = {
      async resolve() {
        return [low, high];
      },
      resolveExact() {
        return undefined;
      },
    };
    await expect(resolvePlace(port, "query")).resolves.toEqual({
      status: "resolved",
      query: "query",
      hit: high,
    });
  });
});
