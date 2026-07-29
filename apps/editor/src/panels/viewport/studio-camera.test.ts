/**
 * Provas da câmera de autoria ([ADR-017](../../../../../docs/adr/ADR-017-studio-authoring-camera.md)).
 *
 * Funções puras que traduzem gesto de mouse em estado orbital. O que elas protegem: a
 * câmera de autoria vive no **mesmo espaço de parâmetros** da câmera do documento, e é
 * isso que faz "gravar enquadramento" gravar exatamente o que o dono compôs em vez de
 * uma aproximação.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_ELEVATION_DEG,
  MIN_ORBIT_DISTANCE_METERS,
  orbitCameraPosition,
  type OrbitState,
} from "@theatrum/core-math";
import {
  DRAG_THRESHOLD_PX,
  effectiveStageCamera,
  metersPerPixel,
  orbitByDrag,
  panByDrag,
  screenBasis,
  zoomByWheel,
} from "./studio-camera.js";

function state(overrides: Partial<OrbitState> = {}): OrbitState {
  return {
    target: [0, 0, 0],
    distanceMeters: 40,
    azimuthDeg: 35,
    elevationDeg: 14,
    ...overrides,
  };
}

describe("screenBasis", () => {
  /**
   * `right` tem de ser horizontal em qualquer elevação. Se a componente vertical
   * vazar, deslocar lateralmente afunda ou levanta o alvo — o cenário "escorrega" na
   * diagonal, que é o defeito mais irritante de câmera de editor.
   */
  it("mantém o vetor lateral no plano do chão em qualquer elevação", () => {
    for (const elevationDeg of [-80, -14, 0, 14, 45, 88]) {
      expect(screenBasis(35, elevationDeg).right[1]).toBe(0);
    }
  });

  it("os dois vetores são unitários e perpendiculares", () => {
    for (const [azimuthDeg, elevationDeg] of [
      [0, 0],
      [35, 14],
      [-120, 60],
      [270, -45],
    ]) {
      const { right, up } = screenBasis(azimuthDeg ?? 0, elevationDeg ?? 0);
      expect(Math.hypot(right[0], right[1], right[2])).toBeCloseTo(1, 9);
      expect(Math.hypot(up[0], up[1], up[2])).toBeCloseTo(1, 9);
      expect(right[0] * up[0] + right[1] * up[1] + right[2] * up[2]).toBeCloseTo(0, 9);
    }
  });

  /**
   * Caso tabelado com a convenção de eixos do palco: azimute 0 põe a câmera em +Z
   * olhando para −Z, e aí a direita da tela é +X. Um seno com sinal trocado passaria
   * por todos os testes de norma e perpendicularidade acima — e inverteria o
   * deslocamento.
   */
  it("com azimute 0 a direita da tela é o leste", () => {
    const { right, up } = screenBasis(0, 0);
    expect(right[0]).toBeCloseTo(1, 9);
    expect(right[2]).toBeCloseTo(0, 9);
    expect(up[1]).toBeCloseTo(1, 9);
  });

  /** E os dois giram junto com a câmera: azimute 90 põe a direita da tela no norte. */
  it("com azimute 90 a direita da tela é o norte", () => {
    const { right } = screenBasis(90, 0);
    expect(right[0]).toBeCloseTo(0, 9);
    expect(right[2]).toBeCloseTo(-1, 9);
  });

  /**
   * Com a câmera inclinada, o "para cima" da tela inclina junto. Numa câmera a 45°
   * olhando para baixo, subir na tela tem de afastar o alvo — não subir na vertical do
   * mundo, que deixaria o cenário deslizando.
   */
  it("o para-cima da tela acompanha a inclinação da câmera", () => {
    const { up } = screenBasis(0, 45);
    expect(up[1]).toBeCloseTo(Math.cos((45 * Math.PI) / 180), 9);
    expect(up[2]).toBeCloseTo(-Math.sin((45 * Math.PI) / 180), 9);
  });
});

