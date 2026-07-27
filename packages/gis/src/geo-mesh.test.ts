/**
 * Provas do leitor de malha, contra a **malha real compilada** por
 * `tools/build-geo.ts` — não contra dados de brinquedo.
 *
 * A razão é direta: o valor deste leitor é ler corretamente o que aquele
 * compilador escreve. Um teste com buffer inventado provaria que os dois lados do
 * meu próprio entendimento concordam, o que não é prova de nada. Se a malha não
 * estiver compilada, o teste falha pedindo `pnpm geo:build` em vez de passar
 * vazio.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGeoMesh,
  GeoMeshError,
  GEO_MESH_FORMAT_VERSION,
  type GeoMesh,
  type GeoMeshIndex,
} from "./geo-mesh.js";

const DATA_ROOT = path.resolve(import.meta.dirname, "../../../data/geo");

function loadMesh(layer: string): GeoMesh {
  let index: GeoMeshIndex;
  let bytes: Buffer;
  try {
    index = JSON.parse(readFileSync(path.join(DATA_ROOT, `${layer}.json`), "utf8")) as GeoMeshIndex;
    bytes = readFileSync(path.join(DATA_ROOT, `${layer}.bin`));
  } catch {
    throw new Error(`Malha "${layer}" ausente em data/geo. Rode \`pnpm geo:build\`.`);
  }
  // `readFileSync` pode devolver uma fatia de um buffer maior do pool, e o tipo
  // do `.buffer` admite `SharedArrayBuffer` — copiar resolve os dois.
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return createGeoMesh(index, copy);
}

const countries = loadMesh("countries");

describe("leitor de malha geográfica", () => {
  it("abre a malha de países compilada e encontra feição por id", () => {
    expect(countries.layer).toBe("countries");
    expect(countries.featureCount).toBeGreaterThan(200);
    expect(countries.has("c:UKR")).toBe(true);
    expect(countries.has("c:ZZZ")).toBe(false);
  });

  it("a Ucrânia tem caixa envolvente e centro plausíveis", () => {
    const ukraine = countries.feature("c:UKR");
    expect(ukraine).toBeDefined();
    if (ukraine === undefined) return;
    expect(ukraine.name).toBe("Ukraine");
    expect(ukraine.kind).toBe("country");
    // A Ucrânia vai de ~22°E a ~40°E e de ~45°N a ~52,4°N.
    expect(ukraine.bounds.west).toBeGreaterThan(21);
    expect(ukraine.bounds.east).toBeLessThan(41);
    expect(ukraine.bounds.south).toBeGreaterThan(44);
    expect(ukraine.bounds.north).toBeLessThan(53);
    // Kiev fica a nordeste do centro geométrico, então o centro cai no país.
    expect(ukraine.center[0]).toBeGreaterThan(ukraine.bounds.west);
    expect(ukraine.center[0]).toBeLessThan(ukraine.bounds.east);
    expect(ukraine.props["ISO_A2"]).toBe("UA");
  });

  it("os níveis são aninhados: nível mais fino nunca perde vértice do grosseiro", () => {
    for (const id of ["c:UKR", "c:RUS", "c:BRA"]) {
      let previous = 0;
      for (let level = 0; level < countries.levelCount; level += 1) {
        const count = countries.vertexCountAt(id, level);
        expect(count, `${id} nível ${level}`).toBeGreaterThanOrEqual(previous);
        previous = count;
      }
      // A malha cheia é o último nível.
      const feature = countries.feature(id);
      expect(countries.vertexCountAt(id, countries.levelCount - 1)).toBe(feature?.vertexCount);
    }
  });

  it("simplificar corta trabalho de verdade, não só um pouco", () => {
    const cheia = countries.vertexCountAt("c:UKR", countries.levelCount - 1);
    const grosseira = countries.vertexCountAt("c:UKR", 0);
    // O nível mais grosseiro tem de ser uma fração pequena da malha cheia: é o
    // que paga o orçamento de frame do ADR-009.
    expect(grosseira / cheia).toBeLessThan(0.1);
    expect(grosseira).toBeGreaterThan(20);
  });

  it("percorre vértices sem alocar por vértice, e a contagem casa com o índice", () => {
    const nivel = 2;
    const esperado = countries.vertexCountAt("c:UKR", nivel);
    const aneis: number[] = [];
    let vertices = 0;
    let dentroDaCaixa = 0;
    const ukraine = countries.feature("c:UKR");

    countries.forEachVertex(
      "c:UKR",
      nivel,
      (_ringIndex, count) => aneis.push(count),
      (lng, lat) => {
        vertices += 1;
        if (
          ukraine !== undefined &&
          lng >= ukraine.bounds.west - 1e-6 &&
          lng <= ukraine.bounds.east + 1e-6 &&
          lat >= ukraine.bounds.south - 1e-6 &&
          lat <= ukraine.bounds.north + 1e-6
        ) {
          dentroDaCaixa += 1;
        }
      },
    );

    // Anéis com menos de três vértices são descartados, então a soma dos anéis
    // pode ficar abaixo do total do índice — nunca acima.
    expect(vertices).toBe(aneis.reduce((sum, count) => sum + count, 0));
    expect(vertices).toBeLessThanOrEqual(esperado);
    expect(vertices).toBeGreaterThan(esperado * 0.9);
    // Todo vértice cai dentro da caixa envolvente declarada.
    expect(dentroDaCaixa).toBe(vertices);
  });

  it("o nível vem do zoom, e é função pura — mesmo zoom, mesmo nível", () => {
    expect(countries.levelForZoom(0)).toBe(0);
    expect(countries.levelForZoom(2)).toBe(0);
    expect(countries.levelForZoom(6)).toBe(1);
    expect(countries.levelForZoom(8)).toBe(2);
    expect(countries.levelForZoom(10)).toBe(3);
    // Bem acima do último limiar entra a malha cheia.
    expect(countries.levelForZoom(16)).toBe(countries.levelCount - 1);
    // Monótono e estável.
    for (let zoom = 0; zoom <= 20; zoom += 0.5) {
      expect(countries.levelForZoom(zoom)).toBe(countries.levelForZoom(zoom));
      if (zoom > 0) {
        expect(countries.levelForZoom(zoom)).toBeGreaterThanOrEqual(
          countries.levelForZoom(zoom - 0.5),
        );
      }
    }
  });

  it("zoom absurdo não quebra: cai no nível cheio em vez de indexar fora", () => {
    for (const zoom of [Number.NaN, Number.POSITIVE_INFINITY, 999, -50]) {
      const level = countries.levelForZoom(zoom);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThan(countries.levelCount);
    }
    // Nível fora da faixa é preso à faixa, não lança.
    expect(countries.vertexCountAt("c:UKR", -3)).toBe(countries.vertexCountAt("c:UKR", 0));
    expect(countries.vertexCountAt("c:UKR", 99)).toBe(
      countries.vertexCountAt("c:UKR", countries.levelCount - 1),
    );
  });

  it("feição inexistente lança com código, em vez de desenhar vazio", () => {
    expect(() => countries.vertexCountAt("c:ZZZ", 0)).toThrowError(
      expect.objectContaining({ code: "unknown-feature" }),
    );
  });

  it("binário truncado é recusado: contorno plausível e errado é o pior defeito", () => {
    const index: GeoMeshIndex = {
      version: GEO_MESH_FORMAT_VERSION,
      layer: "teste",
      kind: "country",
      coordinateScale: 1e7,
      levelTolerances: [0.2],
      levelMinZoom: [0],
      vertexCount: 4,
      features: [],
    };
    // 4 vértices exigem 4×8 + 4 = 36 bytes.
    expect(() => createGeoMesh(index, new ArrayBuffer(36))).not.toThrow();
    expect(() => createGeoMesh(index, new ArrayBuffer(35))).toThrowError(GeoMeshError);
    expect(() => createGeoMesh(index, new ArrayBuffer(40))).toThrowError(
      expect.objectContaining({ code: "size" }),
    );
  });

  it("versão de formato diferente é recusada", () => {
    const index = {
      version: GEO_MESH_FORMAT_VERSION + 1,
      layer: "teste",
      kind: "country",
      coordinateScale: 1e7,
      levelTolerances: [0.2],
      levelMinZoom: [0],
      vertexCount: 0,
      features: [],
    } satisfies GeoMeshIndex;
    expect(() => createGeoMesh(index, new ArrayBuffer(0))).toThrowError(
      expect.objectContaining({ code: "version" }),
    );
  });

  it("as três camadas compiladas abrem e têm o tipo declarado", () => {
    for (const [layer, kind, minimo] of [
      ["countries", "country", 200],
      ["states", "state", 4000],
      ["rivers", "river", 1000],
    ] as const) {
      const mesh = loadMesh(layer);
      expect(mesh.featureCount, layer).toBeGreaterThan(minimo);
      expect(mesh.list()[0]?.kind, layer).toBe(kind);
    }
  });
});
