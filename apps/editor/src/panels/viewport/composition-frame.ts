/**
 * A moldura da composição sobre o preview.
 *
 * É a mitigação declarada do
 * [ADR-022](../../../../../docs/adr/ADR-022-export-resolution-from-composition.md):
 * com o tamanho do frame vindo da composição, **o preview deixa de ser o
 * enquadramento** sempre que a proporção do painel difere da dela. O painel desta
 * máquina é 2032×800; a composição, 1920×1080. Quem olha a tela vê uma faixa
 * larga; o vídeo sai quadrado por comparação, e nada dizia isso.
 *
 * Mora no canvas de **gizmos**, que está na `EXCLUDED_SURFACE_SELECTORS` do
 * `frame-composer` — então "não sai no vídeo" é propriedade da lista, não
 * consequência de alguém lembrar de desligar. É a mesma escolha que os marcadores
 * de ponto de interesse fizeram no ADR-015, e pelo mesmo motivo.
 *
 * A conta fica aqui, separada do desenho, porque é a parte que pode errar em
 * silêncio: uma moldura no lugar errado é pior que moldura nenhuma — ela mente
 * com confiança sobre o que vai sair no arquivo.
 */

/** Retângulo em pixels de tela onde a composição cai dentro do painel. */
export interface CompositionFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * A moldura cobre o painel inteiro?
   *
   * Verdadeiro durante o export, quando as superfícies foram conduzidas ao
   * tamanho da composição — e aí não há nada a avisar, porque preview e arquivo
   * coincidem. Quem desenha usa isto para não pintar um retângulo exatamente em
   * cima da borda do painel, que só suja a imagem.
   */
  readonly fills: boolean;
}

/**
 * Onde a composição cai no painel.
 *
 * Mesma conta de `compositionToViewport`, que é `min(vw/cw, vh/ch)` — e tem de
 * ser a mesma, senão a moldura marca um enquadramento e o render usa outro.
 * A origem é (0,0), não centralizada, porque é ali que o `compToScreen` do layout
 * põe a composição: centralizar a guia sem centralizar o render desenharia a
 * moldura ao lado do conteúdo que ela deveria cercar.
 */
export function compositionFrameRect(
  composition: { readonly width: number; readonly height: number },
  surface: readonly [number, number],
): CompositionFrameRect | null {
  const [surfaceWidth, surfaceHeight] = surface;
  if (
    composition.width <= 0 ||
    composition.height <= 0 ||
    surfaceWidth <= 0 ||
    surfaceHeight <= 0
  ) {
    return null;
  }
  const scale = Math.min(surfaceWidth / composition.width, surfaceHeight / composition.height);
  const width = composition.width * scale;
  const height = composition.height * scale;
  // Tolerância de meio pixel: `min` produz um dos dois eixos exato e o outro
  // sujeito a arredondamento de ponto flutuante, e um resíduo de 1e-13 faria a
  // moldura aparecer durante o export, onde ela não tem o que avisar.
  const fills = surfaceWidth - width < 0.5 && surfaceHeight - height < 0.5;
  return { x: 0, y: 0, width, height, fills };
}

/** Cor da guia. Fria e translúcida: é chrome, não conteúdo. */
const GUIDE_STROKE = "rgb(120 190 255 / 0.55)";
/** O que fica de fora escurece, que é como toda ferramenta de vídeo diz "corte". */
const OUTSIDE_FILL = "rgb(8 11 16 / 0.55)";

/**
 * Desenha a moldura e escurece o que fica fora dela.
 *
 * Escurecer é o que faz a informação chegar sem ser lida: uma linha sozinha some
 * sobre um mapa cheio de traço claro, e o dono descobriria o corte no arquivo
 * final. Nada é desenhado quando a moldura cobre o painel inteiro.
 */
export function drawCompositionFrame(
  context: CanvasRenderingContext2D,
  composition: { readonly width: number; readonly height: number },
  surface: readonly [number, number],
): void {
  const frame = compositionFrameRect(composition, surface);
  if (frame === null || frame.fills) return;
  const [surfaceWidth, surfaceHeight] = surface;

  context.save();
  context.fillStyle = OUTSIDE_FILL;
  // Duas faixas bastam porque a moldura nasce em (0,0): a que sobra à direita e a
  // que sobra embaixo. Uma delas tem largura zero, e `fillRect` de zero é no-op.
  context.fillRect(frame.width, 0, surfaceWidth - frame.width, surfaceHeight);
  context.fillRect(0, frame.height, frame.width, surfaceHeight - frame.height);

  context.strokeStyle = GUIDE_STROKE;
  context.lineWidth = 1;
  context.setLineDash([]);
  // Meio pixel para o traço de 1 px cair sobre a grade de pixels em vez de
  // borrar entre duas colunas.
  context.strokeRect(0.5, 0.5, frame.width - 1, frame.height - 1);
  context.restore();
}
