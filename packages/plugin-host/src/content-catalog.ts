import { ColorSchema } from "@theatrum/schema";
import { err, ok, type Result } from "@theatrum/core-utils";

export interface BundledContentDiagnostic {
  readonly path: string;
  readonly message: string;
}

export interface FlagDefinition {
  readonly id: string;
  readonly name: string;
  readonly era: string;
  readonly nation: string;
  readonly svg: string;
  readonly tags: readonly string[];
}

export interface PaletteDefinition {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly string[];
}

export interface ScenePresetDefinition {
  readonly id: string;
  readonly name: string;
  readonly mapStyle: string;
  readonly palette: string;
  readonly camera: {
    readonly center: readonly [number, number];
    readonly zoom: number;
    readonly pitch: number;
    readonly bearing: number;
  };
}

export interface EffectPresetDefinition {
  readonly id: string;
  readonly name: string;
  readonly effect: string;
  /**
   * Escala editorial de 0 a 1, usada na listagem. Os valores efetivamente
   * aplicados vivem em `params`, pois filtros como color-grade não têm uma prop
   * genérica chamada intensity.
   */
  readonly intensity: number;
  readonly params: Readonly<Record<string, number>>;
}

export interface PresetCatalog {
  readonly scenes: readonly ScenePresetDefinition[];
  readonly effects: readonly EffectPresetDefinition[];
}

const ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const SVG_REFERENCE_PATTERN = /^plugin-content\/[a-z0-9./-]+\.svg#[a-z][a-z0-9.-]*$/;

export function parseFlagCatalog(
  input: unknown,
): Result<readonly FlagDefinition[], readonly BundledContentDiagnostic[]> {
  if (!Array.isArray(input)) return err(rootListDiagnostic("bandeiras"));
  const diagnostics: BundledContentDiagnostic[] = [];
  const entries: FlagDefinition[] = [];
  const ids = new Set<string>();

  input.forEach((raw, index) => {
    const path = `/${index}`;
    if (!isRecord(raw)) {
      diagnostics.push({ path, message: "A bandeira deve ser um objeto." });
      return;
    }
    const before = diagnostics.length;
    const id = stringField(raw, "id", path, diagnostics);
    const name = stringField(raw, "name", path, diagnostics);
    const era = stringField(raw, "era", path, diagnostics);
    const nation = stringField(raw, "nation", path, diagnostics);
    const svg = stringField(raw, "svg", path, diagnostics);
    const tags = stringListField(raw, "tags", path, diagnostics);
    validateId(id, `${path}/id`, diagnostics);
    if (svg !== undefined && !SVG_REFERENCE_PATTERN.test(svg)) {
      diagnostics.push({
        path: `${path}/svg`,
        message: "svg deve apontar para um símbolo local em plugin-content/*.svg#id.",
      });
    }
    if (
      before !== diagnostics.length ||
      id === undefined ||
      name === undefined ||
      era === undefined ||
      nation === undefined ||
      svg === undefined ||
      tags === undefined
    ) {
      return;
    }
    if (ids.has(id)) {
      diagnostics.push({ path: `${path}/id`, message: `ID duplicado: "${id}".` });
      return;
    }
    ids.add(id);
    entries.push(
      Object.freeze({
        id,
        name,
        era,
        nation,
        svg,
        tags: Object.freeze([...tags]),
      }),
    );
  });

  return diagnostics.length > 0 ? err(Object.freeze(diagnostics)) : ok(Object.freeze(entries));
}

export function parsePaletteCatalog(
  input: unknown,
): Result<readonly PaletteDefinition[], readonly BundledContentDiagnostic[]> {
  if (!Array.isArray(input)) return err(rootListDiagnostic("paletas"));
  const diagnostics: BundledContentDiagnostic[] = [];
  const entries: PaletteDefinition[] = [];
  const ids = new Set<string>();

  input.forEach((raw, index) => {
    const path = `/${index}`;
    if (!isRecord(raw)) {
      diagnostics.push({ path, message: "A paleta deve ser um objeto." });
      return;
    }
    const before = diagnostics.length;
    const id = stringField(raw, "id", path, diagnostics);
    const name = stringField(raw, "name", path, diagnostics);
    const colors = colorListField(raw, "colors", path, diagnostics);
    validateId(id, `${path}/id`, diagnostics);
    if (
      before !== diagnostics.length ||
      id === undefined ||
      name === undefined ||
      colors === undefined
    ) {
      return;
    }
    if (ids.has(id)) {
      diagnostics.push({ path: `${path}/id`, message: `ID duplicado: "${id}".` });
      return;
    }
    ids.add(id);
    entries.push(Object.freeze({ id, name, colors: Object.freeze([...colors]) }));
  });

  return diagnostics.length > 0 ? err(Object.freeze(diagnostics)) : ok(Object.freeze(entries));
}

