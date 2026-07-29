/**
 * Provas do arrastar-e-soltar no palco.
 *
 * As duas peças puras: o transporte, que precisa recusar qualquer coisa que não tenhamos
 * escrito, e a mira no piso, que decide onde o modelo nasce.
 */

import { describe, expect, it } from "vitest";
import { orbitCameraPosition, type Vec3 } from "@theatrum/core-math";
import { decodeStudioDrop, encodeStudioDrop, floorPointAt } from "./studio-drop.js";

describe("transporte do arraste", () => {
  it("ida e volta preserva os dois tipos de carga", () => {
    for (const payload of [
      { kind: "asset", src: "assets/ab/abcdef.glb" },
      { kind: "local", file: "fa-18f.glb" },
    ] as const) {
      expect(decodeStudioDrop(encodeStudioDrop(payload))).toEqual(payload);
    }
  });

  /**
   * Recusar é o comportamento certo para entrada estranha. O alternativo — tentar
   * interpretar — criaria nó com asset inexistente, que é exatamente o defeito que o
   * dono acabou de encontrar por outro caminho: palco vazio dizendo `asset ausente`.
   */
  it("recusa qualquer coisa que não seja o que escrevemos", () => {
    for (const raw of [
      "",
      "não é json",
      "null",
      "[]",
      '"texto"',
      "{}",
      '{"kind":"asset"}',
      '{"kind":"asset","src":""}',
      '{"kind":"local","file":""}',
      '{"kind":"outro","src":"x"}',
      '{"src":"assets/ab/abcdef.glb"}',
    ]) {
      expect(decodeStudioDrop(raw)).toBeNull();
    }
  });
});

describe("mira no piso", () => {
  const viewport: readonly [number, number] = [1000, 500];
  const fovDeg = 38;

  function cameraAt(
    azimuthDeg: number,
    elevationDeg: number,
    distanceMeters = 40,
    target: Vec3 = [0, 0, 0],
  ) {
    return {
      position: orbitCameraPosition({ target, distanceMeters, azimuthDeg, elevationDeg }),
      target,
      fovDeg,
    };
  }

  /**
   * O centro da tela olha para o alvo da câmera. Com o alvo no piso, o ponto do centro
   * **é** o alvo — é o caso âncora que pega base de câmera trocada, sinal invertido e
   * aspecto aplicado no eixo errado de uma vez.
   */
  it("o centro da tela cai no alvo quando o alvo está no piso", () => {
    const point = floorPointAt(500, 250, viewport, cameraAt(35, 20));
    expect(point).not.toBeNull();
    expect(point?.[0]).toBeCloseTo(0, 6);
    expect(point?.[1]).toBeCloseTo(0, 9);
    expect(point?.[2]).toBeCloseTo(0, 6);
  });

  it("o resultado está sempre no plano do piso", () => {
    for (const [x, y] of [
      [100, 400],
      [900, 300],
      [500, 499],
      [250, 260],
    ]) {
      const point = floorPointAt(x ?? 0, y ?? 0, viewport, cameraAt(35, 30), 0);
      expect(point?.[1]).toBeCloseTo(0, 9);
    }
  });

  it("respeita a altura do plano quando ela não é zero", () => {
    const point = floorPointAt(500, 250, viewport, cameraAt(0, 45, 40, [0, 3, 0]), 3);
    expect(point?.[1]).toBeCloseTo(3, 9);
  });

  /**
   * Mover o cursor para baixo na tela aproxima o ponto da câmera, com a câmera olhando
   * para baixo. O contrário significa base invertida — e um modelo soltando atrás do
   * observador.
   */
  it("mais abaixo na tela é mais perto da câmera", () => {
    const camera = cameraAt(0, 35);
    const alto = floorPointAt(500, 180, viewport, camera);
    const baixo = floorPointAt(500, 420, viewport, camera);
    expect(alto).not.toBeNull();
    expect(baixo).not.toBeNull();
    const distancia = (p: Vec3) =>
      Math.hypot(p[0] - camera.position[0], p[1] - camera.position[1], p[2] - camera.position[2]);
    expect(distancia(baixo as Vec3)).toBeLessThan(distancia(alto as Vec3));
  });

  /**
   * Acima do horizonte não há piso, e a resposta honesta é `null`.
   *
   * Inventar interseção poria o modelo a quilômetros da cena sem explicação — o dono
   * arrastaria um caça e ele desapareceria. Com a câmera quase rasante, o topo da tela
   * está acima do horizonte.
   */
  it("devolve null acima do horizonte", () => {
    expect(floorPointAt(500, 5, viewport, cameraAt(0, 2))).toBeNull();
  });

  it("devolve null para viewport degenerado em vez de NaN", () => {
    expect(floorPointAt(0, 0, [0, 0], cameraAt(0, 30))).toBeNull();
  });

  /**
   * Girar a câmera gira o ponto: soltar no mesmo pixel de dois azimutes diferentes tem
   * de dar dois lugares diferentes do palco. Se der o mesmo, a base da câmera não está
   * sendo usada e o resultado é coincidência.
   */
  it("o ponto acompanha o azimute da câmera", () => {
    const de0 = floorPointAt(700, 350, viewport, cameraAt(0, 30));
    const de90 = floorPointAt(700, 350, viewport, cameraAt(90, 30));
    expect(de0).not.toBeNull();
    expect(de90).not.toBeNull();
    expect(
      Math.hypot((de0?.[0] ?? 0) - (de90?.[0] ?? 0), (de0?.[2] ?? 0) - (de90?.[2] ?? 0)),
    ).toBeGreaterThan(1);
  });
});
