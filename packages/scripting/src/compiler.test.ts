import type { GazetteerPort } from "@theatrum/gis";
import { validateDocument } from "@theatrum/document";
import type { SceneScript } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import {
  compileScene,
  exportDocumentToSceneScript,
  generateLlmAuthoringMarkdown,
  sceneVerbRegistry,
} from "./index.js";

const ALEXANDER: SceneScript = {
  format: "theatrum-scene",
  version: 1,
  meta: {
    title: "Alexandre: da Macedônia à Pérsia",
    fps: 60,
    resolution: "3840x2160",
    duration: "1m30s",
    background: "#0d1117",
  },
  map: {
    style: "historical-parchment",
    projection: "mercator",
    terrain: { enabled: true, exaggeration: 1.2 },
  },
  defaults: {
    unitSize: 56,
    textFont: "Cinzel",
    ease: "cinematic",
    labelPosition: "above",
  },
  factions: {
    macedon: { color: "#C9A227", label: "Macedônia" },
    persia: { color: "#8B2635", label: "Império Persa" },
  },
  places: {
    pella: "Pella, Greece",
    granicus: [27.2, 40.2],
    issus: [36.2, 36.85],
    tyre: "Tyre, Lebanon",
    gaugamela: [43.25, 36.36],
    babylon: [44.42, 32.54],
  },
  paths: {
    "marcha-anatolia": {
      through: ["pella", "granicus", "issus"],
      smooth: true,
    },
    "marcha-mesopotamia": {
      through: ["issus", "tyre", "gaugamela", "babylon"],
      smooth: true,
    },
  },
  units: [
    {
      id: "alexandre",
      kind: "infantry",
      faction: "macedon",
      at: "pella",
      label: "Alexandre — 35.000 homens",
      size: 64,
    },
    {
      id: "dario",
      kind: "infantry",
      faction: "persia",
      at: "gaugamela",
      label: "Dario III — 100.000",
    },
  ],
  timeline: [
    {
      at: "0s",
      do: "camera.focus",
      on: "pella",
      zoom: 5.5,
      duration: "3s",
      ease: "cinematic",
    },
    {
      at: "0.5s",
      do: "text.title",
      text: "334 a.C.",
      subtitle: "Alexandre cruza o Helesponto",
      position: "top-left",
      duration: "5s",
      reveal: "per-character",
    },
    {
      at: "3s",
      do: "camera.frame",
      on: ["pella", "issus"],
      padding: 0.2,
      duration: "4s",
    },
    {
      at: "4s",
      do: "unit.advance",
      unit: "alexandre",
      along: "marcha-anatolia",
      duration: "22s",
      ease: "linear",
      trail: true,
    },
    {
      at: "11s",
      do: "battle",
      at_place: "granicus",
      intensity: "medium",
      duration: "3s",
      label: "Batalha do Granico",
    },
    {
      at: "24s",
      do: "battle",
      at_place: "issus",
      intensity: "high",
      duration: "4s",
      label: "Issos — 333 a.C.",
    },
    { at: "30s", do: "camera.focus", on: "issus", zoom: 7, duration: "3s" },
    {
      at: "34s",
      do: "unit.advance",
      unit: "alexandre",
      along: "marcha-mesopotamia",
      duration: "30s",
      trail: true,
    },
    {
      at: "50s",
      do: "siege",
      at_place: "tyre",
      duration: "5s",
      label: "Cerco de Tiro",
    },
    {
      at: "66s",
      do: "battle",
      at_place: "gaugamela",
      intensity: "high",
      duration: "5s",
      label: "Gaugamela — 331 a.C.",
    },
    {
      at: "72s",
      do: "area.highlight",
      region: "persian-empire",
      faction: "macedon",
      duration: "8s",
      fade: "in",
    },
    {
      at: "74s",
      do: "text.caption",
      text: "O Império Persa cai sob domínio macedônio",
      position: "bottom-center",
      duration: "10s",
    },
    {
      at: "80s",
      do: "camera.frame",
      on: ["pella", "babylon"],
      padding: 0.15,
      duration: "6s",
    },
  ],
};

