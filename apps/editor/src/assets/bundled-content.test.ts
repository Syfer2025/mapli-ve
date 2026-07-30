import { afterEach, describe, expect, it, vi } from "vitest";
import type { EffectPresetDefinition, FlagDefinition } from "@theatrum/plugin-host";
import {
  effectPresetTargetIssue,
  loadBundledContent,
  materializeEffectPresetParams,
  materializeFlagSvg,
  paletteToProjectPalette,
  resetBundledContentForTest,
} from "./bundled-content.js";

const FLAG: FlagDefinition = {
  id: "modern.iran",
  name: "Irã · Era Moderna",
  era: "modern",
  nation: "Irã",
  svg: "plugin-content/flags.svg#modern.iran",
  tags: ["modern", "iran"],
};

const PRESET: EffectPresetDefinition = {
  id: "battle-smoke",
  name: "Fumaça de batalha",
  effect: "smoke",
  intensity: 0.72,
  params: { intensity: 0.72 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetBundledContentForTest();
});

describe("conteúdo empacotado do editor", () => {
  it("carrega e valida somente URLs locais", async () => {
    const bodies = new Map<string, unknown>([
      ["theatrum-data://local/plugin-content/flags.json", [FLAG]],
      [
        "theatrum-data://local/plugin-content/palettes.json",
        [{ id: "hormuz", name: "Hormuz", colors: ["#1f5268", "#b99c68"] }],
      ],
      [
        "theatrum-data://local/plugin-content/presets.json",
        {
          scenes: [
            {
              id: "hormuz",
              name: "Hormuz",
              mapStyle: "satellite-offline",
              palette: "hormuz",
              camera: { center: [56.3, 26.5], zoom: 7, pitch: 40, bearing: 0 },
            },
          ],
          effects: [PRESET],
        },
      ],
    ]);
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: bodies.has(url),
        json: () => Promise.resolve(bodies.get(url)),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadBundledContent();
    expect(loaded).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([...bodies.keys()]);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("theatrum-data://"))).toBe(
      true,
    );
  });

  it("materializa um símbolo como SVG autônomo sem referência externa", () => {
    const sprite = `<svg xmlns="http://www.w3.org/2000/svg">
      <symbol id="modern.iran" viewBox="0 0 72 48"><title>Irã</title><rect width="72" height="48"/></symbol>
    </svg>`;
    const svg = materializeFlagSvg(sprite, "modern.iran");
    expect(svg).toContain('viewBox="0 0 72 48"');
    expect(svg).toContain("<title>Irã</title>");
    expect(svg).not.toContain("<symbol");
    expect(materializeFlagSvg(sprite, "../iran")).toBeNull();
  });

  it("converte paleta e preserva wrappers animáveis ao aplicar preset", () => {
    expect(
      paletteToProjectPalette({
        id: "hormuz",
        name: "Hormuz",
        colors: ["#1f5268", "#b99c68"],
      }),
    ).toEqual({
      id: "hormuz",
      name: "Hormuz",
      colors: { "cor-01": "#1f5268", "cor-02": "#b99c68" },
    });

    const defaults = {
      intensity: { value: 1, keyframes: [], expression: null },
      lifetime: { value: 120, keyframes: [], expression: null },
    };
    expect(materializeEffectPresetParams(defaults, PRESET)).toEqual({
      intensity: { value: 0.72, keyframes: [], expression: null },
      lifetime: { value: 120, keyframes: [], expression: null },
    });
    expect(defaults.intensity.value).toBe(1);
  });

  it("só libera preset de efeito para seleção visual registrada", () => {
    expect(
      effectPresetTargetIssue({
        selected: false,
        isRoot: false,
        nodeTypeRegistered: false,
      }),
    ).toContain("Selecione");
    expect(
      effectPresetTargetIssue({
        selected: true,
        isRoot: true,
        nodeTypeRegistered: true,
        nodeCategory: "structure",
      }),
    ).toContain("estrutural");
    expect(
      effectPresetTargetIssue({
        selected: true,
        isRoot: false,
        nodeTypeRegistered: false,
      }),
    ).toContain("plugin ausente");
    expect(
      effectPresetTargetIssue({
        selected: true,
        isRoot: false,
        nodeTypeRegistered: true,
        nodeCategory: "shape",
      }),
    ).toBeNull();
  });
});
