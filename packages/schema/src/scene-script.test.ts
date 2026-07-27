import { describe, expect, it } from "vitest";
import {
  SceneScriptSchema,
  SceneTimeSchema,
  SceneTimelineEntrySchema,
  VERB_CATALOG,
  parseSceneScript,
} from "./index.js";

describe("Scene Script v1", () => {
  it("valida uma cena declarativa representativa", () => {
    const scene = {
      format: "theatrum-scene",
      version: 1,
      meta: {
        title: "Varsóvia a Leningrado",
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
        allies: { color: "#2c5f8d", label: "Aliados" },
      },
      places: {
        warsaw: "Warsaw, PL",
        leningrad: [30.3351, 59.9343],
      },
      paths: {
        advance: {
          through: ["warsaw", "leningrad"],
          smooth: true,
          geodesic: false,
        },
      },
      units: [
        {
          id: "army-north",
          kind: "armor",
          faction: "allies",
          at: "warsaw",
          label: "Grupo Norte",
        },
      ],
      timeline: [
        {
          at: "0s",
          do: "camera.focus",
          on: "warsaw",
          zoom: 6,
          duration: "3s",
        },
        {
          at: "3s",
          do: "unit.advance",
          unit: "army-north",
          along: "advance",
          duration: "20s",
          trail: true,
        },
        {
          at: "after:intro+2s",
          id: "title",
          do: "text.title",
          text: "Operação",
          duration: "5s",
        },
      ],
    };

    expect(SceneScriptSchema.parse(scene)).toEqual(scene);
  });

  it.each(["4s", "0.5s", "500ms", "90f", "1m30s", "1:30", "00:01:30:15"])(
    "aceita tempo absoluto %s",
    (value) => {
      expect(SceneTimeSchema.parse(value)).toBe(value);
    },
  );

  it.each(["after:intro", "after:intro+2s", "with:intro", "end-4s"])(
    "aceita tempo relativo %s",
    (value) => {
      expect(SceneTimeSchema.parse(value)).toBe(value);
    },
  );

  it("rejeita campo desconhecido em vez de ignorar erro de autoria", () => {
    const result = SceneTimelineEntrySchema.safeParse({
      at: "0s",
      do: "camera.reset",
      duration: "1s",
      durration: "2s",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("durration");
    }
  });

  it("falha com orientação clara para Scene Script futuro", () => {
    expect(() =>
      parseSceneScript({
        format: "theatrum-scene",
        version: 99,
        meta: {
          title: "Futuro",
          fps: 60,
          resolution: "1920x1080",
          duration: "1s",
        },
        timeline: [],
      }),
    ).toThrow("version 99, mas esta versão do Theatrum suporta até 1");
  });

  it("mantém catálogo sem duplicatas e com exemplo válido para cada verbo", () => {
    const names = VERB_CATALOG.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(43);

    for (const entry of VERB_CATALOG) {
      const result = SceneTimelineEntrySchema.safeParse(entry.example);
      expect(result.success, `${entry.name}: ${result.error?.message ?? ""}`).toBe(true);
    }
  });
});
