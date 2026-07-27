import type { GazetteerPlace } from "./types.js";

/**
 * Fixture mínima embarcada na Fase 2.
 *
 * O índice é data-driven: uma futura importação do Natural Earth fornece a mesma
 * estrutura sem mudar o algoritmo. Os Springfields são intencionais para provar
 * que nomes ambíguos nunca são resolvidos por acaso.
 */
export const BUILTIN_GAZETTEER_PLACES: readonly GazetteerPlace[] = Object.freeze([
  Object.freeze({
    id: "place_kursk_ru",
    name: "Kursk",
    country: "RU",
    kind: "city",
    lngLat: Object.freeze([36.1874, 51.7304] as const),
    admin1: "Kursk Oblast",
    population: 440_052,
    aliases: Object.freeze(["Курск"]),
    countryAliases: Object.freeze(["Russia", "Russian Federation", "RUS"]),
  }),
  Object.freeze({
    id: "place_springfield_il_us",
    name: "Springfield",
    country: "US",
    kind: "city",
    lngLat: Object.freeze([-89.6501, 39.7817] as const),
    admin1: "Illinois",
    population: 114_394,
    countryAliases: Object.freeze(["United States", "United States of America", "USA"]),
    admin1Aliases: Object.freeze(["IL"]),
  }),
  Object.freeze({
    id: "place_springfield_ma_us",
    name: "Springfield",
    country: "US",
    kind: "city",
    lngLat: Object.freeze([-72.5898, 42.1015] as const),
    admin1: "Massachusetts",
    population: 155_929,
    countryAliases: Object.freeze(["United States", "United States of America", "USA"]),
    admin1Aliases: Object.freeze(["MA"]),
  }),
  Object.freeze({
    id: "place_springfield_mo_us",
    name: "Springfield",
    country: "US",
    kind: "city",
    lngLat: Object.freeze([-93.2923, 37.209] as const),
    admin1: "Missouri",
    population: 169_176,
    countryAliases: Object.freeze(["United States", "United States of America", "USA"]),
    admin1Aliases: Object.freeze(["MO"]),
  }),
  Object.freeze({
    id: "place_springfield_or_us",
    name: "Springfield",
    country: "US",
    kind: "city",
    lngLat: Object.freeze([-123.022, 44.0462] as const),
    admin1: "Oregon",
    population: 61_851,
    countryAliases: Object.freeze(["United States", "United States of America", "USA"]),
    admin1Aliases: Object.freeze(["OR"]),
  }),
]);
