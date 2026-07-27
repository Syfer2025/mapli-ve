/**
 * Presets de efeito da Fase 6.
 *
 * Um preset é só um nome e um punhado de valores crus por parâmetro — nunca um
 * tipo novo. Aplicar um preset é trocar o `value` de parâmetros existentes, o
 * que significa que o preset não cria caminho de código: valida pelo mesmo
 * schema, anima pelos mesmos keyframes e desfaz pelo mesmo comando. Adicionar um
 * preset é uma entrada aqui, sem tocar em painel, registry ou GPU.
 */

export interface EffectPreset {
  readonly id: string;
  readonly label: string;
  /** Valores crus por parâmetro, sobre os defaults do efeito. */
  readonly values: Readonly<Record<string, number | string>>;
}

function preset(id: string, label: string, values: Record<string, number | string>): EffectPreset {
  return Object.freeze({ id, label, values: Object.freeze(values) });
}

export const EFFECT_PRESETS: Readonly<Record<string, readonly EffectPreset[]>> = Object.freeze({
  explosion: Object.freeze([
    preset("artillery-shell", "Granada de artilharia", {
      count: 900,
      scale: 0.55,
      lifetime: 30,
      intensity: 1,
    }),
    preset("aerial-bomb", "Bomba aérea", { count: 5000, scale: 1.6, lifetime: 52, intensity: 1.4 }),
    preset("muzzle-flash", "Clarão de canhão", {
      count: 260,
      scale: 0.3,
      lifetime: 12,
      intensity: 1.8,
      tint: "#ffe9b0ff",
    }),
  ]),
  smoke: Object.freeze([
    preset("city-fire", "Incêndio urbano", {
      count: 1400,
      scale: 1.3,
      lifetime: 210,
      intensity: 1.2,
      tint: "#3f3f3fff",
    }),
    preset("shell-dust", "Poeira de impacto", {
      count: 500,
      scale: 0.7,
      lifetime: 90,
      tint: "#9b8f7aff",
    }),
  ]),
  fire: Object.freeze([
    preset("building-blaze", "Edifício em chamas", {
      count: 2000,
      scale: 1.4,
      lifetime: 42,
      intensity: 1.3,
    }),
    preset("wreck-burn", "Destroço queimando", {
      count: 800,
      scale: 0.6,
      lifetime: 26,
      intensity: 0.9,
    }),
  ]),
  trail: Object.freeze([
    preset("rocket", "Foguete", { count: 900, scale: 0.8, lifetime: 46, tint: "#ffb27aff" }),
    preset("artillery-arc", "Trajetória de artilharia", {
      count: 500,
      scale: 0.5,
      lifetime: 80,
      tint: "#e8e2d5ff",
    }),
  ]),
  contrail: Object.freeze([
    preset("high-altitude", "Alta altitude", { count: 1600, lifetime: 420, scale: 1.2 }),
    preset("fighter-pass", "Passagem de caça", { count: 800, lifetime: 180, scale: 0.7 }),
  ]),
  shockwave: Object.freeze([
    preset("blast-ring", "Anel de explosão", { count: 480, scale: 1, lifetime: 22 }),
    preset("heavy-bomb", "Bomba pesada", { count: 720, scale: 1.8, lifetime: 30, intensity: 1.5 }),
  ]),
  sparks: Object.freeze([
    preset("flak-burst", "Rajada de flak", { count: 420, scale: 0.7, lifetime: 38 }),
    preset("impact", "Impacto metálico", {
      count: 200,
      scale: 0.4,
      lifetime: 24,
      tint: "#ffd166ff",
    }),
  ]),
  water: Object.freeze([
    preset("near-miss", "Bomba na água", { count: 1200, scale: 1.2, lifetime: 64 }),
    preset("bow-splash", "Proa em velocidade", { count: 500, scale: 0.6, lifetime: 40 }),
  ]),
  dust: Object.freeze([
    preset("column-advance", "Coluna em estrada", { count: 900, scale: 1.1, lifetime: 240 }),
    preset("desert-wind", "Vento de deserto", {
      count: 1400,
      scale: 1.6,
      lifetime: 260,
      tint: "#cdbfa4ff",
    }),
  ]),
  glow: Object.freeze([
    preset("map-highlight", "Destaque de mapa", { radius: 18, strength: 1.2, tint: "#7ec8ffff" }),
    preset("marker-hot", "Marcador quente", { radius: 10, strength: 2, tint: "#ff9f4aff" }),
  ]),
  blur: Object.freeze([
    preset("soft-focus", "Foco suave", { radius: 4, quality: 3 }),
    preset("depth", "Profundidade de campo", { radius: 14, quality: 5 }),
  ]),
  "drop-shadow": Object.freeze([
    preset("label-lift", "Rótulo elevado", {
      offsetX: 3,
      offsetY: 4,
      radius: 6,
      opacity: 0.6,
      tint: "#000000ff",
    }),
    preset("panel-depth", "Profundidade de painel", {
      offsetX: 8,
      offsetY: 10,
      radius: 14,
      opacity: 0.5,
    }),
  ]),
  "color-grade": Object.freeze([
    preset("archive-film", "Filme de arquivo", {
      exposure: -0.1,
      contrast: 0.25,
      saturation: -0.55,
      temperature: 0.15,
    }),
    preset("night-ops", "Operação noturna", {
      exposure: -0.35,
      contrast: 0.1,
      saturation: -0.3,
      temperature: -0.4,
    }),
    preset("desert-theater", "Teatro desértico", {
      exposure: 0.1,
      contrast: 0.15,
      saturation: 0.05,
      temperature: 0.45,
    }),
  ]),
  outline: Object.freeze([
    preset("unit-marker", "Marcador de unidade", { thickness: 2, tint: "#ffffffff" }),
    preset("selection-strong", "Seleção forte", { thickness: 3.5, tint: "#68b7ffff" }),
  ]),
  chromatic: Object.freeze([
    preset("impact-shiver", "Tremor de impacto", { offset: 3, angle: 0 }),
    preset("broadcast", "Transmissão antiga", { offset: 1.5, angle: 90 }),
  ]),
});

export function presetsFor(type: string): readonly EffectPreset[] {
  return EFFECT_PRESETS[type] ?? Object.freeze([]);
}
