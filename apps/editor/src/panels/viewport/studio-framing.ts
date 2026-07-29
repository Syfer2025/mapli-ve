/**
 * Enquadramento de uma visita a ponto de interesse.
 *
 * O pedido do dono: _"as transições dos pontos de interesse devem sempre ser fluidos e
 * contar com passagens mais suaves e enquadramentos melhores do objeto"_.
 *
 * **O defeito objetivo que havia aqui.** A distância da visita era `raio × 0,9`, e essa
 * conta ignora o **campo de visão**. Com `fovDeg` em 20 a mesma distância mostra um quarto
 * do que mostra em 60 — então o enquadramento "certo" mudava sozinho quando alguém tocava
 * na lente, e o número 0,9 não tinha de onde sair. `orbitDistanceToFit` responde a
 * pergunta certa — "que distância enquadra uma esfera de raio r com esta lente?" — e já
 * estava em L0 desde o ADR-012 com o docstring dizendo "serve o botão enquadrar".
 *
 * **E por que uma fração do objeto, não o objeto todo.** Visitar o míssil não é enquadrar
 * o caça: é chegar perto o suficiente para ver a peça e longe o suficiente para saber
 * onde ela fica. Enquadrar o raio inteiro daria a mesma vista do plano geral, e o roteiro
 * inteiro pareceria a câmera parada.
 */

import { orbitDistanceToFit } from "@theatrum/core-math";

/**
 * Quanto do objeto entra em quadro numa visita.
 *
 * 35% do raio mostra a peça com o contexto de onde ela está no veículo. Mais que isso e a
 * visita vira plano geral; menos e a tela enche de superfície sem referência — o
 * espectador vê metal e não sabe do que o narrador está falando.
 */
const POI_CONTEXT_FRACTION = 0.35;

/** Piso do raio enquadrado, em metros. Evita distância degenerada em objeto minúsculo. */
const MIN_CONTEXT_RADIUS_METERS = 0.35;

export interface PoiFramingInput {
  /** Ângulos da câmera no instante da marcação — a vista que o dono escolheu. */
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  /** Lente do palco. É o que faltava na conta antiga. */
  readonly fovDeg: number;
}

export interface PoiFraming {
  readonly distanceMeters: number;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
}

/**
 * O enquadramento com que um ponto nasce.
 *
 * Os ângulos são os da câmera no momento da marcação: o dono girou o palco até ver a
 * cabine e clicou nela, então a visita tem de reproduzir **aquela** vista, não um ângulo
 * padrão que mostraria o outro lado do veículo.
 *
 * Sem raio de modelo — GLB ainda em parse, que o chamador já barra — sobra um enquadramento
 * de 12 m, o padrão do tipo de nó, que é razoável para equipamento de porte médio.
 */
export function poiFramingFor(
  camera: PoiFramingInput,
  modelRadiusMeters: number | null,
): PoiFraming {
  const distanceMeters =
    modelRadiusMeters === null || !Number.isFinite(modelRadiusMeters) || modelRadiusMeters <= 0
      ? 12
      : orbitDistanceToFit(
          Math.max(MIN_CONTEXT_RADIUS_METERS, modelRadiusMeters * POI_CONTEXT_FRACTION),
          camera.fovDeg,
        );
  return {
    // O teto de 500 m é o mesmo do vão máximo de um objeto no palco: mais longe que isso
    // não é visita, é plano geral de um palco que não tem o que mostrar tão longe.
    distanceMeters: Math.max(0.5, Math.min(500, distanceMeters)),
    azimuthDeg: camera.azimuthDeg,
    elevationDeg: camera.elevationDeg,
  };
}
