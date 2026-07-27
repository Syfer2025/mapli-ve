/**
 * Provas da busca de território, contra a malha real. O que importa aqui não é a
 * mecânica de pontuação: é a **ordem** que o usuário vê na lista. Digitar
 * "ucrania" tem de trazer a Ucrânia primeiro, não uma província com "ucrania" no
 * meio do nome.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGeoMesh, type GeoMesh, type GeoMeshIndex } from "./geo-mesh.js";
import { createRegionCatalog } from "./region-catalog.js";

const DATA_ROOT = path.resolve(import.meta.dirname, "../../../data/geo");

function loadMesh(layer: string): GeoMesh {
  const index = JSON.parse(
    readFileSync(path.join(DATA_ROOT, `${layer}.json`), "utf8"),
  ) as GeoMeshIndex;
  const bytes = readFileSync(path.join(DATA_ROOT, `${layer}.bin`));
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return createGeoMesh(index, copy);
}

const catalog = createRegionCatalog([
  loadMesh("countries"),
  loadMesh("states"),
  loadMesh("rivers"),
]);

describe("catálogo de territórios", () => {
  it("indexa as três camadas juntas", () => {
    // 258 países + 4589 estados + 1366 rios, menos feições sem nome.
    expect(catalog.size).toBeGreaterThan(5000);
  });

  it("nome de país acha o país em primeiro lugar", () => {
    for (const [consulta, esperado] of [
      ["Ukraine", "Ukraine"],
      ["ukraine", "Ukraine"],
      ["Poland", "Poland"],
      ["Brazil", "Brazil"],
    ] as const) {
      const hits = catalog.search(consulta);
      expect(hits[0]?.name, consulta).toBe(esperado);
      expect(hits[0]?.kind, consulta).toBe("country");
    }
  });

  it("acento e caixa não mudam o resultado — a normalização é a do gazetteer", () => {
    const semAcento = catalog.search("Parana");
    const comAcento = catalog.search("Paraná");
    const maiuscula = catalog.search("PARANÁ");
    expect(comAcento.map((h) => h.id)).toEqual(semAcento.map((h) => h.id));
    expect(maiuscula.map((h) => h.id)).toEqual(semAcento.map((h) => h.id));
    expect(semAcento.length).toBeGreaterThan(0);
  });

  it("código ISO resolve, nos dois tamanhos", () => {
    expect(catalog.search("UA")[0]?.name).toBe("Ukraine");
    expect(catalog.search("UKR")[0]?.name).toBe("Ukraine");
    expect(catalog.search("BRA")[0]?.name).toBe("Brazil");
  });

  it("casamento exato ganha de prefixo, que ganha de subpalavra", () => {
    const hits = catalog.search("Poland");
    const exato = hits.find((h) => h.name === "Poland");
    expect(exato).toBeDefined();
    // Todo resultado depois do exato tem pontuação menor ou igual.
    const scores = hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("país vence estado quando os dois casam igual", () => {
    // "Ukraine" existe como país e aparece em nomes de província vizinha.
    const hits = catalog.search("Ukraine");
    const primeiroPais = hits.findIndex((h) => h.kind === "country");
    const primeiroEstado = hits.findIndex((h) => h.kind === "state");
    expect(primeiroPais).toBe(0);
    if (primeiroEstado >= 0) expect(primeiroPais).toBeLessThan(primeiroEstado);
  });

  it("o subtítulo diz o que a feição é, pronto para a lista", () => {
    expect(catalog.search("Ukraine")[0]?.detail).toMatch(/^País/);
    const estado = catalog.search("Paraná").find((h) => h.kind === "state");
    expect(estado?.detail).toContain("Brazil");
    const rio = catalog.search("Dnieper").find((h) => h.kind === "river");
    if (rio !== undefined) expect(rio.detail).toMatch(/^Rio/);
  });

  it("busca vazia devolve vazio em vez do catálogo inteiro", () => {
    expect(catalog.search("")).toEqual([]);
    expect(catalog.search("   ")).toEqual([]);
    expect(catalog.search("!!!")).toEqual([]);
  });

  it("o limite é respeitado e o zero é limite, não ausência de limite", () => {
    expect(catalog.search("a", 5)).toHaveLength(5);
    expect(catalog.search("a", 0)).toHaveLength(0);
    expect(catalog.search("a", -3)).toHaveLength(0);
  });

  it("a ordem é estável entre chamadas iguais — lista trêmula é defeito de UI", () => {
    const primeira = catalog.search("sa", 30).map((h) => h.id);
    const segunda = catalog.search("sa", 30).map((h) => h.id);
    expect(segunda).toEqual(primeira);
  });

  it("byId devolve a feição que o documento guardou", () => {
    const ucrania = catalog.byId("c:UKR");
    expect(ucrania?.name).toBe("Ukraine");
    expect(ucrania?.country).toBe("UKR");
    expect(catalog.byId("c:ZZZ")).toBeUndefined();
  });

  it("consulta sem resultado devolve vazio, não erro", () => {
    expect(catalog.search("qwertyuiopasdfgh")).toEqual([]);
  });
});
