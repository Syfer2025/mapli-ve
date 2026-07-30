import { describe, expect, it } from "vitest";
import {
  bindMapExportReadiness,
  mapBusyForExport,
  mapExportBlockReason,
} from "./map-export-readiness.js";

describe("map export readiness", () => {
  it("mantém o erro do recurso como bloqueio até o dono liberar o binding", () => {
    const map = {};
    let reason: string | null = null;
    const release = bindMapExportReadiness(map, () => reason);

    expect(mapExportBlockReason(map)).toBeNull();
    reason = "PMTiles removido durante o export";
    expect(mapExportBlockReason(map)).toBe("PMTiles removido durante o export");

    release();
    expect(mapExportBlockReason(map)).toBeNull();
  });

  it("um cleanup antigo não apaga o binding mais recente", () => {
    const map = {};
    const releaseOld = bindMapExportReadiness(map, () => "antigo");
    const releaseCurrent = bindMapExportReadiness(map, () => "atual");

    releaseOld();
    expect(mapExportBlockReason(map)).toBe("atual");
    releaseCurrent();
    expect(mapExportBlockReason(map)).toBeNull();
  });

  it("falha da sonda também fecha o export", () => {
    const map = {};
    bindMapExportReadiness(map, () => {
      throw new Error("estado corrompido");
    });
    expect(mapExportBlockReason(map)).toContain("estado corrompido");
  });

  it("continua ocupado quando MapLibre chama tile com erro de carregado", () => {
    const map = {
      isMoving: () => false,
      // MapLibre inclui o estado `errored` nesta resposta.
      areTilesLoaded: () => true,
    };
    bindMapExportReadiness(map, () => "PMTiles ausente");

    expect(mapBusyForExport(map)).toBe(true);
  });

  it("fica livre somente sem movimento, sem pendência e sem erro latente", () => {
    const map = {
      isMoving: () => false,
      areTilesLoaded: () => true,
    };
    bindMapExportReadiness(map, () => null);
    expect(mapBusyForExport(map)).toBe(false);
  });
});
