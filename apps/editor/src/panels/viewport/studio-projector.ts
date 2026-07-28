/**
 * Projetor do palco, para o passe de layout do painel do Palco 3D.
 *
 * O layout precisa de um `ProjectorPort` para decidir onde cada nó cai em pixels.
 * No mapa é o MapLibre; aqui não existe mapa, e a pergunta certa não é "como
 * projeto geografia no palco?" — é **geografia não existe no palco**. Um contorno
 * de país ou uma unidade ancorada em Kursk não têm lugar numa vitrine de
 * equipamento.
 *
 * Então este projetor manda todo ponto geográfico para longe da tela, de propósito:
 * o layout descarta (`culled`) o que cai fora do viewport, e nó geo simplesmente
 * não desenha. É a resposta honesta. A alternativa — inventar uma projeção
 * plausível — colocaria a Ucrânia flutuando sobre o piso do estúdio.
 *
 * Quem tem lugar aqui é nó em espaço `comp` (títulos, rótulos), que usa
 * `compToScreen` e nunca passa por este projetor, e `model3d`, cuja posição de
 * tela vem da câmera orbital via `withStudioProjection`.
 */

import type { ProjectorPort, ProjectorSnapshot } from "@theatrum/gis";
import { mat2d, type Vec2 } from "@theatrum/core-math";
import type { ScreenScene as LayoutScreenScene } from "@theatrum/scene-graph";
import type { StudioModelState, StudioSceneRuntime } from "./studio-scene.js";

/**
 * Longe o suficiente para o layout descartar em qualquer viewport praticável, e
 * finito o suficiente para não contaminar aritmética com `Infinity` — um `NaN`
 * escapando daqui apareceria como nó invisível sem explicação, três camadas acima.
 */
const OFF_SCREEN = 1e7;

export function createStudioProjectorPort(viewport: Vec2, fovDeg: number): ProjectorPort {
  return {
    project: () => [OFF_SCREEN, OFF_SCREEN],
    unproject: () => [0, 0],
    /**
     * Escala aproximada do palco, para nó dimensionado em metros de terreno.
     * Vale a altura da tela dividida pelo campo de visão em radianos — a mesma
     * conta do `cameraToCenterDistance`, e boa o bastante para um caso que quase
     * não ocorre: no palco o tamanho vem de `scaleMeters`, não de `size.ground`.
     */
    metersPerPixel: () => {
      const halfFov = Math.max(0.01, (fovDeg * Math.PI) / 360);
      return (2 * Math.tan(halfFov)) / Math.max(1, viewport[1]);
    },
    // Sem rotação de mapa a compensar: o que gira aqui é a câmera, e o ângulo
    // dela já entra na projeção do modelo.
    bearingToScreenAngle: (bearing: number) => bearing,
    elevationAt: () => null,
    snapshot: (): ProjectorSnapshot => ({
      projection: "mercator",
      center: [0, 0],
      zoom: 0,
      bearing: 0,
      pitch: 0,
      viewport: [viewport[0], viewport[1]],
      tileSize: 512,
    }),
  };
}

/**
 * Põe os `model3d` do palco no layout de tela, projetando a posição 3D deles.
 *
 * É o que faz um `label.callout` encontrar a asa do caça sem uma linha de código
 * nova do lado do rótulo: ele já procura o alvo em `layout.layouts`, e aqui quem
 * preenche essa entrada é a câmera orbital.
 *
 * Isto morava no `SceneOverlay` como pós-processamento — corrigia entradas que o
 * projetor do mapa havia preenchido errado. Com o palco em painel próprio
 * ([ADR-014](../../../../../docs/adr/ADR-014-studio-own-panel.md)) deixou de ser
 * remendo: é o passe de projeção deste painel, no lugar dele.
 *
 * Modelo atrás da câmera vira `culled`, não uma posição inventada: projeção com
 * w negativo devolve coordenada espelhada, e um rótulo apontando para o canto
 * oposto da tela é pior do que rótulo nenhum.
 */
export function withStudioProjection(
  layout: LayoutScreenScene,
  models: readonly StudioModelState[],
  studio: StudioSceneRuntime,
  size: Vec2,
): LayoutScreenScene {
  if (models.length === 0) return layout;
  const layouts = new Map(layout.layouts);
  for (const model of models) {
    const current = layouts.get(model.id);
    if (current === undefined) continue;
    const screen = studio.project(model.position, size[0], size[1]);
    if (screen === null) {
      layouts.set(model.id, { ...current, culled: true });
      continue;
    }
    layouts.set(model.id, {
      ...current,
      matrix: mat2d.translate(screen[0], screen[1]),
      anchorPx: screen,
      bounds: { x: screen[0], y: screen[1], width: 0, height: 0 },
      culled: false,
    });
  }
  return { ...layout, layouts };
}
