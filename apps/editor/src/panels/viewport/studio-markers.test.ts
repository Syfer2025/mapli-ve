import { describe, expect, it } from "vitest";
import type { Vec2 } from "@theatrum/core-math";
import { layoutStudioMarkers, markerAt, MARKER_HIT_RADIUS_PX } from "./studio-markers.js";
import type { StudioPoiState } from "./studio-scene.js";

function poi(id: string, name: string, point: readonly [number, number, number]): StudioPoiState {
  return { id, name, point, distanceMeters: 12, azimuthDeg: 35, elevationDeg: 18 };
}

describe("marcadores de ponto de interesse do palco", () => {
  it("projeta na ordem de avaliação e numera a partir de 1", () => {
    const markers = layoutStudioMarkers(
      [poi("a", "Cabine", [0, 2, 0]), poi("b", "Míssil", [3, 1, 0])],
      (point) => [point[0] * 10, point[1] * 10] as Vec2,
    );
    expect(markers.map((marker) => [marker.id, marker.ordinal])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(markers[0]?.screen).toEqual([0, 20]);
  });

  /**
   * Numeração instável seria pior que marcador nenhum: o dono cita "o ponto 3"
   * ao montar o roteiro, e se girar a câmera renumerasse, a frase mudaria de
   * significado sozinha.
   */
  it("ponto atrás da câmera some do desenho sem renumerar os outros", () => {
    const markers = layoutStudioMarkers(
      [poi("a", "Cabine", [0, 0, 0]), poi("b", "Atrás", [0, 0, 9]), poi("c", "Cauda", [1, 0, 0])],
      (point) => (point[2] > 5 ? null : ([point[0], point[1]] as Vec2)),
    );
    expect(markers.map((marker) => [marker.id, marker.ordinal])).toEqual([
      ["a", 1],
      ["c", 3],
    ]);
  });

  it("acha o marcador sob o cursor dentro do raio e ignora fora dele", () => {
    const markers = layoutStudioMarkers([poi("a", "Cabine", [0, 0, 0])], () => [100, 100] as Vec2);
    expect(markerAt(markers, 104, 103)?.id).toBe("a");
    expect(markerAt(markers, 100 + MARKER_HIT_RADIUS_PX + 1, 100)).toBeNull();
  });

  it("com dois marcadores no raio vence o mais próximo, não o primeiro", () => {
    const markers = layoutStudioMarkers(
      [poi("perto-nao", "A", [0, 0, 0]), poi("perto-sim", "B", [1, 0, 0])],
      (point) => (point[0] === 0 ? ([100, 100] as Vec2) : ([108, 100] as Vec2)),
    );
    expect(markerAt(markers, 107, 100)?.id).toBe("perto-sim");
  });
});