export function parsePresetCatalog(
  input: unknown,
  options: { readonly paletteIds?: readonly string[] } = {},
): Result<PresetCatalog, readonly BundledContentDiagnostic[]> {
  if (!isRecord(input)) {
    return err([{ path: "", message: "O catálogo de presets deve ser um objeto." }]);
  }
  const diagnostics: BundledContentDiagnostic[] = [];
  const scenes = parseScenePresets(input["scenes"], diagnostics, options.paletteIds);
  const effects = parseEffectPresets(input["effects"], diagnostics);
  if (diagnostics.length > 0) return err(Object.freeze(diagnostics));
  return ok(Object.freeze({ scenes: Object.freeze(scenes), effects: Object.freeze(effects) }));
}

function parseScenePresets(
  input: unknown,
  diagnostics: BundledContentDiagnostic[],
  paletteIds: readonly string[] | undefined,
): ScenePresetDefinition[] {
  if (!Array.isArray(input)) {
    diagnostics.push({ path: "/scenes", message: "scenes deve ser uma lista." });
    return [];
  }
  const entries: ScenePresetDefinition[] = [];
  const ids = new Set<string>();
  const knownPalettes = paletteIds === undefined ? undefined : new Set(paletteIds);
  input.forEach((raw, index) => {
    const path = `/scenes/${index}`;
    if (!isRecord(raw)) {
      diagnostics.push({ path, message: "O preset de cena deve ser um objeto." });
      return;
    }
    const before = diagnostics.length;
    const id = stringField(raw, "id", path, diagnostics);
    const name = stringField(raw, "name", path, diagnostics);
    const mapStyle = stringField(raw, "mapStyle", path, diagnostics);
    const palette = stringField(raw, "palette", path, diagnostics);
    const camera = parseCamera(raw["camera"], `${path}/camera`, diagnostics);
    validateId(id, `${path}/id`, diagnostics);
    if (palette !== undefined && knownPalettes !== undefined && !knownPalettes.has(palette)) {
      diagnostics.push({
        path: `${path}/palette`,
        message: `Paleta não encontrada: "${palette}".`,
      });
    }
    if (
      before !== diagnostics.length ||
      id === undefined ||
      name === undefined ||
      mapStyle === undefined ||
      palette === undefined ||
      camera === undefined
    ) {
      return;
    }
    if (ids.has(id)) {
      diagnostics.push({ path: `${path}/id`, message: `ID duplicado: "${id}".` });
      return;
    }
    ids.add(id);
    entries.push(Object.freeze({ id, name, mapStyle, palette, camera }));
  });
  return entries;
}

function parseEffectPresets(
  input: unknown,
  diagnostics: BundledContentDiagnostic[],
): EffectPresetDefinition[] {
  if (!Array.isArray(input)) {
    diagnostics.push({ path: "/effects", message: "effects deve ser uma lista." });
    return [];
  }
  const entries: EffectPresetDefinition[] = [];
  const ids = new Set<string>();
  input.forEach((raw, index) => {
    const path = `/effects/${index}`;
    if (!isRecord(raw)) {
      diagnostics.push({ path, message: "O preset de efeito deve ser um objeto." });
      return;
    }
    const before = diagnostics.length;
    const id = stringField(raw, "id", path, diagnostics);
    const name = stringField(raw, "name", path, diagnostics);
    const effect = stringField(raw, "effect", path, diagnostics);
    const intensity = boundedNumberField(raw, "intensity", path, diagnostics, 0, 1);
    const params = numericRecordField(raw, "params", path, diagnostics);
    validateId(id, `${path}/id`, diagnostics);
    if (
      before !== diagnostics.length ||
      id === undefined ||
      name === undefined ||
      effect === undefined ||
      intensity === undefined ||
      params === undefined
    ) {
      return;
    }
    if (ids.has(id)) {
      diagnostics.push({ path: `${path}/id`, message: `ID duplicado: "${id}".` });
      return;
    }
    ids.add(id);
    entries.push(Object.freeze({ id, name, effect, intensity, params: Object.freeze(params) }));
  });
  return entries;
}

