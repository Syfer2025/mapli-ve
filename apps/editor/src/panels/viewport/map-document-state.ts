import { evaluateProperty } from "@theatrum/animation";
import type { CameraState } from "@theatrum/camera";
import type { Composition } from "@theatrum/schema";
import type { DetailedBasemap } from "./detailed-basemap.js";
import type { MapStyleId } from "./map-styles.js";
import { parseStyleChoice, type RasterBasemap } from "./raster-basemap.js";

const VECTOR_STYLE_IDS = new Set<MapStyleId>([
  "dark-relief",
  "historical-parchment",
  "minimal-political",
  "strategic-war-room",
]);

/** Compatibilidade de leitura; projetos novos já gravam o id canônico. */
const LEGACY_VECTOR_STYLE_IDS: Readonly<Record<string, MapStyleId>> = Object.freeze({
  style_dark_relief: "dark-relief",
  style_historical_parchment: "historical-parchment",
  style_minimal_political: "minimal-political",
});

/**
 * Trava pequena e testável para eventos síncronos do `jumpTo`.
 *
 * A geração impede a liberação atrasada de uma aplicação antiga de abrir a
 * trava enquanto uma aplicação mais nova ainda está em curso.
 */
export class DocumentCameraApplyGuard {
  #generation = 0;
  #applying = false;

  get applying(): boolean {
    return this.#applying;
  }

  begin(): () => void {
    const generation = ++this.#generation;
    this.#applying = true;
    return () => {
      if (this.#generation === generation) this.#applying = false;
    };
  }
}

export type ResolvedDocumentMapStyle =
  | {
      readonly available: true;
      readonly kind: "vector";
      readonly documentStyleId: string;
      readonly styleId: MapStyleId;
      readonly legacy: boolean;
    }
  | {
      readonly available: true;
      readonly kind: "detailed";
      readonly documentStyleId: string;
      readonly basemap: DetailedBasemap;
    }
  | {
      readonly available: true;
      readonly kind: "satellite";
      readonly documentStyleId: string;
      readonly basemap: RasterBasemap;
      readonly labels: boolean;
    }
  | {
      readonly available: false;
      readonly kind: "fallback";
      readonly documentStyleId: string;
      readonly fallbackStyleId: MapStyleId;
      readonly reason: string;
    };

/**
 * Resolve somente para render; nunca devolve um novo valor para gravar.
 *
 * A ausência de pacote mantém `documentStyleId` intacto e produz um fallback
 * identificável pela UI (ADR-026).
 */
export function resolveDocumentMapStyle(
  documentStyleId: string,
  detailedBasemaps: readonly DetailedBasemap[],
  rasterBasemaps: readonly RasterBasemap[],
): ResolvedDocumentMapStyle {
  const legacy = LEGACY_VECTOR_STYLE_IDS[documentStyleId];
  if (legacy !== undefined) {
    return {
      available: true,
      kind: "vector",
      documentStyleId,
      styleId: legacy,
      legacy: true,
    };
  }

  const parsed = parseStyleChoice(documentStyleId);
  if (parsed.kind === "vector" && VECTOR_STYLE_IDS.has(parsed.id as MapStyleId)) {
    return {
      available: true,
      kind: "vector",
      documentStyleId,
      styleId: parsed.id as MapStyleId,
      legacy: false,
    };
  }
  if (parsed.kind === "detailed") {
    const basemap = detailedBasemaps.find((candidate) => candidate.id === parsed.id);
    if (basemap !== undefined) {
      return { available: true, kind: "detailed", documentStyleId, basemap };
    }
    return unavailable(documentStyleId, `pacote detalhado “${parsed.id}” não encontrado`);
  }
  if (parsed.kind === "satellite") {
    const basemap = rasterBasemaps.find((candidate) => candidate.id === parsed.id);
    if (basemap !== undefined) {
      return {
        available: true,
        kind: "satellite",
        documentStyleId,
        basemap,
        labels: parsed.labels,
      };
    }
    return unavailable(documentStyleId, `imagem de satélite “${parsed.id}” não encontrada`);
  }
  return unavailable(documentStyleId, `estilo “${documentStyleId}” desconhecido`);
}

/** Fallback mantém a autoria visível, mas nunca pode se passar pelo mapa exportável. */
export function documentMapStyleExportBlockReason(
  resolved: ResolvedDocumentMapStyle,
): string | null {
  return resolved.available
    ? null
    : `o mapa salvo no projeto está indisponível: ${resolved.reason}`;
}

export function evaluatedDocumentMapCamera(
  composition: Composition,
  playheadFrame: number,
): CameraState {
  const center = evaluateProperty(composition.camera.center, playheadFrame);
  return {
    center: [center[0], center[1]],
    zoom: evaluateProperty(composition.camera.zoom, playheadFrame),
    bearing: evaluateProperty(composition.camera.bearing, playheadFrame),
    pitch: evaluateProperty(composition.camera.pitch, playheadFrame),
  };
}

export function sameDocumentMapCamera(
  left: CameraState,
  right: CameraState,
  epsilon = 1e-7,
): boolean {
  return (
    Math.abs(left.center[0] - right.center[0]) <= epsilon &&
    Math.abs(left.center[1] - right.center[1]) <= epsilon &&
    Math.abs(left.zoom - right.zoom) <= epsilon &&
    angleDistance(left.bearing, right.bearing) <= epsilon &&
    Math.abs(left.pitch - right.pitch) <= epsilon
  );
}

function angleDistance(left: number, right: number): number {
  const delta = ((((left - right + 180) % 360) + 360) % 360) - 180;
  return Math.abs(delta);
}

function unavailable(documentStyleId: string, reason: string): ResolvedDocumentMapStyle {
  return {
    available: false,
    kind: "fallback",
    documentStyleId,
    fallbackStyleId: "dark-relief",
    reason,
  };
}
