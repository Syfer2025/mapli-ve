/**
 * Provas dos coletores do palco. São funções puras: o que elas leem do documento
 * decide o que a GPU desenha, e um erro aqui aparece como um caça de trinta
 * quilômetros ou uma câmera dentro do modelo.
 */

import { describe, expect, it } from "vitest";
import type { EvaluatedScene } from "@theatrum/animation";
import {
  MAX_STAGE_SIZE_METERS,
  collectStudioModels,
  collectStudioPois,
  collectStudioStage,
  stripAlpha,
} from "./studio-scene.js";

interface FakeNode {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly visible?: boolean;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly name?: string;
}

function evaluated(entries: readonly (readonly [string, FakeNode])[]): EvaluatedScene {
  return {
    compositionId: "cmp",
    frame: 0,
    camera: {} as never,
    drawOrder: entries.map(([id]) => id),
    nodes: new Map(
      entries.map(([id, entry]) => [
        id,
        {
          id,
          type: entry.type,
          name: entry.name ?? id,
          visible: entry.visible ?? true,
          props: entry.props,
          transform: { rotation: entry.rotation ?? 0, opacity: entry.opacity ?? 1 },
        } as never,
      ]),
    ),
  } as never;
}

describe("collectStudioStage", () => {
  it("devolve null quando a composição não tem palco — é o que mantém o mapa no ar", () => {
    expect(collectStudioStage(evaluated([["a", { type: "model3d", props: {} }]]))).toBeNull();
  });

  it("ignora palco invisível", () => {
    const scene = evaluated([["p", { type: "studio.stage", props: {}, visible: false }]]);
    expect(collectStudioStage(scene)).toBeNull();
  });

  it("com dois palcos vence o primeiro da ordem de avaliação", () => {
    const scene = evaluated([
      ["alto", { type: "studio.stage", props: { azimuthDeg: 10 } }],
      ["baixo", { type: "studio.stage", props: { azimuthDeg: 200 } }],
    ]);
    expect(collectStudioStage(scene)?.nodeId).toBe("alto");
    expect(collectStudioStage(scene)?.azimuthDeg).toBe(10);
  });

  it("preenche os padrões quando as props faltam", () => {
    const stage = collectStudioStage(evaluated([["p", { type: "studio.stage", props: {} }]]));
    expect(stage).not.toBeNull();
    expect(stage?.distanceMeters).toBe(40);
    expect(stage?.fovDeg).toBe(38);
    expect(stage?.gridSpacingMeters).toBe(5);
  });

  it("limita campo de visão, grade e intensidades a valores desenháveis", () => {
    const stage = collectStudioStage(
      evaluated([
        [
          "p",
          {
            type: "studio.stage",
            props: {
              fovDeg: 400,
              gridSpacingMeters: 0,
              gridOpacity: 3,
              keyIntensity: -5,
              environmentIntensity: -1,
            },
          },
        ],
      ]),
    );
    expect(stage?.fovDeg).toBe(120);
    expect(stage?.gridSpacingMeters).toBeGreaterThan(0);
    expect(stage?.gridOpacity).toBe(1);
    expect(stage?.keyIntensity).toBe(0);
    expect(stage?.environmentIntensity).toBe(0);
  });
});

describe("collectStudioModels", () => {
  it("posiciona por stageX/altitude/stageZ, em metros", () => {
    const models = collectStudioModels(
      evaluated([
        [
          "f18",
          {
            type: "model3d",
            props: { assetId: "sha:1", stageX: 3, altitudeMeters: 1.5, stageZ: -8 },
          },
        ],
      ]),
    );
    expect(models[0]?.position).toEqual([3, 1.5, -8]);
  });

  it("soma a rotação do nó à correção de rumo — o mesmo contrato do mapa", () => {
    const models = collectStudioModels(
      evaluated([
        ["f18", { type: "model3d", props: { assetId: "sha:1", headingOffset: 90 }, rotation: 45 }],
      ]),
    );
    expect(models[0]?.headingDeg).toBe(135);
  });

  it("pula modelo sem asset — instância vazia não desenha e ainda ocupa slot", () => {
    const models = collectStudioModels(
      evaluated([
        ["vazio", { type: "model3d", props: {} }],
        ["ok", { type: "model3d", props: { assetId: "sha:1" } }],
      ]),
    );
    expect(models.map((model) => model.id)).toEqual(["ok"]);
  });

  it("limita a escala herdada de uma cena de mapa", () => {
    // 30 000 é o padrão do `model3d` no mapa: metros de TERRENO. Sem o teto, o
    // mesmo nó arrastado para o palco vira um objeto de trinta quilômetros e a
    // câmera, a 40 m do centro, fica dentro dele.
    const models = collectStudioModels(
      evaluated([["f18", { type: "model3d", props: { assetId: "sha:1", scaleMeters: 30_000 } }]]),
    );
    expect(models[0]?.sizeMeters).toBe(MAX_STAGE_SIZE_METERS);
  });

  it("nunca aceita escala zero ou negativa", () => {
    for (const scaleMeters of [0, -20]) {
      const models = collectStudioModels(
        evaluated([["m", { type: "model3d", props: { assetId: "sha:1", scaleMeters } }]]),
      );
      expect(models[0]?.sizeMeters).toBeGreaterThan(0);
    }
  });

  it("ignora tipos que não são model3d e nós invisíveis", () => {
    const models = collectStudioModels(
      evaluated([
        ["rota", { type: "route3d", props: { assetId: "sha:1" } }],
        ["oculto", { type: "model3d", props: { assetId: "sha:1" }, visible: false }],
      ]),
    );
    expect(models).toEqual([]);
  });
});

