import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitDefinition } from "@theatrum/plugin-host";
import {
  bundledUnitSvgUrl,
  loadBundledUnitCatalog,
  loadStandaloneBundledUnitSvg,
  materializeUnitSvg,
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

  it("materializa e carrega o símbolo como SVG autônomo incorporável", async () => {
    const sprite = `<svg xmlns="http://www.w3.org/2000/svg">
      <symbol id="wwii.ussr.t34-76" viewBox="0 0 96 64">
        <title>T-34/76</title><rect x="4" y="8" width="88" height="48"/>
      </symbol>
    </svg>`;
    expect(materializeUnitSvg(sprite, UNIT.id)).toContain("<title>T-34/76</title>");
    expect(materializeUnitSvg(sprite, "../escape")).toBeNull();

    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(sprite) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const svg = await loadStandaloneBundledUnitSvg(UNIT);

    expect(fetchMock).toHaveBeenCalledWith("theatrum-data://local/plugin-content/unit-sprites.svg");
    expect(svg).toContain('viewBox="0 0 96 64"');
    expect(svg).not.toContain("<symbol");
  });

  it("trata catálogo ausente como conteúdo opcional", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ausente"))),
    );
    await expect(loadBundledUnitCatalog()).resolves.toBeNull();
  });
});
