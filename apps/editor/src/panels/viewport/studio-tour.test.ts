/**
 * Provas do compilador do roteiro. É função pura, e o que ela escreve vira a
 * câmera do vídeo exportado — um erro aqui não aparece como exceção, aparece
 * como a câmera dando uma volta inteira em torno do obuseiro no meio da narração.
 */

import { describe, expect, it } from "vitest";
import { normalizeDegrees, shortestAngleDelta } from "@theatrum/core-math";
import { compileStudioTour, unwrapAzimuths, type TourStop } from "./studio-tour.js";

function stop(id: string, overrides: Partial<TourStop> = {}): TourStop {
  return {
    id,
    name: id,
    point: [0, 0, 0],
    distanceMeters: 12,
    azimuthDeg: 0,
    elevationDeg: 18,
    ...overrides,
  };
}

const TIMING = { startFrame: 0, travelFrames: 30, holdFrames: 60 };

describe("unwrapAzimuths", () => {
  /**
   * O defeito que este teste existe para impedir: 350° e 10° estão a vinte graus
   * um do outro, e a interpolação linear entre eles percorre 340 pelo lado errado.
   */
  it("atravessa a costura 0/360 pelo caminho curto", () => {
    expect(unwrapAzimuths([350, 10])).toEqual([350, 370]);
    expect(unwrapAzimuths([10, 350])).toEqual([10, -10]);
  });

  it("acumula voltas em vez de voltar ao intervalo canônico", () => {
    expect(unwrapAzimuths([0, 170, 340, 150])).toEqual([0, 170, 340, 510]);
  });

  /**
   * Desenrolar não pode mudar a direção apontada — só o representante dela. A
   * asserção é **modular**, pela mesma razão de 09-CONTINUIDADE § 4.17: comparar
   * ângulos por diferença linear é o erro que este arquivo inteiro combate.
   */
  it("preserva a direção de cada parada", () => {
    const entrada = [350, 10, 190, 12.5, 359.999];
    for (const [index, saida] of unwrapAzimuths(entrada).entries()) {
      expect(Math.abs(shortestAngleDelta(saida, entrada[index] ?? 0))).toBeLessThan(1e-9);
      expect(normalizeDegrees(saida)).toBeCloseTo(normalizeDegrees(entrada[index] ?? 0), 9);
    }
  });

  it("lista vazia e lista de um sobrevivem", () => {
    expect(unwrapAzimuths([])).toEqual([]);
    expect(unwrapAzimuths([42])).toEqual([42]);
  });
});

describe("compileStudioTour", () => {
  it("sem pontos não escreve nada e diz por quê", () => {
    const tour = compileStudioTour([], TIMING);
    expect(tour.writes).toEqual([]);
    expect(tour.stops).toBe(0);
    expect(tour.diagnostics[0]).toContain("Nenhum ponto");
  });

  it("escreve as seis props de câmera do palco, e só elas", () => {
    const tour = compileStudioTour([stop("a")], TIMING);
    expect(tour.writes.map((write) => write.path)).toEqual([
      "props.targetX",
      "props.targetY",
      "props.targetZ",
      "props.distanceMeters",
      "props.azimuthDeg",
      "props.elevationDeg",
    ]);
  });

  /**
   * Um keyframe por parada faria a câmera chegar e sair no mesmo instante. O par
   * chegada/partida é o que existe para o narrador ter tempo de falar.
   */
  it("dá a cada parada um par chegada/partida, e a pausa mede o que foi pedido", () => {
    const tour = compileStudioTour([stop("a"), stop("b")], TIMING);
    const frames = tour.writes[0]?.keyframes.map((keyframe) => keyframe.frame);
    expect(frames).toEqual([0, 60, 90, 150]);
    expect(tour.endFrame).toBe(150);
  });

  it("sem pausa não emite dois keyframes no mesmo frame", () => {
    const tour = compileStudioTour([stop("a"), stop("b")], { ...TIMING, holdFrames: 0 });
    const frames = tour.writes[0]?.keyframes.map((keyframe) => keyframe.frame) ?? [];
    expect(frames).toEqual([0, 30]);
    expect(new Set(frames).size).toBe(frames.length);
  });

  it("copia ponto e enquadramento de cada parada, sem inventar interpolação", () => {
    const tour = compileStudioTour(
      [
        stop("a", { point: [1, 2, 3], distanceMeters: 8, elevationDeg: 40 }),
        stop("b", { point: [-4, 0, 5], distanceMeters: 20, elevationDeg: -10 }),
      ],
      TIMING,
    );
    const byPath = new Map(tour.writes.map((write) => [write.path, write.keyframes]));
    expect(byPath.get("props.targetX")?.map((keyframe) => keyframe.value)).toEqual([1, 1, -4, -4]);
    expect(byPath.get("props.targetZ")?.map((keyframe) => keyframe.value)).toEqual([3, 3, 5, 5]);
    expect(byPath.get("props.distanceMeters")?.map((keyframe) => keyframe.value)).toEqual([
      8, 8, 20, 20,
    ]);
    expect(byPath.get("props.elevationDeg")?.map((keyframe) => keyframe.value)).toEqual([
      40, 40, -10, -10,
    ]);
  });

  it("o azimute sai desenrolado, não como o dono digitou", () => {
    const tour = compileStudioTour(
      [stop("a", { azimuthDeg: 350 }), stop("b", { azimuthDeg: 10 })],
      TIMING,
    );
    const azimuth = tour.writes.find((write) => write.path === "props.azimuthDeg");
    expect(azimuth?.keyframes.map((keyframe) => keyframe.value)).toEqual([350, 350, 370, 370]);
  });

  /**
   * Ids estáveis são o que faz recompilar substituir em vez de acumular. Sem
   * isso, a terceira compilação de um roteiro de três pontos deixaria dezoito
   * keyframes empilhados na trilha.
   */
  it("os ids são função da posição e da prop, iguais entre compilações", () => {
    const stops = [stop("a"), stop("b")];
    const primeira = compileStudioTour(stops, TIMING);
    const segunda = compileStudioTour(stops, TIMING);
    expect(primeira.writes[0]?.keyframes.map((keyframe) => keyframe.id)).toEqual([
      "tour:0:props.targetX:in",
      "tour:0:props.targetX:out",
      "tour:1:props.targetX:in",
      "tour:1:props.targetX:out",
    ]);
    expect(segunda).toEqual(primeira);
  });

  it("chegada desacelera e partida acelera — o voo tem curva", () => {
    const tour = compileStudioTour([stop("a"), stop("b")], TIMING);
    const keyframes = tour.writes[0]?.keyframes ?? [];
    expect(keyframes[0]?.in.kind).toBe("bezier");
    expect(keyframes[1]?.out.kind).toBe("bezier");
  });

  it("arredonda e limita tempos absurdos em vez de emitir frame fracionário", () => {
    const tour = compileStudioTour([stop("a"), stop("b")], {
      startFrame: -10,
      travelFrames: 0,
      holdFrames: -5,
    });
    for (const write of tour.writes) {
      for (const keyframe of write.keyframes) {
        expect(Number.isInteger(keyframe.frame)).toBe(true);
        expect(keyframe.frame).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
