/**
 * Busca de território por nome, sigla ou código.
 *
 * O gazetteer de `gazetteer.ts` responde "onde fica este lugar" e devolve um
 * ponto. Este catálogo responde outra pergunta: "qual feição da malha eu quero
 * desenhar", e devolve uma identidade que o `geo.region` guarda no documento.
 * São índices diferentes sobre dados diferentes, então são módulos diferentes —
 * mas a **normalização é a mesma**, senão "Ucrânia" acharia a cidade e não o
 * país, ou o contrário, dependendo de qual dos dois normalizasse acentos.
 *
 * A ordenação prefere, nesta ordem: casamento exato, prefixo, subpalavra. E
 * dentro do mesmo grau de casamento, país antes de estado — quem digita "Paraná"
 * quer o estado, mas quem digita "Brasil" quer o país, não o município homônimo.
 */

import { normalizePlaceQuery } from "./gazetteer.js";
import type { GeoFeature, GeoFeatureKind, GeoMesh } from "./geo-mesh.js";

export interface RegionHit {
  readonly id: string;
  readonly name: string;
  readonly kind: GeoFeatureKind;
  /** Código do país em ISO alpha-3, quando a feição tem um. */
  readonly country: string | undefined;
  /** Subtítulo pronto para a lista: "Estado · Brasil", "País · Europa". */
  readonly detail: string;
  /** Qualidade do casamento em `[0, 1]`. */
  readonly score: number;
}

export interface RegionCatalog {
  readonly size: number;
  search(query: string, limit?: number): readonly RegionHit[];
  byId(id: string): RegionHit | undefined;
}

interface IndexedRegion {
  readonly feature: GeoFeature;
  readonly hit: RegionHit;
  /** Chaves normalizadas para casamento exato e por prefixo. */
  readonly keys: readonly string[];
}

/** Peso base por tipo, aplicado quando o grau de casamento empata. */
const KIND_WEIGHT: Readonly<Record<GeoFeatureKind, number>> = Object.freeze({
  country: 1,
  state: 0.94,
  river: 0.9,
  road: 0.88,
});

function countryOf(feature: GeoFeature): string | undefined {
  return feature.props["ADM0_A3"] ?? feature.props["adm0_a3"] ?? feature.props["ISO_A3"];
}

function detailOf(feature: GeoFeature): string {
  const country = feature.props["admin"] ?? feature.props["NAME_LONG"];
  switch (feature.kind) {
    case "country": {
      const continent = feature.props["CONTINENT"] ?? feature.props["REGION_UN"];
      return continent === undefined ? "País" : `País · ${continent}`;
    }
    case "state": {
      const type = feature.props["type_en"];
      const label = type === undefined || type === "" ? "Estado" : type;
      return country === undefined ? label : `${label} · ${country}`;
    }
    case "river": {
      const klass = feature.props["featurecla"];
      return klass === undefined ? "Rio" : `Rio · ${klass}`;
    }
    case "road": {
      // A malha de estradas é por país (ADR-011); a rodovia não tem nome próprio.
      const continent = feature.props["CONTINENT"];
      return continent === undefined ? "Estradas" : `Estradas · ${continent}`;
    }
  }
}

function keysOf(feature: GeoFeature): readonly string[] {
  const raw = [
    feature.name,
    feature.props["NAME"],
    feature.props["NAME_LONG"],
    feature.props["name"],
    feature.props["name_en"],
    feature.props["ISO_A2"],
    feature.props["ISO_A3"],
    feature.props["ADM0_A3"],
    feature.props["iso_3166_2"],
  ];
  const keys = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const normalized = normalizePlaceQuery(value);
    if (normalized.length > 0) keys.add(normalized);
  }
  return [...keys];
}

/**
 * Monta o catálogo sobre uma ou mais malhas.
 *
 * Recebe malhas em vez de um arquivo porque `gis` é domínio: não lê disco. A
 * shell carrega, o catálogo indexa.
 */
export function createRegionCatalog(meshes: readonly GeoMesh[]): RegionCatalog {
  const indexed: IndexedRegion[] = [];
  const byId = new Map<string, IndexedRegion>();

  for (const mesh of meshes) {
    for (const feature of mesh.list()) {
      const hit: RegionHit = Object.freeze({
        id: feature.id,
        name: feature.name,
        kind: feature.kind,
        country: countryOf(feature),
        detail: detailOf(feature),
        score: 1,
      });
      const entry: IndexedRegion = { feature, hit, keys: keysOf(feature) };
      indexed.push(entry);
      // Primeira feição com o id ganha; duplicata em malhas diferentes é erro de
      // compilação, não algo para o runtime resolver em silêncio.
      if (!byId.has(feature.id)) byId.set(feature.id, entry);
    }
  }

  return {
    size: indexed.length,

    byId(id: string): RegionHit | undefined {
      return byId.get(id)?.hit;
    },

    search(query: string, limit = 20): readonly RegionHit[] {
      const normalized = normalizePlaceQuery(query);
      if (normalized.length === 0) return Object.freeze([]);

      const scored: RegionHit[] = [];
      for (const entry of indexed) {
        let best = 0;
        for (const key of entry.keys) {
          let grade = 0;
          if (key === normalized) grade = 1;
          else if (key.startsWith(normalized)) grade = 0.75;
          else if (key.includes(normalized)) grade = 0.5;
          if (grade > best) best = grade;
        }
        if (best === 0) continue;
        scored.push(
          Object.freeze({
            ...entry.hit,
            score: best * KIND_WEIGHT[entry.feature.kind],
          }),
        );
      }

      // Empate resolvido por nome, para que a lista não dance entre chamadas com
      // a mesma consulta — ordenação instável seria UI trêmula.
      scored.sort((a, b) =>
        b.score - a.score !== 0 ? b.score - a.score : a.name.localeCompare(b.name),
      );
      return Object.freeze(scored.slice(0, Math.max(0, limit)));
    },
  };
}
