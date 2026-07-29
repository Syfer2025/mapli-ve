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
  /**
   * Os pontos de interesse do frame, com a ancoragem já resolvida.
   *
   * **É isto que faz um rótulo apontar para o míssil em vez do avião inteiro.** Antes
   * só `model3d` entrava no layout, então `label.callout` só conseguia mirar a âncora do
   * objeto todo — e o pedido do dono é anotar a **peça**: _"marcar o míssil do avião e
   * uma animação de textbox aparecer"_. Um POI é exatamente "um lugar do objeto com
   * nome", e ele já existe no documento desde o ADR-015.
   *
   * Nenhuma linha nova do lado do rótulo: ele procura o alvo em `layout.layouts` por id,
   * e agora encontra o id de um ponto.
   */
  pois: readonly { readonly id: string; readonly point: readonly [number, number, number] }[] = [],
): LayoutScreenScene {
  if (models.length === 0 && pois.length === 0) return layout;
  const layouts = new Map(layout.layouts);
  const place = (id: string, position: readonly [number, number, number]): void => {
    const current = layouts.get(id);
    if (current === undefined) return;
    const screen = studio.project(position, size[0], size[1]);
    if (screen === null) {
      layouts.set(id, { ...current, culled: true });
      return;
    }
    /**
     * A caixa é a **área que o objeto ocupa na tela**, não um ponto.
     *
     * Era `width: 0, height: 0`, e essa era a razão de o rótulo cobrir a
     * aeronave: quem decide onde pôr a caixa de texto lê `bounds` do alvo, e um
     * alvo sem área nunca está no caminho de nada. Com o raio projetado, o passe
     * de rótulo passa a ter o que comparar.
     *
     * `anchorPx` continua sendo o **centro**: é para onde a guia aponta, e mudar
     * isso faria o rótulo mirar o canto da caixa em vez do objeto. Ponto de
     * interesse não tem raio e continua com caixa de área zero, que é correto —
     * um ponto não ocupa área.
     */
    const radius = studio.screenRadius(id, size[0], size[1]) ?? 0;
    layouts.set(id, {
      ...current,
      matrix: mat2d.translate(screen[0], screen[1]),
      anchorPx: screen,
      bounds: {
        x: screen[0] - radius,
        y: screen[1] - radius,
        width: radius * 2,
        height: radius * 2,
      },
      culled: false,
    });
  };
  for (const model of models) place(model.id, model.position);
  // Depois dos modelos, de propósito: se um id coincidisse, o ponto é a resposta mais
  // específica, e mais específico vence.
  for (const poi of pois) place(poi.id, poi.point);
  return { ...layout, layouts };
}
