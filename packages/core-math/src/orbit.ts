/**
 * Câmera orbital: as coordenadas esféricas que o modo estúdio anima por keyframe.
 *
 * Está em L0, longe do Three.js, por um motivo que o [ADR-003](../../../docs/adr/ADR-003-determinism.md)
 * torna obrigatório: a posição da câmera é parte do que o export precisa
 * reproduzir byte a byte. Função pura de quatro números, testável sem GPU.
 *
 * Convenção de eixos — a do Three.js, e ela é o oposto da do mapa:
 *
 * - **X** leste, **Y** para cima, **Z** para o sul.
 * - **Azimute** em graus, medido a partir do sul (+Z) girando para o leste (+X).
 *   Azimute 0 põe a câmera na frente do modelo se o nariz dele aponta para o sul.
 * - **Elevação** em graus acima do horizonte. 0 é rasante ao chão, 90 é zenital.
 */

import { DEG_TO_RAD, clamp } from "./scalar.js";
import type { Vec3 } from "./vec.js";

/** Estado orbital que o nó `studio.stage` guarda e o keyframe anima. */
export interface OrbitState {
  /** Centro da órbita, em metros no espaço do palco. */
  readonly target: Vec3;
  /** Distância da câmera ao alvo, em metros. */
  readonly distanceMeters: number;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
}

/**
 * Elevação máxima em módulo. Exatamente 90° põe a câmera sobre o polo, onde a
 * direção "para cima" da câmera fica paralela ao eixo de visão e a matriz de
 * observação degenera — a imagem gira sem controle em torno de si mesma. Um
 * grau de folga é invisível e mantém a base ortonormal bem condicionada.
 */
export const MAX_ELEVATION_DEG = 89;

/** Distância mínima. Zero colocaria a câmera dentro do alvo. */
export const MIN_ORBIT_DISTANCE_METERS = 0.01;

/**
 * Posição da câmera no espaço do palco.
 *
 * Os limites são aplicados **aqui**, não em quem chama: a mesma clamp precisa
 * valer para a interação de mouse, para o valor digitado no Inspector e para o
 * resultado interpolado entre dois keyframes. Um keyframe em 88° e outro em 92°
 * passa por 90° no meio, e a interpolação não pergunta a ninguém antes.
 */
export function orbitCameraPosition(state: OrbitState): Vec3 {
  const distance = Math.max(MIN_ORBIT_DISTANCE_METERS, state.distanceMeters);
  const elevation = clamp(state.elevationDeg, -MAX_ELEVATION_DEG, MAX_ELEVATION_DEG) * DEG_TO_RAD;
  const azimuth = state.azimuthDeg * DEG_TO_RAD;
  const horizontal = distance * Math.cos(elevation);
  return [
    state.target[0] + horizontal * Math.sin(azimuth),
    state.target[1] + distance * Math.sin(elevation),
    state.target[2] + horizontal * Math.cos(azimuth),
  ];
}

/**
 * O caminho de volta: de uma posição de câmera para o estado orbital.
 *
 * É o que transforma arrastar o mouse em keyframe. Sem ele, a órbita
 * interativa e a órbita animada seriam duas representações diferentes da mesma
 * câmera, e a primeira vez que alguém gravasse um keyframe depois de arrastar,
 * a câmera saltaria.
 */
export function orbitStateFromPosition(position: Vec3, target: Vec3): OrbitState {
  const dx = position[0] - target[0];
  const dy = position[1] - target[1];
  const dz = position[2] - target[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance < MIN_ORBIT_DISTANCE_METERS) {
    return { target, distanceMeters: MIN_ORBIT_DISTANCE_METERS, azimuthDeg: 0, elevationDeg: 0 };
  }
  const horizontal = Math.hypot(dx, dz);
  return {
    target,
    distanceMeters: distance,
    azimuthDeg: Math.atan2(dx, dz) / DEG_TO_RAD,
    elevationDeg: Math.atan2(dy, horizontal) / DEG_TO_RAD,
  };
}

/**
 * Distância que enquadra uma esfera de raio `radius` num campo de visão
 * vertical de `fovDeg`, com folga.
 *
 * Serve o botão "enquadrar": um caça de 18 m e um porta-aviões de 330 m
 * precisam da mesma composição na tela, e ninguém quer descobrir o número certo
 * girando a roda do mouse. A conta usa o campo **vertical** porque é o que o
 * `PerspectiveCamera` define; em janela mais larga que alta, o horizontal é
 * maior e a folga cresce sozinha — errar para o lado de sobrar é o lado certo.
 */
export function orbitDistanceToFit(radius: number, fovDeg: number, margin = 1.35): number {
  const half = (clamp(fovDeg, 1, 179) / 2) * DEG_TO_RAD;
  return Math.max(MIN_ORBIT_DISTANCE_METERS, (radius * margin) / Math.sin(half));
}
