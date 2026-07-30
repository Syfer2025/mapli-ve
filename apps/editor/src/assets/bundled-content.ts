import { DATA_BASE_URL } from "@theatrum/shell";
import {
  parseFlagCatalog,
  parsePaletteCatalog,
  parsePresetCatalog,
  type EffectPresetDefinition,
  type FlagDefinition,
  type PaletteDefinition,
  type PresetCatalog,
} from "@theatrum/plugin-host";
import type { Palette } from "@theatrum/schema";

const CONTENT_BASE_URL = `${DATA_BASE_URL}/`;
const FLAGS_URL = `${DATA_BASE_URL}/plugin-content/flags.json`;
const PALETTES_URL = `${DATA_BASE_URL}/plugin-content/palettes.json`;
const PRESETS_URL = `${DATA_BASE_URL}/plugin-content/presets.json`;

export interface BundledContentCatalog {
  readonly flags: readonly FlagDefinition[];
  readonly palettes: readonly PaletteDefinition[];
  readonly presets: PresetCatalog;
}

export type BundledContentLoadResult =
  | { readonly ok: true; readonly value: BundledContentCatalog }
  | { readonly ok: false; readonly message: string };

let cached: Promise<BundledContentLoadResult> | undefined;
const flagSvgCache = new Map<string, Promise<string | null>>();

/**
 * Carrega somente pelo protocolo local registrado pelo aplicativo. Nenhuma URL
 * de rede entra no loader, inclusive para as miniaturas SVG.
 */
export function loadBundledContent(): Promise<BundledContentLoadResult> {
  cached ??= load();
  return cached;
}

export function bundledFlagSvgUrl(flag: FlagDefinition): string {
  return `${CONTENT_BASE_URL}${flag.svg}`;
}

export function loadStandaloneFlagSvg(flag: FlagDefinition): Promise<string | null> {
  const existing = flagSvgCache.get(flag.id);
  if (existing !== undefined) return existing;
  const [path] = flag.svg.split("#", 1);
  const url = `${CONTENT_BASE_URL}${path ?? ""}`;
  const pending = fetch(url)
    .then(async (response) =>
      response.ok ? materializeFlagSvg(await response.text(), flag.id) : null,
    )
    .catch(() => null);
  flagSvgCache.set(flag.id, pending);
  return pending;
}

/**
 * Extrai um `<symbol>` do sprite controlado pelo gerador e o transforma em SVG
 * autônomo. Assim ele atravessa o mesmo pipeline de assets incorporados e
 * continua visível depois de salvar/reabrir o projeto.
 */
export function materializeFlagSvg(sprite: string, id: string): string | null {
  if (!/^[a-z][a-z0-9.-]*$/.test(id)) return null;
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<symbol\\b([^>]*\\bid=["']${escapedId}["'][^>]*)>([\\s\\S]*?)<\\/symbol>`,
    "i",
  ).exec(sprite);
  if (match === null) return null;
  const attributes = match[1] ?? "";
  const content = match[2] ?? "";
  const viewBox = /\bviewBox=["']([^"']+)["']/i.exec(attributes)?.[1]?.trim() ?? "0 0 72 48";
  if (!/^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){3}$/.test(viewBox)) return null;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
    `width="720" height="480" role="img">${content}</svg>\n`
  );
}

export function paletteToProjectPalette(palette: PaletteDefinition): Palette {
  return {
    id: palette.id,
    name: palette.name,
    colors: Object.fromEntries(
      palette.colors.map((color, index) => [`cor-${String(index + 1).padStart(2, "0")}`, color]),
    ),
  };
}

/**
 * Mescla escalares do catálogo nos wrappers animáveis dos efeitos nativos. O
 * registry ainda valida o resultado antes de o painel enviar o comando.
 */
export function materializeEffectPresetParams(
  defaults: unknown,
  preset: EffectPresetDefinition,
): Record<string, unknown> | null {
  if (!isRecord(defaults)) return null;
  const params = structuredClone(defaults);
  for (const [key, value] of Object.entries(preset.params)) {
    const current = params[key];
    params[key] =
      isRecord(current) && Object.hasOwn(current, "value") ? { ...current, value } : value;
  }
  return params;
}

export function effectPresetTargetIssue(input: {
  readonly selected: boolean;
  readonly isRoot: boolean;
  readonly nodeTypeRegistered: boolean;
  readonly nodeCategory?: string;
}): string | null {
  if (!input.selected) return "Selecione um objeto visual para aplicar um preset de efeito.";
  if (input.isRoot || input.nodeCategory === "structure") {
    return "O item estrutural selecionado não recebe presets de efeito.";
  }
  if (!input.nodeTypeRegistered) {
    return "O nó selecionado depende de um plugin ausente; o preset não será aplicado.";
  }
  return null;
}

/** Só para testes e recarga de conteúdo em desenvolvimento. */
export function resetBundledContentForTest(): void {
  cached = undefined;
  flagSvgCache.clear();
}

async function load(): Promise<BundledContentLoadResult> {
  try {
    const [flagsResponse, palettesResponse, presetsResponse] = await Promise.all([
      fetch(FLAGS_URL),
      fetch(PALETTES_URL),
      fetch(PRESETS_URL),
    ]);
    if (!flagsResponse.ok || !palettesResponse.ok || !presetsResponse.ok) {
      return { ok: false, message: "Conteúdo empacotado não está disponível nesta instalação." };
    }
    const [flagsInput, palettesInput, presetsInput] = await Promise.all([
      flagsResponse.json() as Promise<unknown>,
      palettesResponse.json() as Promise<unknown>,
      presetsResponse.json() as Promise<unknown>,
    ]);
    const flags = parseFlagCatalog(flagsInput);
    if (!flags.ok) return invalidMessage("bandeiras", flags.error);
    const palettes = parsePaletteCatalog(palettesInput);
    if (!palettes.ok) return invalidMessage("paletas", palettes.error);
    const presets = parsePresetCatalog(presetsInput, {
      paletteIds: palettes.value.map(({ id }) => id),
    });
    if (!presets.ok) return invalidMessage("presets", presets.error);
    return {
      ok: true,
      value: Object.freeze({
        flags: flags.value,
        palettes: palettes.value,
        presets: presets.value,
      }),
    };
  } catch {
    return { ok: false, message: "Falha ao ler o conteúdo local empacotado." };
  }
}

function invalidMessage(
  label: string,
  diagnostics: readonly { readonly path: string; readonly message: string }[],
): BundledContentLoadResult {
  const first = diagnostics[0];
  return {
    ok: false,
    message:
      first === undefined
        ? `Catálogo de ${label} inválido.`
        : `Catálogo de ${label} inválido em ${first.path || "/"}: ${first.message}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
