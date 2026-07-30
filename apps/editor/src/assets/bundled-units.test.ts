import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitDefinition } from "@theatrum/plugin-host";
import {
  bundledUnitSvgUrl,
  loadBundledUnitCatalog,
  resetBundledUnitCatalogForTest,
} from "./bundled-units.js";

const UNIT: UnitDefinition = {
  id: "wwii.ussr.t34-76",
  name: "T-34/76",
  aliases: ["tanque soviético 1943"],
  era: "wwii",
  nation: "União Soviética",
  nationAliases: ["USSR", "URSS", "Soviet"],
  category: "armor",
  serviceFrom: 1940,
  serviceTo: 1945,
  svg: "plugin-content/unit-sprites.svg#wwii.ussr.t34-76",
  app6: "SFGPUCAM--",
  tags: ["tank", "armor"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetBundledUnitCatalogForTest();
});

describe("bundled units", () => {
  it("carrega, valida e pesquisa o catálogo offline", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([UNIT]) }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await loadBundledUnitCatalog();
    expect(fetchMock).toHaveBeenCalledWith(
      "theatrum-data://local/plugin-content/unit-library.json",
    );
    expect(catalog?.search("tanque soviético 1943")[0]?.unit.name).toBe("T-34/76");
    expect(catalog?.get(UNIT.id)).toBeDefined();
  });

  it("forma URL do símbolo dentro da origem de dados empacotada", () => {
    expect(bundledUnitSvgUrl(UNIT)).toBe(
      "theatrum-data://local/plugin-content/unit-sprites.svg#wwii.ussr.t34-76",
    );
  });

  it("trata catálogo ausente como conteúdo opcional", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("ausente"))));
    await expect(loadBundledUnitCatalog()).resolves.toBeNull();
  });
});