describe("orbitByDrag", () => {
  /**
   * Convenção de "agarrar o cenário": arrastar para a direita empurra o objeto para a
   * direita, e para isso a câmera gira para o outro lado — azimute **diminui**.
   */
  it("arrastar para a direita diminui o azimute", () => {
    expect(orbitByDrag(state(), 100, 0).azimuthDeg).toBeLessThan(35);
  });

  it("arrastar para baixo aumenta a elevação", () => {
    expect(orbitByDrag(state(), 0, 100).elevationDeg).toBeGreaterThan(14);
  });

  /**
   * A elevação satura no limite do domínio, e é aqui **também**, não só dentro de
   * `orbitCameraPosition`. Sem isto, arrastar dez telas para cima guardaria 400° e o
   * dono teria de arrastar dez telas de volta antes de a imagem reagir — a câmera
   * pareceria travada.
   */
  it("a elevação satura em vez de acumular fora do domínio", () => {
    const alto = orbitByDrag(state(), 0, 100_000);
    const baixo = orbitByDrag(state(), 0, -100_000);
    expect(alto.elevationDeg).toBe(MAX_ELEVATION_DEG);
    expect(baixo.elevationDeg).toBe(-MAX_ELEVATION_DEG);
  });

  /** Orbitar não muda alvo nem distância: é rotação em torno do que se olha. */
  it("não move o alvo nem a distância", () => {
    const antes = state({ target: [3, 1, -2] });
    const depois = orbitByDrag(antes, 120, -40);
    expect(depois.target).toEqual(antes.target);
    expect(depois.distanceMeters).toBe(antes.distanceMeters);
  });

  /**
   * O azimute pode sair de [0, 360) e isso é de propósito: `orbitCameraPosition` usa
   * seno e cosseno, que são periódicos, e normalizar aqui criaria a costura 0/360 no
   * meio de um arrasto contínuo — a família de defeito de 09-CONTINUIDADE § 4.17.
   */
  it("o azimute atravessa a costura sem salto na posição da câmera", () => {
    let atual = state({ azimuthDeg: 5, elevationDeg: 0 });
    const posicoes = [orbitCameraPosition(atual)];
    for (let i = 0; i < 8; i += 1) {
      atual = orbitByDrag(atual, 25, 0);
      posicoes.push(orbitCameraPosition(atual));
    }
    // Nenhum passo pode dar um salto muito maior que os outros: salto é sinal de
    // normalização mordendo no meio do gesto.
    const saltos = posicoes.slice(1).map((p, i) => {
      const anterior = posicoes[i] ?? p;
      return Math.hypot(p[0] - anterior[0], p[1] - anterior[1], p[2] - anterior[2]);
    });
    const maior = Math.max(...saltos);
    const menor = Math.min(...saltos);
    expect(maior / Math.max(1e-9, menor)).toBeLessThan(1.5);
  });
});

describe("panByDrag", () => {
  /** Arrastar para a direita leva o alvo para o oeste: o cenário vai com a mão. */
  it("arrastar para a direita move o alvo para o lado oposto", () => {
    const depois = panByDrag(state({ azimuthDeg: 0 }), 100, 0, 38, 800);
    expect(depois.target[0]).toBeLessThan(0);
  });

  it("arrastar para baixo sobe o alvo", () => {
    const depois = panByDrag(state({ azimuthDeg: 0, elevationDeg: 0 }), 0, 100, 38, 800);
    expect(depois.target[1]).toBeGreaterThan(0);
  });

  it("não muda ângulos nem distância", () => {
    const antes = state();
    const depois = panByDrag(antes, 50, 50, 38, 800);
    expect(depois.azimuthDeg).toBe(antes.azimuthDeg);
    expect(depois.elevationDeg).toBe(antes.elevationDeg);
    expect(depois.distanceMeters).toBe(antes.distanceMeters);
  });

  /**
   * O deslocamento escala com a distância, e é isso que faz o gesto parecer que o dono
   * agarrou o cenário: o mesmo arrasto move pouco de perto e muito de longe, mantendo
   * o objeto sob o cursor.
   */
  it("o mesmo arrasto move mais de longe que de perto", () => {
    const perto = panByDrag(state({ distanceMeters: 4, azimuthDeg: 0 }), 100, 0, 38, 800);
    const longe = panByDrag(state({ distanceMeters: 400, azimuthDeg: 0 }), 100, 0, 38, 800);
    expect(Math.abs(longe.target[0])).toBeGreaterThan(Math.abs(perto.target[0]) * 50);
  });
});

