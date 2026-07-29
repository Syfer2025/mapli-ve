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
    // Sem dono, o ponto guardado já é mundo e o resolvedor padrão o devolve como
    // está — que é o caso de todo ponto marcado antes do ADR-016.
    ownerId: "",
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

/**
 * O ponto ancorado num objeto ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
 *
 * O compilador não sabe converter — converter exige a caixa do GLB, que não está
 * no documento — então ele **pergunta**. O que estes testes travam é o contrato
 * dessa pergunta: quando ela é feita, com que frame, e o que acontece quando a
 * resposta é "não sei".
 */
describe("compileStudioTour com ponto ancorado", () => {
  function targetOf(tour: ReturnType<typeof compileStudioTour>, axis: "X" | "Y" | "Z"): number[] {
    return (
      tour.writes
        .find((write) => write.path === `props.target${axis}`)
        ?.keyframes.map((keyframe) => keyframe.value) ?? []
    );
  }

  /**
   * O ponto que entra no keyframe é o **resolvido**, não o guardado.
   *
   * Se o compilador copiasse o valor do documento, um ponto ancorado — cujo valor
   * guardado é fração do vão do modelo, tipicamente entre −1 e 1 — poria a câmera
   * a meio metro da origem do palco olhando o vazio. Plausível e errado.
   */
  it("usa o ponto que o resolvedor devolve, não o guardado no documento", () => {
    const tour = compileStudioTour(
      [stop("a", { ownerId: "aviao", point: [0.2, 0.1, 0] })],
      { startFrame: 0, travelFrames: 30, holdFrames: 60 },
      () => [12, 5, -3],
    );
    expect(targetOf(tour, "X")).toEqual([12, 12]);
    expect(targetOf(tour, "Y")).toEqual([5, 5]);
    expect(targetOf(tour, "Z")).toEqual([-3, -3]);
  });

  /**
   * Cada parada é resolvida no **frame em que a câmera chega nela**, porque um
   * objeto animado não está no mesmo lugar no frame 0 e no frame 90. Resolver tudo
   * no frame inicial faria a câmera mirar onde o míssil **estava**.
   */
  it("resolve cada parada no frame de chegada dela", () => {
    const asked: number[] = [];
    compileStudioTour(
      [stop("a", { ownerId: "aviao" }), stop("b", { ownerId: "aviao" })],
      { startFrame: 10, travelFrames: 20, holdFrames: 30 },
      (_stop, frame) => {
        asked.push(frame);
        return [0, 0, 0];
      },
    );
    // As duas chegadas: 10 para a primeira, 10 + (30 + 20) = 60 para a segunda. A lista
    // completa traz também a sondagem da passagem 1 e a amostragem da pausa, e afirmar o
    // conjunto inteiro travaria o passo de amostragem num teste que é sobre outra coisa.
    expect(asked).toContain(10);
    expect(asked).toContain(60);
    // E cada pausa é percorrida: a última amostra da segunda parada é a partida dela.
    expect(Math.max(...asked)).toBe(60 + 30);
  });

  /**
   * Parada que não resolve sai do roteiro **e é contada**. Compilar cinco pontos e
   * receber três sem explicação é o silêncio que faz alguém procurar defeito na
   * câmera por meia hora.
   */
  it("descarta a parada órfã, conta e diz o nome dela", () => {
    const tour = compileStudioTour(
      [
        stop("a", { point: [1, 0, 0] }),
        stop("orfa", { name: "Míssil", ownerId: "sumiu" }),
        stop("c", { point: [3, 0, 0] }),
      ],
      { startFrame: 0, travelFrames: 10, holdFrames: 20 },
      (candidate) => (candidate.ownerId === "" ? candidate.point : null),
    );
    expect(tour.stops).toBe(2);
    expect(tour.skipped).toBe(1);
    expect(tour.diagnostics.some((message) => message.includes("Míssil"))).toBe(true);
    // A agenda **compacta**: a parada que sobrou assume o lugar da que saiu, em vez
    // de deixar um buraco em que a câmera ficaria parada mirando nada.
    expect(targetOf(tour, "X")).toEqual([1, 1, 3, 3]);
    expect(tour.endFrame).toBe(0 + 1 * (20 + 10) + 20);
  });

  it("nenhuma parada localizável não escreve nada e explica", () => {
    const tour = compileStudioTour(
      [stop("a", { ownerId: "sumiu" })],
      { startFrame: 5, travelFrames: 10, holdFrames: 10 },
      () => null,
    );
    expect(tour.writes).toEqual([]);
    expect(tour.stops).toBe(0);
    expect(tour.skipped).toBe(1);
    expect(tour.endFrame).toBe(5);
    expect(tour.diagnostics.length).toBeGreaterThan(0);
  });

  /**
   * **Objeto parado não paga nada.** Era a condição para o acompanhamento poder existir:
   * um documento estático tem de sair com os mesmos dois keyframes por prop de antes do
   * recurso, senão toda cena do dono engordaria a trilha sem motivo.
   */
  it("objeto parado não gera keyframe de acompanhamento", () => {
    const tour = compileStudioTour(
      [stop("a", { ownerId: "aviao" })],
      { startFrame: 0, travelFrames: 10, holdFrames: 60 },
      () => [4, 1, 2],
    );
    for (const write of tour.writes) {
      expect(write.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 60]);
    }
  });

  /**
   * **O limite declarado do ADR-016, fechado.** Com o dono animado, o alvo tem de
   * acompanhar durante a pausa — senão a câmera escorrega do míssil justamente enquanto o
   * narrador fala dele.
   *
   * O movimento é em U de propósito: uma reta seria descrita pelos dois extremos e não
   * exigiria keyframe nenhum no meio, o que faria o teste passar sem testar nada.
   */
  it("objeto em movimento ganha keyframes de alvo no meio da pausa", () => {
    const tour = compileStudioTour(
      [stop("a", { ownerId: "aviao" })],
      { startFrame: 0, travelFrames: 10, holdFrames: 60 },
      // Parábola: sai de 0, desce até −15 no meio, volta a 0.
      (_stop, frame) => [0, 0, -15 * Math.sin((frame / 60) * Math.PI)],
    );
    const alvoZ = tour.writes.find((write) => write.path === "props.targetZ");
    const frames = alvoZ?.keyframes.map((keyframe) => keyframe.frame) ?? [];
    expect(frames.length).toBeGreaterThan(2);
    expect(frames[0]).toBe(0);
    expect(frames[frames.length - 1]).toBe(60);
    // Ordenados e sem repetição: documento inválido é keyframe fora de ordem ou duplicado.
    expect([...frames].sort((a, b) => a - b)).toEqual(frames);
    expect(new Set(frames).size).toBe(frames.length);
    // O meio da pausa segue o objeto, em vez de ficar no valor da chegada.
    const meio = alvoZ?.keyframes.find((keyframe) => keyframe.frame > 20 && keyframe.frame < 40);
    expect(meio?.value ?? 0).toBeLessThan(-10);

    // E as props que NÃO acompanham continuam com dois keyframes: o enquadramento é do
    // ponto, não do movimento.
    const distancia = tour.writes.find((write) => write.path === "props.distanceMeters");
    expect(distancia?.keyframes.length).toBe(2);
  });

  /**
   * As curvas do acompanhamento são lineares nos dois lados.
   *
   * Bézier passando por pontos amostrados de um objeto em movimento **ultrapassa** entre
   * amostras: a câmera oscilaria em torno do alvo, e o defeito apareceria como um tremor
   * sutil que ninguém liga à curva.
   */
  it("keyframe de acompanhamento é linear nos dois lados", () => {
    const tour = compileStudioTour(
      [stop("a", { ownerId: "aviao" })],
      { startFrame: 0, travelFrames: 10, holdFrames: 60 },
      (_stop, frame) => [0, 0, -15 * Math.sin((frame / 60) * Math.PI)],
    );
    const alvoZ = tour.writes.find((write) => write.path === "props.targetZ");
    const meio = (alvoZ?.keyframes ?? []).filter(
      (keyframe) => keyframe.frame > 0 && keyframe.frame < 60,
    );
    expect(meio.length).toBeGreaterThan(0);
    for (const keyframe of meio) {
      expect(keyframe.in.kind).toBe("linear");
      expect(keyframe.out.kind).toBe("linear");
    }
  });

  /** A partida usa o lugar do objeto no frame da partida, não no da chegada. */
  it("a partida acompanha o objeto em vez de voltar à chegada", () => {
    const tour = compileStudioTour(
      [stop("a", { ownerId: "aviao" })],
      { startFrame: 0, travelFrames: 10, holdFrames: 60 },
      (_stop, frame) => [frame, 0, 0],
    );
    const alvoX = tour.writes.find((write) => write.path === "props.targetX");
    const ultimo = alvoX?.keyframes[(alvoX.keyframes.length ?? 1) - 1];
    expect(ultimo?.frame).toBe(60);
    expect(ultimo?.value).toBe(60);
  });

  /**
   * Sem resolvedor, ponto solto continua funcionando (é mundo) e ponto com dono
   * **não** entra. É o que impede que um chamador que esqueceu o resolvedor
   * produza um roteiro plausível e errado.
   */
  it("o resolvedor padrão aceita ponto solto e recusa ponto ancorado", () => {
    const tour = compileStudioTour(
      [stop("solto", { point: [7, 0, 0] }), stop("preso", { ownerId: "aviao" })],
      {
        startFrame: 0,
        travelFrames: 10,
        holdFrames: 10,
      },
    );
    expect(tour.stops).toBe(1);
    expect(tour.skipped).toBe(1);
    expect(targetOf(tour, "X")).toEqual([7, 7]);
  });
});
