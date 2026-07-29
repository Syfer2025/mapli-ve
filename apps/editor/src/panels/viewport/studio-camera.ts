/**
 * Câmera de autoria do palco ([ADR-017](../../../../../docs/adr/ADR-017-studio-authoring-camera.md)).
 *
 * Arrastar o mouse no palco altera **este** estado, não o documento. O documento
 * continua sendo o que o export lê, e é isso que preserva o byte-idêntico da Fase 8
 * enquanto o dono gira o cenário para achar o míssil.
 *
 * **Por que no mesmo espaço de parâmetros do documento.** Uma câmera de voo livre —
 * matriz própria, olhar para qualquer lado — seria mais literal como "street view" e
 * tornaria "gravar enquadramento" uma **aproximação**: as seis props do `studio.stage`
 * não sabem representar _roll_ nem olhar fora do eixo, então gravar mudaria o
 * enquadramento que o dono acabou de compor. Aqui o que se compõe é exatamente o que se
 * grava.
 *
 * Módulo puro: entra estado e gesto, sai estado. Nenhum `three`, nenhum evento de DOM —
 * quem traduz pixel de mouse em número é o painel.
 */

import {
  clamp,
  DEG_TO_RAD,
  MAX_ELEVATION_DEG,
  MIN_ORBIT_DISTANCE_METERS,
  type OrbitState,
  type Vec3,
} from "@theatrum/core-math";

/**
 * Graus por pixel arrastado.
 *
 * 0,4°/px dá meia volta em 450 px, que é da ordem da largura do painel: uma passada
 * do mouse contorna o objeto. Mais que isso e o gesto fica nervoso perto do polo, onde
 * a elevação satura.
 */
const ORBIT_DEG_PER_PX = 0.4;

/**
 * Fator de zoom por unidade de roda.
 *
 * Multiplicativo, não aditivo: aproximar de 40 m para 39 m e de 4 m para 3 m são
 * gestos que o dono espera sentir iguais, e só a escala logarítmica entrega isso. Com
 * aditivo, a mesma roda que ajusta bem a 40 m atravessa o objeto a 4 m.
 */
const ZOOM_PER_WHEEL_UNIT = 0.0015;

/** Limiar que separa clique de arrasto, em pixels. Ver as consequências do ADR-017. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Base da tela no espaço do palco, para o deslocamento.
 *
 * `right` é horizontal por construção — deslocar lateralmente não deve subir nem
 * descer o alvo — e `up` acompanha a inclinação da câmera, senão arrastar para cima com
 * a câmera inclinada moveria o alvo para trás em vez de para cima na tela.
 */
export function screenBasis(
  azimuthDeg: number,
  elevationDeg: number,
): { readonly right: Vec3; readonly up: Vec3 } {
  const azimuth = azimuthDeg * DEG_TO_RAD;
  const elevation = clamp(elevationDeg, -MAX_ELEVATION_DEG, MAX_ELEVATION_DEG) * DEG_TO_RAD;
  const sinAzimuth = Math.sin(azimuth);
  const cosAzimuth = Math.cos(azimuth);
  const sinElevation = Math.sin(elevation);
  const cosElevation = Math.cos(elevation);
  return {
    right: [cosAzimuth, 0, -sinAzimuth],
    up: [-sinAzimuth * sinElevation, cosElevation, -cosAzimuth * sinElevation],
  };
}

/**
 * Metros de palco por pixel de tela, no plano que passa pelo alvo.
 *
 * É a escala que faz o deslocamento parecer que o dono agarrou o cenário: um objeto sob
 * o cursor acompanha o cursor. Sem ela, o mesmo arrasto moveria muito a 4 m e quase
 * nada a 400 m.
 */
export function metersPerPixel(
  distanceMeters: number,
  fovDeg: number,
  viewportHeightPx: number,
): number {
  const half = (clamp(fovDeg, 1, 179) / 2) * DEG_TO_RAD;
  return (
    (2 * Math.max(MIN_ORBIT_DISTANCE_METERS, distanceMeters) * Math.tan(half)) /
    Math.max(1, viewportHeightPx)
  );
}

/**
 * Orbitar por arrasto.
 *
 * Convenção de "agarrar o cenário": arrastar para a direita empurra o objeto para a
 * direita, o que faz a câmera girar para o outro lado — daí o azimute **diminuir**.
 * Arrastar para baixo puxa o topo do objeto na direção do observador, o que sobe a
 * câmera e **aumenta** a elevação.
 *
 * A elevação é limitada aqui **e** em `orbitCameraPosition`. Não é redundância inútil:
 * limitar aqui mantém o estado guardado dentro do domínio, e sem isso o dono poderia
 * arrastar dez telas para cima e depois precisar arrastar dez de volta antes de a
 * imagem reagir.
 */
export function orbitByDrag(state: OrbitState, deltaXPx: number, deltaYPx: number): OrbitState {
  return {
    ...state,
    azimuthDeg: state.azimuthDeg - deltaXPx * ORBIT_DEG_PER_PX,
    elevationDeg: clamp(
      state.elevationDeg + deltaYPx * ORBIT_DEG_PER_PX,
      -MAX_ELEVATION_DEG,
      MAX_ELEVATION_DEG,
    ),
  };
}

/** Deslocar o alvo no plano da tela. É o que transforma órbita em navegação livre. */
export function panByDrag(
  state: OrbitState,
  deltaXPx: number,
  deltaYPx: number,
  fovDeg: number,
  viewportHeightPx: number,
): OrbitState {
  const scale = metersPerPixel(state.distanceMeters, fovDeg, viewportHeightPx);
  const { right, up } = screenBasis(state.azimuthDeg, state.elevationDeg);
  return {
    ...state,
    target: [
      state.target[0] + (-right[0] * deltaXPx + up[0] * deltaYPx) * scale,
      state.target[1] + (-right[1] * deltaXPx + up[1] * deltaYPx) * scale,
      state.target[2] + (-right[2] * deltaXPx + up[2] * deltaYPx) * scale,
    ],
  };
}

/** Aproximar e afastar pela roda. */
export function zoomByWheel(state: OrbitState, deltaY: number): OrbitState {
  return {
    ...state,
    distanceMeters: Math.max(
      MIN_ORBIT_DISTANCE_METERS,
      state.distanceMeters * Math.exp(deltaY * ZOOM_PER_WHEEL_UNIT),
    ),
  };
}

/**
 * A câmera que o palco desenha neste frame: a de autoria se houver, senão a do
 * documento.
 *
 * Aplicada num lugar só, e é por isso que `pick`, `project` e os marcadores acompanham
 * sem código novo — todos leem a câmera do runtime, e o runtime recebe esta. Se cada
 * consumidor decidisse por conta qual câmera usar, o marcador poderia ficar num frame
 * atrás do palco.
 *
 * O resto do estado do palco — piso, grade, sombra, névoa — vem sempre do documento:
 * a câmera de autoria é um ponto de vista, não um tema.
 */
export function effectiveStageCamera<
  T extends {
    readonly target: readonly [number, number, number];
    readonly distanceMeters: number;
    readonly azimuthDeg: number;
    readonly elevationDeg: number;
  },
>(stage: T, authoring: OrbitState | null): T {
  if (authoring === null) return stage;
  return {
    ...stage,
    target: [authoring.target[0], authoring.target[1], authoring.target[2]],
    distanceMeters: authoring.distanceMeters,
    azimuthDeg: authoring.azimuthDeg,
    elevationDeg: authoring.elevationDeg,
  };
}