function parseCamera(
  raw: unknown,
  path: string,
  diagnostics: BundledContentDiagnostic[],
): ScenePresetDefinition["camera"] | undefined {
  if (!isRecord(raw)) {
    diagnostics.push({ path, message: "camera deve ser um objeto." });
    return undefined;
  }
  const before = diagnostics.length;
  const center = raw["center"];
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    typeof center[0] !== "number" ||
    !Number.isFinite(center[0]) ||
    center[0] < -180 ||
    center[0] > 180 ||
    typeof center[1] !== "number" ||
    !Number.isFinite(center[1]) ||
    center[1] < -90 ||
    center[1] > 90
  ) {
    diagnostics.push({
      path: `${path}/center`,
      message: "center deve ser [longitude, latitude] dentro dos limites geográficos.",
    });
  }
  const zoom = boundedNumberField(raw, "zoom", path, diagnostics, 0, 24);
  const pitch = boundedNumberField(raw, "pitch", path, diagnostics, 0, 85);
  const bearing = boundedNumberField(raw, "bearing", path, diagnostics, -360, 360);
  if (
    before !== diagnostics.length ||
    !Array.isArray(center) ||
    zoom === undefined ||
    pitch === undefined ||
    bearing === undefined
  ) {
    return undefined;
  }
  const tuple: readonly [number, number] = [center[0] as number, center[1] as number];
  return Object.freeze({
    center: Object.freeze(tuple),
    zoom,
    pitch,
    bearing,
  });
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BundledContentDiagnostic[],
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push({ path: `${path}/${key}`, message: `${key} deve ser uma string não vazia.` });
    return undefined;
  }
  return value.trim();
}

function stringListField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BundledContentDiagnostic[],
): readonly string[] | undefined {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    diagnostics.push({
      path: `${path}/${key}`,
      message: `${key} deve ser uma lista de strings não vazias.`,
    });
    return undefined;
  }
  return Object.freeze(value.map((entry) => (entry as string).trim()));
}

function colorListField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BundledContentDiagnostic[],
): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) {
    diagnostics.push({
      path: `${path}/${key}`,
      message: `${key} deve conter de 2 a 12 cores.`,
    });
    return undefined;
  }
  const colors: string[] = [];
  value.forEach((color, index) => {
    const parsed = ColorSchema.safeParse(color);
    if (!parsed.success) {
      diagnostics.push({
        path: `${path}/${key}/${index}`,
        message: "Cor inválida; use hexadecimal #RRGGBB ou #RRGGBBAA.",
      });
      return;
    }
    colors.push(parsed.data);
  });
  return colors.length === value.length ? Object.freeze(colors) : undefined;
}

function numericRecordField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BundledContentDiagnostic[],
): Record<string, number> | undefined {
  const value = record[key];
  if (!isRecord(value) || Object.keys(value).length === 0) {
    diagnostics.push({
      path: `${path}/${key}`,
      message: `${key} deve ser um objeto não vazio de números finitos.`,
    });
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [param, raw] of Object.entries(value)) {
    if (!ID_PATTERN.test(param) || typeof raw !== "number" || !Number.isFinite(raw)) {
      diagnostics.push({
        path: `${path}/${key}/${param}`,
        message: "Cada parâmetro deve ter nome seguro e valor numérico finito.",
      });
      continue;
    }
    result[param] = raw;
  }
  return Object.keys(result).length === Object.keys(value).length ? result : undefined;
}

function boundedNumberField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BundledContentDiagnostic[],
  min: number,
  max: number,
): number | undefined {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    diagnostics.push({
      path: `${path}/${key}`,
      message: `${key} deve ser um número entre ${min} e ${max}.`,
    });
    return undefined;
  }
  return value;
}

function validateId(
  id: string | undefined,
  path: string,
  diagnostics: BundledContentDiagnostic[],
): void {
  if (id !== undefined && !ID_PATTERN.test(id)) {
    diagnostics.push({
      path,
      message: "O ID deve usar letras minúsculas, números, pontos e hífens.",
    });
  }
}

function rootListDiagnostic(kind: string): readonly BundledContentDiagnostic[] {
  return Object.freeze([{ path: "", message: `O catálogo de ${kind} deve ser uma lista JSON.` }]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
