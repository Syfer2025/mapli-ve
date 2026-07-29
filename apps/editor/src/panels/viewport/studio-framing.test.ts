/**
 * Provas do enquadramento da visita.
 *
 * O que elas travam é a correção que motivou o módulo: a distância depende da **lente**.
 * A conta antiga, `raio × 0,9`, dava o mesmo número com campo de visão de 20° e de 60°, e
 * o enquadramento mudava sozinho quando alguém tocava na lente.
 */

import { describe, expect, it } from "vitest";
import { poiFramingFor } from "./studio-framing.js";

const CAMERA = { azimuthDeg: 35, elevationDeg: 14, fovDeg: 38 };

describe("poiFramingFor", () => {
  it("preserva os ângulos da câmera no instante da marcação", () => {
    const framing = poiFramingFor({ ...CAMERA, azimuthDeg: -212.5, elevationDeg: 61 }, 9);
    expect(framing.azimuthDeg).toBe(-212.5);
    expect(framing.elevationDeg).toBe(61);
  });

  /**
   * **O defeito que este módulo existe para corrigir.** Lente mais fechada enquadra menos,
   * então a câmera precisa de mais distância para mostrar a mesma peça. A conta antiga
   * ignorava isso por completo.
   */
  it("lente mais fechada exige mais distância para o mesmo objeto", () => {
    const fechada = poiFramingFor({ ...CAMERA, fovDeg: 20 }, 9).distanceMeters;
    const aberta = poiFramingFor({ ...CAMERA, fovDeg: 60 }, 9).distanceMeters;
    expect(fechada).toBeGreaterThan(aberta * 1.5);
  });

  /** Objeto maior, visita mais longe — e proporcional, não por degraus. */
  it("a distância é proporcional ao tamanho do objeto", () => {
    const pequeno = poiFramingFor(CAMERA, 9).distanceMeters;
    const grande = poiFramingFor(CAMERA, 18).distanceMeters;
    expect(grande).toBeCloseTo(pequeno * 2, 6);
  });

  /**
   * A visita mostra a **peça com contexto**, não o objeto inteiro: a distância tem de ser
   * bem menor que a que enquadraria o veículo todo, senão o roteiro inteiro parece a
   * câmera parada no plano geral.
   */
  it("chega mais perto que o enquadramento do objeto inteiro", () => {
    const raio = 9;
    const visita = poiFramingFor(CAMERA, raio).distanceMeters;
    // O enquadramento do objeto inteiro, com a mesma lente e a mesma margem.
    const objetoInteiro = poiFramingFor(CAMERA, raio / 0.35).distanceMeters;
    expect(visita).toBeLessThan(objetoInteiro * 0.5);
  });

  /** Modelo ainda em parse: sobra o padrão do tipo de nó, não `NaN` nem zero. */
  it("sem raio de modelo devolve o padrão do tipo", () => {
    for (const raio of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(poiFramingFor(CAMERA, raio).distanceMeters).toBe(12);
    }
  });

  /**
   * Objeto minúsculo não pode pôr a câmera dentro dele, e objeto gigantesco não pode
   * empurrar a visita para fora do palco. Os dois limites são os mesmos que
   * `orbitCameraPosition` e o vão máximo do palco já impõem.
   */
  it("nunca sai da faixa que a câmera do palco representa", () => {
    expect(poiFramingFor(CAMERA, 0.001).distanceMeters).toBeGreaterThanOrEqual(0.5);
    // 250 m de raio é o maior objeto que o palco aceita (vão de 500 m em
    // `MAX_STAGE_SIZE_METERS`), e aí o teto ainda manda.
    expect(poiFramingFor(CAMERA, 250).distanceMeters).toBeLessThanOrEqual(500);
  });

  /**
   * **A folga vence o teto**, e a ordem é decisão, não descuido: câmera dentro do
   * objeto é erro de correção, e o teto de 500 m é limite de gosto. Só ocorre com
   * objeto maior do que o palco aceita — mas se ocorrer, sair do enquadramento
   * bonito é melhor que filmar de dentro da fuselagem.
   */
  it("objeto maior que o palco empurra a câmera além do teto em vez de entrar nele", () => {
    expect(poiFramingFor(CAMERA, 5000).distanceMeters).toBeGreaterThan(5000);
  });

  /**
   * O defeito que o dono viu na primeira apresentação compilada: _"a câmera está
   * passando por dentro do objeto e isso nunca pode acontecer"_. A conta de
   * enquadramento pedia 4 a 6 m num caça cujo raio envolvente é 9 — a câmera
   * nascia dentro do volume, e o voo entre paradas atravessava a fuselagem.
   */
  it("a câmera nunca nasce dentro do objeto, qualquer que seja o porte", () => {
    for (const raio of [0.4, 2, 9, 18, 60, 165]) {
      const { distanceMeters } = poiFramingFor(CAMERA, raio);
      expect(distanceMeters, `raio ${String(raio)} m`).toBeGreaterThan(raio);
    }
  });

  /**
   * E a folga não pode ter engolido a aproximação: visitar o míssil continua
   * enquadrando o míssil, não o caça inteiro. Quem aproxima passa a ser a LENTE.
   */
  it("com lente fechada a visita enquadra mais perto que com lente aberta", () => {
    const aberta = poiFramingFor({ ...CAMERA, fovDeg: 60 }, 9);
    const fechada = poiFramingFor({ ...CAMERA, fovDeg: 18 }, 9);
    expect(fechada.distanceMeters).toBeGreaterThanOrEqual(aberta.distanceMeters);
    expect(aberta.distanceMeters).toBeGreaterThan(9);
  });

  it("sem raio conhecido o piso é o mínimo da câmera, não o do modelo", () => {
    expect(poiFramingFor(CAMERA, null).distanceMeters).toBe(12);
  });
});
