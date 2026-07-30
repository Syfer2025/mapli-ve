import { describe, expect, it } from "vitest";
import { parseFlagCatalog, parsePaletteCatalog, parsePresetCatalog } from "./content-catalog.js";

const PALETTES = [{ id: "hormuz", name: "Estreito de Hormuz", colors: ["#1f5268", "#b99c68"] }];

describe("catálogos de conteúdo empacotado", () => {
  it("valida bandeiras locais, paletas e presets com referências cruzadas", () => {
    const flags = parseFlagCatalog([
      {
        id: "modern.iran",
        name: "Irã · Era Moderna",
        era: "modern",
        nation: "Irã",
        svg: "plugin-content/flags.svg#modern.iran",
        tags: ["modern", "iran"],
      },
    ]);
    const palettes = parsePaletteCatalog(PALETTES);
    const presets = parsePresetCatalog(
      {
        scenes: [
          {
            id: "hormuz-blockade",
            name: "Bloqueio no Estreito de Hormuz",
            mapStyle: "satellite-offline",
            palette: "hormuz",
            camera: { center: [56.3, 26.5], zoom: 7.2, pitch: 42, bearing: -18 },
          },
        ],
        effects: [
          {
            id: "battle-smoke",
            name: "Fumaça de batalha",
            effect: "smoke",
            intensity: 0.72,
            params: { intensity: 0.72 },
          },
        ],
      },
      { paletteIds: ["hormuz"] },
    );

    expect(flags).toMatchObject({ ok: true });
    expect(palettes).toMatchObject({ ok: true });
    expect(presets).toMatchObject({ ok: true });
  });

  it("rejeita URL remota, cor inválida, duplicata e paleta de cena ausente", () => {
    const flags = parseFlagCatalog([
      {
        id: "modern.iran",
        name: "Irã",
        era: "modern",
        nation: "Irã",
        svg: "https://example.com/flag.svg#modern.iran",
        tags: [],
      },
    ]);
    expect(flags.ok).toBe(false);
    if (!flags.ok) expect(flags.error[0]?.path).toBe("/0/svg");

    const palettes = parsePaletteCatalog([
      ...PALETTES,
      ...PALETTES,
      { id: "invalida", name: "Inválida", colors: ["azul", "#ffffff"] },
    ]);
    expect(palettes.ok).toBe(false);
    if (!palettes.ok) {
      expect(palettes.error.map(({ path }) => path)).toEqual(
        expect.arrayContaining(["/1/id", "/2/colors/0"]),
      );
    }

    const presets = parsePresetCatalog(
      {
        scenes: [
          {
            id: "cena",
            name: "Cena",
            mapStyle: "minimal-political",
            palette: "nao-existe",
            camera: { center: [0, 0], zoom: 4, pitch: 0, bearing: 0 },
          },
        ],
        effects: [],
      },
      { paletteIds: ["hormuz"] },
    );
    expect(presets.ok).toBe(false);
    if (!presets.ok) expect(presets.error[0]?.path).toBe("/scenes/0/palette");
  });
});
