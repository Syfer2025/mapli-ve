import { evaluate } from "@theatrum/animation";
import { createEmptyProjectDocument, type Composition } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import type { DetailedBasemap } from "./detailed-basemap.js";
import {
  DocumentCameraApplyGuard,
  documentMapStyleExportBlockReason,
  evaluatedDocumentMapCamera,
  resolveDocumentMapStyle,
  sameDocumentMapCamera,
} from "./map-document-state.js";
import type { RasterBasemap } from "./raster-basemap.js";

const detail: DetailedBasemap = {
  id: "hormuz",
  label: "Irã e Hormuz",
  source: "hormuz.pmtiles",
  bounds: [45, 20, 65, 35],
  focusBounds: [52, 23, 58, 28],
  minZoom: 0,
  maxZoom: 15,
  attribution: "teste",
};

const satellite: RasterBasemap = {
  id: "hormuz-sat",
  label: "Hormuz satélite",
  source: "sat.pmtiles",
  tileSize: 256,
  minZoom: 0,
  maxZoom: 14,
  attribution: "teste",
};

describe("vista do mapa derivada do documento", () => {
  it("resolve estilos canônicos, legados e pacotes locais presentes", () => {
    expect(resolveDocumentMapStyle("minimal-political", [], [])).toMatchObject({
      available: true,
      kind: "vector",
      styleId: "minimal-political",
      legacy: false,
    });
    expect(resolveDocumentMapStyle("strategic-war-room", [], [])).toMatchObject({
      available: true,
      kind: "vector",
      styleId: "strategic-war-room",
      legacy: false,
    });
    expect(resolveDocumentMapStyle("style_minimal_political", [], [])).toMatchObject({
      available: true,
      kind: "vector",
      styleId: "minimal-political",
      legacy: true,
    });
    expect(resolveDocumentMapStyle("detail:hormuz", [detail], [])).toMatchObject({
      available: true,
      kind: "detailed",
      basemap: detail,
    });
    expect(resolveDocumentMapStyle("sat+:hormuz-sat", [], [satellite])).toMatchObject({
      available: true,
      kind: "satellite",
      basemap: satellite,
      labels: true,
    });
  });

  it("faz fallback explícito sem reescrever o id persistido", () => {
    const resolved = resolveDocumentMapStyle("sat:arquivo-removido", [], []);
    expect(documentMapStyleExportBlockReason(resolved)).toContain("indisponível");
    expect(
      documentMapStyleExportBlockReason(resolveDocumentMapStyle("minimal-political", [], [])),
    ).toBeNull();
    expect(resolved).toEqual({
      available: false,
      kind: "fallback",
      documentStyleId: "sat:arquivo-removido",
      fallbackStyleId: "dark-relief",
      reason: "imagem de satélite “arquivo-removido” não encontrada",
    });
  });

  it("avalia a câmera animada exatamente no playhead, inclusive subframe", () => {
    const document = createEmptyProjectDocument();
    const composition = structuredClone(document.compositions[0]) as Composition;
    composition.camera.center.keyframes = [
      {
        id: "kf_center_0",
        frame: 0,
        value: [0, 20],
        in: { kind: "linear" },
        out: { kind: "linear" },
      },
      {
        id: "kf_center_1",
        frame: 10,
        value: [20, 40],
        in: { kind: "linear" },
        out: { kind: "linear" },
      },
    ];
    composition.camera.zoom.keyframes = [
      {
        id: "kf_zoom_0",
        frame: 0,
        value: 2,
        in: { kind: "linear" },
        out: { kind: "linear" },
      },
      {
        id: "kf_zoom_1",
        frame: 10,
        value: 4,
        in: { kind: "linear" },
        out: { kind: "linear" },
      },
    ];

    const evaluated = evaluatedDocumentMapCamera(composition, 2.5);
    expect(evaluated).toMatchObject({
      center: [5, 25],
      zoom: 2.5,
      bearing: 0,
      pitch: 0,
    });
    document.compositions[0] = composition;
    expect(evaluate(document, composition.id, 2.5).camera).toMatchObject(evaluated);
  });

  it("tolera apenas ruído numérico pequeno ao impedir realimentação", () => {
    const camera = { center: [56.25, 26.5], zoom: 7, bearing: 12, pitch: 35 } as const;
    expect(
      sameDocumentMapCamera(camera, {
        ...camera,
        center: [56.25000001, 26.5],
      }),
    ).toBe(true);
    expect(sameDocumentMapCamera(camera, { ...camera, zoom: 7.01 })).toBe(false);
  });

  it("mantém a trava fechada quando aplicações programáticas se sobrepõem", () => {
    const guard = new DocumentCameraApplyGuard();
    const releaseFirst = guard.begin();
    const releaseSecond = guard.begin();
    expect(guard.applying).toBe(true);

    releaseFirst();
    expect(guard.applying).toBe(true);
    releaseSecond();
    expect(guard.applying).toBe(false);
  });
});
