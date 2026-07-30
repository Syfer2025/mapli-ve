import { describe, expect, it } from "vitest";
import {
  createUnitCatalog,
  missingUnitAssets,
  parseUnitCatalog,
  type UnitDefinition,
} from "./unit-catalog.js";

const T34: UnitDefinition = {
  id: "wwii.ussr.t34-76",
  name: "T-34/76",
  aliases: ["tanque médio soviético", "T34"],
  era: "wwii",
  nation: "União Soviética",
  nationAliases: ["URSS", "USSR", "Soviet"],
  category: "armor",
  serviceFrom: 1940,
  serviceTo: 1958,
  svg: "sprites/wwii.svg#t34-76",
  app6: "SFGPUC-----",
  tags: ["tank", "armor", "medium", "blindado"],
};

const PANTHER: UnitDefinition = {
  id: "wwii.germany.panther",
  name: "Panther Ausf. G",
  aliases: ["Panzer V"],
  era: "wwii",
  nation: "Alemanha",
  nationAliases: ["Germany", "German"],
  category: "armor",
  serviceFrom: 1943,
  serviceTo: 1945,
  svg: "sprites/wwii.svg#panther",
  tags: ["tank", "armor", "medium"],
};

describe("unit catalog", () => {
  it('encontra "tanque soviético 1943" com acento, sinônimos e faixa histórica', () => {
    const catalog = createUnitCatalog([PANTHER, T34]);
    const matches = catalog.search("tanque soviético 1943");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.unit.id).toBe(T34.id);
    expect(matches[0]?.score).toBeGreaterThan(20);
  });

  it("filtra por era, nação e categoria e limita resultados", () => {
    const catalog = createUnitCatalog([T34, PANTHER]);
    expect(
      catalog.search("", { era: "wwii", nation: "alemanha", category: "armor", limit: 1 }),
    ).toMatchObject([{ unit: { id: PANTHER.id } }]);
  });

  it("carrega unidade somente por JSON e caminho SVG", () => {
    const result = parseUnitCatalog([T34]);
    expect(result).toEqual({ ok: true, value: [T34] });
  });

  it("relata todos os campos inválidos e IDs duplicados", () => {
    const result = parseUnitCatalog([
      T34,
      T34,
      { ...PANTHER, serviceFrom: 1946, serviceTo: 1945, svg: "../panther.png" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("fixture inválido");
    expect(result.error.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["/1/id", "/2/serviceTo", "/2/svg"]),
    );
  });

  it("valida assets de sprite sem repetir o mesmo arquivo", async () => {
    const exists = async (path: string): Promise<boolean> => path.includes("wwii.svg");
    await expect(missingUnitAssets([T34, PANTHER], exists)).resolves.toEqual([]);
    await expect(
      missingUnitAssets([{ ...T34, svg: "sprites/missing.svg#tank" }], exists),
    ).resolves.toEqual(["sprites/missing.svg"]);
  });
});