describe("zoomByWheel", () => {
  it("roda para baixo afasta, roda para cima aproxima", () => {
    expect(zoomByWheel(state(), 120).distanceMeters).toBeGreaterThan(40);
    expect(zoomByWheel(state(), -120).distanceMeters).toBeLessThan(40);
  });

  /**
   * Multiplicativo, não aditivo: o mesmo giro de roda tem de **sentir** igual a 40 m e
   * a 4 m. Com passo aditivo, a roda que ajusta bem longe atravessa o objeto de perto.
   */
  it("o passo é proporcional à distância", () => {
    const de40 = zoomByWheel(state({ distanceMeters: 40 }), 120).distanceMeters / 40;
    const de4 = zoomByWheel(state({ distanceMeters: 4 }), 120).distanceMeters / 4;
    expect(de40).toBeCloseTo(de4, 9);
  });

  /** Rodar para dentro sem parar não pode pôr a câmera dentro do alvo. */
  it("nunca chega a zero", () => {
    let atual = state({ distanceMeters: 40 });
    for (let i = 0; i < 500; i += 1) atual = zoomByWheel(atual, -240);
    expect(atual.distanceMeters).toBeGreaterThanOrEqual(MIN_ORBIT_DISTANCE_METERS);
  });
});

describe("effectiveStageCamera", () => {
  const stage = {
    target: [0, 0, 0] as readonly [number, number, number],
    distanceMeters: 40,
    azimuthDeg: 35,
    elevationDeg: 14,
    floor: "#39424f",
  };

  it("sem câmera de autoria devolve o palco do documento intacto", () => {
    expect(effectiveStageCamera(stage, null)).toBe(stage);
  });

  it("com câmera de autoria substitui só os quatro números da câmera", () => {
    const efetivo = effectiveStageCamera(
      stage,
      state({ target: [5, 2, -1], distanceMeters: 12, azimuthDeg: 200, elevationDeg: 60 }),
    );
    expect(efetivo.target).toEqual([5, 2, -1]);
    expect(efetivo.distanceMeters).toBe(12);
    expect(efetivo.azimuthDeg).toBe(200);
    expect(efetivo.elevationDeg).toBe(60);
    // O resto do palco é do documento: a câmera de autoria é ponto de vista, não tema.
    expect(efetivo.floor).toBe("#39424f");
  });
});

describe("metersPerPixel e o limiar de arrasto", () => {
  it("cresce com a distância e cai com a altura do painel", () => {
    expect(metersPerPixel(80, 38, 800)).toBeCloseTo(metersPerPixel(40, 38, 800) * 2, 9);
    expect(metersPerPixel(40, 38, 1600)).toBeCloseTo(metersPerPixel(40, 38, 800) / 2, 9);
  });

  it("sobrevive a painel de altura zero em vez de devolver Infinity", () => {
    expect(Number.isFinite(metersPerPixel(40, 38, 0))).toBe(true);
  });

  /**
   * O limiar existe para clique e arrasto conviverem no mesmo botão, que é o pedido:
   * mover o cenário livremente **e** marcar pontos, sem trocar de modo. Pequeno o
   * bastante para não engolir a intenção de girar, grande o bastante para a mão
   * trêmula ainda marcar.
   */
  it("o limiar é pequeno e positivo", () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThan(0);
    expect(DRAG_THRESHOLD_PX).toBeLessThan(10);
  });
});
