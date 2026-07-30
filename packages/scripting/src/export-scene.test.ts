import { describe, expect, it } from "vitest";
import { createEmptyProjectDocument } from "@theatrum/schema";
import { compileScene } from "./compiler.js";
import { exportDocumentToSceneScript } from "./export-scene.js";

const SOURCE = {
  format: "theatrum-scene",
  version: 1,
  meta: {
    title: "Exportação parcial",
    fps: 60,
    resolution: "1920x1080",
    duration: "10s",
  },
  timeline: [],
} as const;

describe("exportDocumentToSceneScript", () => {
  it("preserva a fonte compilada sem avisos", async () => {
    const compiled = await compileScene(SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(exportDocumentToSceneScript(compiled.document)).toEqual({
      scene: SOURCE,
      diagnostics: [],
    });
  });

  it("avisa quando um nó manual não cabe na exportação parcial", async () => {
    const compiled = await compileScene(SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const composition = compiled.document.compositions[0];
    expect(composition).toBeDefined();
    if (composition === undefined) return;
    const root = composition.nodes[composition.root];
    expect(root).toBeDefined();
    if (root === undefined) return;

    const manualId = "manual-node";
    composition.nodes[manualId] = {
      ...root,
      id: manualId,
      parent: composition.root,
      children: [],
      name: "Nó manual",
      props: {},
    };
    root.children.push(manualId);

    const exported = exportDocumentToSceneScript(compiled.document);
    expect(exported.scene).toEqual(SOURCE);
    expect(exported.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "unsupported-export",
        path: "/compositions/0",
      }),
    ]);
  });

  it("avisa quando conteúdo emitido foi editado", async () => {
    const compiled = await compileScene(SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const composition = compiled.document.compositions[0];
    expect(composition).toBeDefined();
    if (composition === undefined) return;
    composition.name = "Nome editado";

    expect(exportDocumentToSceneScript(compiled.document).diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "unsupported-export",
        path: "/compositions/0",
      }),
    ]);
  });

  it("exporta parcialmente um documento criado à mão", () => {
    const document = createEmptyProjectDocument({
      name: "Cena manual",
      compositionId: "cmp_manual",
      rootNodeId: "nd_root",
    });
    const composition = document.compositions[0];
    expect(composition).toBeDefined();
    if (composition === undefined) return;
    composition.name = "Cena manual";
    const root = composition.nodes[composition.root];
    expect(root).toBeDefined();
    if (root === undefined) return;

    document.paths["rota"] = {
      id: "rota",
      name: "Rota",
      space: "geo",
      vertices: [
        { point: [1, 2], inHandle: null, outHandle: null },
        { point: [3, 4], inHandle: null, outHandle: null },
      ],
      closed: false,
      interpolation: "linear",
      geodesic: true,
    };
    composition.markers.push({ frame: 12, label: "Marco", color: "#60a5faff" });
    composition.nodes["nd_unit"] = {
      ...structuredClone(root),
      id: "nd_unit",
      type: "unit.armor",
      name: "Blindado",
      parent: composition.root,
      children: [],
      anchor: { space: "geo", lngLat: [51.2, 26.5] },
      props: { sceneUnitId: "blindado-1" },
    };
    root.children.push("nd_unit");

    const exported = exportDocumentToSceneScript(document);
    expect(exported.scene).toMatchObject({
      meta: { title: "Cena manual" },
      paths: {
        rota: {
          through: [
            [1, 2],
            [3, 4],
          ],
          geodesic: true,
        },
      },
      units: [{ id: "blindado-1", kind: "armor", at: [51.2, 26.5] }],
      timeline: [{ at: "12f", do: "marker", label: "Marco" }],
    });
    expect(exported.diagnostics).toEqual([]);
  });
});
