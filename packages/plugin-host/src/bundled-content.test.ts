import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlagCatalog, parsePaletteCatalog, parsePresetCatalog } from "./content-catalog.js";
import { createUnitCatalog, parseUnitCatalog } from "./unit-catalog.js";

const contentRoot = resolve(import.meta.dirname, "../../../data/plugin-content");

describe("conteúdo empacotado", () => {
  it("entrega 150 unidades válidas em três eras e seis categorias", async () => {
    const text = await readFile(resolve(contentRoot, "unit-library.json"), "utf8");
    const parsed = parseUnitCatalog(JSON.parse(text) as unknown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));

    expect(parsed.value).toHaveLength(150);
    expect(new Set(parsed.value.map(({ era }) => era))).toEqual(new Set(["wwi", "wwii", "modern"]));
    expect(new Set(parsed.value.map(({ category }) => category))).toEqual(
      new Set(["armor", "infantry", "artillery", "air", "naval", "support"]),
    );
  });

  it("mantém cada referência ligada a um símbolo SVG e a um código APP-6", async () => {
    const [catalogText, spriteText] = await Promise.all([
      readFile(resolve(contentRoot, "unit-library.json"), "utf8"),
      readFile(resolve(contentRoot, "unit-sprites.svg"), "utf8"),
    ]);
    const parsed = parseUnitCatalog(JSON.parse(catalogText) as unknown);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));

    for (const unit of parsed.value) {
      expect(unit.app6).toMatch(/^S[A-Z-]{9}$/);
      expect(spriteText).toContain(`id="${unit.id}"`);
    }
  });

  it('prioriza T-34 ao buscar "tanque soviético 1943"', async () => {
    const text = await readFile(resolve(contentRoot, "unit-library.json"), "utf8");
    const parsed = parseUnitCatalog(JSON.parse(text) as unknown);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));

    const matches = createUnitCatalog(parsed.value).search("tanque soviético 1943", {
      limit: 5,
    });
    expect(matches[0]?.unit.name).toBe("T-34/76");
    expect(matches.every(({ unit }) => unit.nation === "União Soviética")).toBe(true);
  });

  it("inclui bandeiras, paletas e presets de cena/efeito", async () => {
    const [flagsSvg, flagsText, palettesText, presetsText] = await Promise.all([
      readFile(resolve(contentRoot, "flags.svg"), "utf8"),
      readFile(resolve(contentRoot, "flags.json"), "utf8"),
      readFile(resolve(contentRoot, "palettes.json"), "utf8"),
      readFile(resolve(contentRoot, "presets.json"), "utf8"),
    ]);
    const flags = parseFlagCatalog(JSON.parse(flagsText) as unknown);
    const palettes = parsePaletteCatalog(JSON.parse(palettesText) as unknown);
    if (!flags.ok) throw new Error(JSON.stringify(flags.error));
    if (!palettes.ok) throw new Error(JSON.stringify(palettes.error));
    const presets = parsePresetCatalog(JSON.parse(presetsText) as unknown, {
      paletteIds: palettes.value.map(({ id }) => id),
    });
    if (!presets.ok) throw new Error(JSON.stringify(presets.error));

    expect(flags.value).toHaveLength(15);
    expect(flagsSvg.match(/<symbol /g) ?? []).toHaveLength(15);
    for (const flag of flags.value) expect(flagsSvg).toContain(`id="${flag.id}"`);
    expect(palettes.value).toHaveLength(6);
    expect(presets.value.scenes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "hormuz-blockade" })]),
    );
    expect(presets.value.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "battle-smoke", params: { intensity: 0.72 } }),
      ]),
    );
  });
});
