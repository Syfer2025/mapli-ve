/**
 * Marcadores dos pontos de interesse do palco ([ADR-015](../../../../../docs/adr/ADR-015-studio-points-of-interest.md)).
 *
 * **Isto é chrome de autoria, não conteúdo da composição.** O ADR fala em mostrar
 * os marcadores "no overlay Pixi do palco", pelo argumento certo — o overlay já
 * existe e já desenha `label.callout`. Mas aquele overlay É composto no frame de
 * export (`.studio-viewport__pixi`, em `frame-composer.ts`), e um marcador saindo
 * por ele apareceria no vídeo sempre que alguém esquecesse o modo de marcação
 * ligado. O critério 8 da Fase 8 — nenhum elemento de UI em nenhum frame — está
 * escrito para ser atendido **por construção**, não por disciplina, e o canvas de
 * gizmos do Viewport (`.scene-overlay__ui`) é o precedente exato: superfície
 * própria, fora da lista que o compositor conhece.
 *
 * Então os marcadores vão num canvas 2D irmão, e a exclusão do export é uma
 * propriedade da lista de superfícies, não uma lembrança de desligar o modo.
 *
 * O que fica aqui é a parte que **decide**: projetar, numerar, descartar o que
 * está atrás da câmera e responder qual marcador está sob o cursor. Desenhar é
 * encanamento, e vem depois.
 */

import type { Vec2 } from "@theatrum/core-math";
import type { StudioPoiState } from "./studio-scene.js";

/**
 * Raio do alvo de clique, em pixels CSS. O disco desenhado tem 11; o alvo é
 * maior porque errar um marcador por dois pixels cria um ponto novo em cima do
 * antigo, e o usuário só descobre ao ver dois números empilhados.
 */
export const MARKER_HIT_RADIUS_PX = 16;

const MARKER_RADIUS_PX = 11;

export interface StudioMarker {
  readonly id: string;
  readonly name: string;
  /** 1-based: é o número que o dono lê na tela e cita no roteiro. */
  readonly ordinal: number;
  readonly screen: Vec2;
}

/**
 * Onde cada ponto de interesse cai na tela, na ordem de avaliação.
 *
 * Ponto atrás da câmera some do desenho e **não gasta número**: a numeração
 * seria instável ao girar a câmera, e "vá para o ponto 3" mudaria de significado
 * a cada frame. O ordinal vem da posição do ponto na lista, não da posição na
 * tela.
 */
export function layoutStudioMarkers(
  pois: readonly StudioPoiState[],
  project: (point: readonly [number, number, number]) => Vec2 | null,
): readonly StudioMarker[] {
  const markers: StudioMarker[] = [];
  for (const [index, poi] of pois.entries()) {
    const screen = project(poi.point);
    if (screen === null) continue;
    markers.push({
      id: poi.id,
      name: poi.name,
      ordinal: index + 1,
      screen,
    });
  }
  return markers;
}

/**
 * O marcador sob um pixel, ou `null`.
 *
 * Vence o **mais próximo**, não o primeiro da lista: com dois pontos próximos na
 * tela, escolher por ordem de documento seleciona o de baixo tanto quanto o de
 * cima, e o usuário não tem como saber qual vai ganhar.
 */
export function markerAt(
  markers: readonly StudioMarker[],
  x: number,
  y: number,
  radiusPx = MARKER_HIT_RADIUS_PX,
): StudioMarker | null {
  let best: StudioMarker | null = null;
  let bestDistance = radiusPx;
  for (const marker of markers) {
    const distance = Math.hypot(marker.screen[0] - x, marker.screen[1] - y);
    if (distance > bestDistance) continue;
    best = marker;
    bestDistance = distance;
  }
  return best;
}

export interface MarkerPaintOptions {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly selectedId: string | null;
}

/**
 * Pinta os marcadores. Limpa sempre, inclusive com a lista vazia — sair do modo
 * de marcação tem de apagar o que estava desenhado, e um canvas que só é limpo
 * quando há o que desenhar deixa o último quadro na tela para sempre.
 */
export function drawStudioMarkers(
  context: CanvasRenderingContext2D,
  markers: readonly StudioMarker[],
  options: MarkerPaintOptions,
): void {
  const { width, height, pixelRatio, selectedId } = options;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width * pixelRatio, height * pixelRatio);
  if (markers.length === 0) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (const marker of markers) {
    const [x, y] = marker.screen;
    const selected = marker.id === selectedId;

    // Contorno escuro antes do disco: um marcador claro sobre a fuselagem clara
    // de um caça desaparece, e este é um objeto que precisa ser visto sobre
    // qualquer modelo que o dono importar.
    context.beginPath();
    context.arc(x, y, MARKER_RADIUS_PX + 1.5, 0, Math.PI * 2);
    context.fillStyle = "rgba(8, 12, 18, 0.85)";
    context.fill();

    context.beginPath();
    context.arc(x, y, MARKER_RADIUS_PX, 0, Math.PI * 2);
    context.fillStyle = selected ? "#f2a13c" : "#5eead4";
    context.fill();

    context.fillStyle = "#0b1118";
    context.fillText(String(marker.ordinal), x, y + 0.5);

    if (marker.name !== "") {
      const label = marker.name;
      const textWidth = context.measureText(label).width;
      const boxX = x + MARKER_RADIUS_PX + 6;
      const boxY = y - 9;
      context.fillStyle = "rgba(8, 12, 18, 0.85)";
      context.fillRect(boxX, boxY, textWidth + 12, 18);
      context.fillStyle = selected ? "#f2a13c" : "#dbe4ee";
      context.textAlign = "left";
      context.fillText(label, boxX + 6, boxY + 9.5);
      context.textAlign = "center";
    }
  }
}