describe("collectStudioPois", () => {
  it("lê ponto e enquadramento, e o nome vem do nó", () => {
    const pois = collectStudioPois(
      evaluated([
        [
          "p1",
          {
            type: "studio.poi",
            name: "Cabine",
            props: {
              pointX: 1.5,
              pointY: 2,
              pointZ: -0.5,
              distanceMeters: 6,
              azimuthDeg: 120,
              elevationDeg: 25,
            },
          },
        ],
      ]),
    );
    expect(pois).toEqual([
      {
        id: "p1",
        name: "Cabine",
        point: [1.5, 2, -0.5],
        distanceMeters: 6,
        azimuthDeg: 120,
        elevationDeg: 25,
      },
    ]);
  });

  it("preenche os padrões do tipo quando as props faltam", () => {
    const pois = collectStudioPois(evaluated([["p", { type: "studio.poi", props: {} }]]));
    expect(pois[0]?.point).toEqual([0, 0, 0]);
    expect(pois[0]?.distanceMeters).toBe(12);
    expect(pois[0]?.elevationDeg).toBe(18);
  });

  /**
   * Distância zero põe a câmera dentro do ponto e o `lookAt` degenera; elevação
   * de 90° alinha a direção da câmera com o `up` e a matriz perde uma dimensão.
   * Os dois limites são os mesmos do palco, e valem aqui pelo mesmo motivo.
   */
  it("limita distância e elevação ao que a câmera orbital sabe representar", () => {
    const pois = collectStudioPois(
      evaluated([
        ["a", { type: "studio.poi", props: { distanceMeters: 0, elevationDeg: 400 } }],
        ["b", { type: "studio.poi", props: { distanceMeters: -3, elevationDeg: -400 } }],
      ]),
    );
    expect(pois[0]?.distanceMeters).toBeGreaterThan(0);
    expect(pois[0]?.elevationDeg).toBe(89);
    expect(pois[1]?.distanceMeters).toBeGreaterThan(0);
    expect(pois[1]?.elevationDeg).toBe(-89);
  });

  it("ignora ponto invisível e nó que não é ponto", () => {
    const pois = collectStudioPois(
      evaluated([
        ["oculto", { type: "studio.poi", props: {}, visible: false }],
        ["modelo", { type: "model3d", props: { assetId: "sha:1" } }],
      ]),
    );
    expect(pois).toEqual([]);
  });

  it("mantém a ordem de avaliação, que é a ordem em que o roteiro visita", () => {
    const pois = collectStudioPois(
      evaluated([
        ["primeiro", { type: "studio.poi", props: {} }],
        ["modelo", { type: "model3d", props: { assetId: "sha:1" } }],
        ["segundo", { type: "studio.poi", props: {} }],
      ]),
    );
    expect(pois.map((poi) => poi.id)).toEqual(["primeiro", "segundo"]);
  });
});

describe("stripAlpha", () => {
  it("tira o par de alfa que faria THREE.Color devolver branco", () => {
    expect(stripAlpha("#1a2b3c80")).toBe("#1a2b3c");
    expect(stripAlpha("#1a2b3c")).toBe("#1a2b3c");
  });

  it("recusa lixo em vez de deixar o three reclamar e pintar branco", () => {
    expect(stripAlpha("vermelho")).toBe("#000000");
    expect(stripAlpha("")).toBe("#000000");
  });
});