describe("compileScene", () => {
  it("compila Alexandre em uma animação válida de 1m30s e é determinístico", async () => {
    const first = await compileScene(ALEXANDER);
    const second = await compileScene(ALEXANDER);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.document).toEqual(second.document);
    expect(first.document.compositions[0]).toMatchObject({
      fps: 60,
      duration: 5_400,
      width: 3_840,
      height: 2_160,
    });
    expect(Object.keys(first.document.paths)).toEqual(
      expect.arrayContaining(["marcha-anatolia", "marcha-mesopotamia"]),
    );
    expect(validateDocument(first.document).ok).toBe(true);
    expect(
      Object.values(first.document.compositions[0]?.nodes ?? {}).some(
        (node) => node.name === "Alexandre — 35.000 homens",
      ),
    ).toBe(true);
  });

  it("mantém IDs estáveis quando a ordem das chaves de paths muda", async () => {
    const base = {
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "Ordem canônica",
        fps: 60,
        resolution: "1920x1080",
        duration: "5s",
      },
      timeline: [],
    } as const;
    const zulu = {
      through: [
        [0, 0],
        [1, 1],
      ],
      visible: true,
    } as const;
    const alfa = {
      through: [
        [2, 2],
        [3, 3],
      ],
      visible: true,
    } as const;

    const first = await compileScene({ ...base, paths: { zulu, alfa } });
    const second = await compileScene({ ...base, paths: { alfa, zulu } });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.document).toEqual(second.document);
  });

  it("relata exatamente cinco erros independentes com pointers e didYouMean", async () => {
    const input = {
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "Cinco erros",
        fps: 60,
        resolution: "1920x1080",
        duration: "10s",
      },
      titel: "campo raiz errado",
      timeline: [
        { at: "0s", do: "camera.focs", on: [0, 0], duration: "1s" },
        { at: "1s", do: "camera.reset", durration: "1s" },
        { do: "marker", label: "sem tempo" },
      ],
    };
    const result = await compileScene(input);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(5);
    expect(result.diagnostics.map((entry) => entry.path).sort()).toEqual(
      [
        "/titel",
        "/timeline/0/do",
        "/timeline/1/durration",
        "/timeline/1/duration",
        "/timeline/2/at",
      ].sort(),
    );
    expect(
      result.diagnostics.find((entry) => entry.path === "/timeline/0/do")?.didYouMean,
    ).toContain("camera.focus");
    expect(
      result.diagnostics.find((entry) => entry.path === "/timeline/1/durration")?.didYouMean,
    ).toContain("duration");
  });

  it("rejeita lugar ambíguo e lista candidatos sem escolher o maior", async () => {
    const gazetteer: GazetteerPort = {
      async resolve() {
        return [
          {
            id: "a",
            name: "Springfield",
            country: "US",
            admin1: "Illinois",
            kind: "city",
            lngLat: [-89.64, 39.78],
            score: 1,
          },
          {
            id: "b",
            name: "Springfield",
            country: "US",
            admin1: "Missouri",
            kind: "city",
            lngLat: [-93.29, 37.21],
            score: 1,
          },
        ];
      },
      resolveExact() {
        return undefined;
      },
    };
    const result = await compileScene(
      {
        format: "theatrum-scene",
        version: 1,
        meta: {
          title: "Ambígua",
          fps: 60,
          resolution: "1920x1080",
          duration: "5s",
        },
        places: { city: "Springfield" },
        timeline: [{ at: "0s", do: "camera.focus", on: "city", duration: "1s" }],
      },
      { gazetteer },
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "place-ambiguous",
        path: "/places/city",
        didYouMean: ["Springfield, Illinois, US", "Springfield, Missouri, US"],
      }),
    );
  });

  it("aponta o campo exato quando um valor tem tipo inválido", async () => {
    const result = await compileScene({
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "Tipo inválido",
        fps: 60,
        resolution: "1920x1080",
        duration: "5s",
      },
      timeline: [
        {
          at: "0s",
          do: "camera.focus",
          on: [0, 0],
          zoom: "muito",
          duration: "1s",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "schema",
        path: "/timeline/0/zoom",
      }),
    );
  });

  it("avisa velocidade implausível sem ocultar a animação válida", async () => {
    const result = await compileScene({
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "Marcha impossível",
        fps: 60,
        resolution: "1920x1080",
        duration: "5s",
      },
      paths: {
        longa: {
          through: [
            [0, 0],
            [10, 0],
          ],
        },
      },
      units: [{ id: "u", kind: "infantry", at: [0, 0] }],
      timeline: [
        {
          at: "0s",
          do: "unit.advance",
          unit: "u",
          along: "longa",
          duration: "1s",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "implausible-speed",
        path: "/timeline/0/duration",
      }),
    );
  });

  it("avisa e preserva a fonte quando uma entrada começa após o fim", async () => {
    const result = await compileScene({
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "Entrada tardia",
        fps: 60,
        resolution: "1920x1080",
        duration: "5s",
      },
      timeline: [
        {
          at: "8s",
          do: "text.caption",
          text: "Depois do fim",
          duration: "1s",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "outside-duration",
        path: "/timeline/0/at",
      }),
    );
    if (!result.ok) return;
    expect(exportDocumentToSceneScript(result.document).scene?.timeline).toHaveLength(1);
  });

  it("rejeita movimentos contraditórios da mesma unidade", async () => {
    const result = await compileScene({
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "Sobreposição",
        fps: 60,
        resolution: "1920x1080",
        duration: "10s",
      },
      paths: {
        rota: {
          through: [
            [0, 0],
            [1, 1],
          ],
        },
      },
      units: [{ id: "u", kind: "armor", at: [0, 0] }],
      timeline: [
        { at: "0s", do: "unit.advance", unit: "u", along: "rota", duration: "5s" },
        { at: "3s", do: "unit.retreat", unit: "u", along: "rota", duration: "4s" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "contradictory-overlap",
        path: "/timeline/1/at",
      }),
    );
  });

  it("informa quando uma unidade declarada não é usada", async () => {
    const result = await compileScene({
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "Unidade ociosa",
        fps: 60,
        resolution: "1920x1080",
        duration: "5s",
      },
      units: [{ id: "reserva", kind: "infantry", at: [0, 0] }],
      timeline: [],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "info",
        code: "unused-unit",
        path: "/units/0",
      }),
    );
  });

  it("resolve 200 entradas em menos de 500 ms", async () => {
    const timeline = Array.from({ length: 200 }, (_, index) => ({
      at: `${index}f`,
      do: "marker" as const,
      label: `M${index}`,
    }));
    const started = Date.now();
    const result = await compileScene({
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "200 entradas",
        fps: 60,
        resolution: "1920x1080",
        duration: "10s",
      },
      timeline,
    });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it("exporta parcialmente uma cena compilada", async () => {
    const compiled = await compileScene(ALEXANDER);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const exported = exportDocumentToSceneScript(compiled.document);
    expect(exported.scene).toEqual(ALEXANDER);
    expect(exported.diagnostics.every((entry) => entry.severity === "warning")).toBe(true);
  });
});

describe("registry e guia gerado", () => {
  it("documenta todo verbo do registry e permanece determinístico", () => {
    const first = generateLlmAuthoringMarkdown();
    const second = generateLlmAuthoringMarkdown();

    expect(first).toBe(second);
    expect(sceneVerbRegistry.list()).toHaveLength(43);
    for (const verb of sceneVerbRegistry.list()) {
      expect(first).toContain(`#### \`${verb.name}\``);
    }
  });
});
