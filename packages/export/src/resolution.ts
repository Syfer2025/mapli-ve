/**
 * O tamanho do frame de export: função pura da composição e da escala do job.
 *
 * Existe porque o tamanho do frame vinha da **janela** — do divisor do dockview,
 * do tamanho do painel, de qual aba estava na frente. Isso é um buraco na regra
 * central do projeto, que diz que o render é função de (documento, frame) e que o
 * documento é a única verdade. O
 * [ADR-022](../../../docs/adr/ADR-022-export-resolution-from-composition.md) põe o
 * tamanho de volta na composição, onde `width` e `height` já estavam declarados e
 * eram ignorados na saída.
 *
 * Aqui mora só a **conta**, sem DOM e sem GPU, pelo mesmo motivo que o
 * `frame-plan.ts`: é a parte que decide, é a parte que pode errar em silêncio, e é
 * a única que dá para afirmar em teste sem placa de vídeo.
 */

/** Escolha de resolução de um job de export. */
export interface ExportResolutionInput {
  /** `composition.width`. */
  readonly compositionWidth: number;
  /** `composition.height`. */
  readonly compositionHeight: number;
  /**
   * Multiplicador sobre o tamanho autorado. 1 é a composição como ela é; 2 dobra
   * cada eixo. Vive no job e não no documento porque é preferência de saída, como
   * `outputFps` e o trecho — não conteúdo.
   */
  readonly scale?: number;
  /**
   * Quantas amostras por eixo o export renderiza antes de reduzir.
   *
   * Inteiro e positivo. Vive no job, não no documento, e não muda a resolução
   * final: fator 2 em uma saída 1920×1080 conduz as superfícies a 3840×2160 e
   * devolve 1920×1080 depois do box determinístico (ADR-024).
   */
  readonly supersampling?: number;
  /**
   * Teto por eixo, em pixels. Padrão medido: o `maxCanvasSize` do MapLibre, que é
   * **[4096, 4096]** na construção e **baixa o pixel ratio em silêncio** quando
   * estourado — pedir 7680×4320 devolveu 4096×2304 sem erro nenhum. Estourar em
   * silêncio é pior que recusar, então aqui o estouro é recusado e nomeado.
   */
  readonly maxDimension?: number;
}

export interface ExportResolution {
  /**
   * Tamanho em pixels de **CSS** a que as superfícies são conduzidas. É o tamanho
   * da composição, e por isso `compToScreen` vira exatamente `pixelRatio` — na
   * escala 1, a identidade. Um nó autorado sai no tamanho em que foi autorado.
   */
  readonly layout: readonly [number, number];
  /** Multiplicador pedido para a saída, separado da resolução interna. */
  readonly scale: number;
  /** Fator inteiro do box. 1 preserva o caminho anterior sem redutor. */
  readonly supersampling: number;
  /**
   * Multiplicador do backing store. Vai para `map.setPixelRatio`, Pixi e Three.
   * É `scale × supersampling`, nunca a escala que deve aparecer como tamanho do
   * arquivo na interface.
   */
  readonly renderPixelRatio: number;
  /**
   * Tamanho físico que as superfícies precisam alcançar antes da redução.
   *
   * É calculado com o mesmo `Math.round(layout × renderPixelRatio)` usado pelos
   * backends. Nomeá-lo impede o compositor de delegar a redução a `drawImage`.
   */
  readonly render: readonly [number, number];
  /** Tamanho final do frame, em pixels. Par nos dois eixos por construção. */
  readonly output: readonly [number, number];
  /**
   * Por que a saída não é `layout × pixelRatio` exato, quando não é.
   *
   * `"even"` significa que um eixo perdeu um pixel para o H.264, que amostra
   * croma a cada dois e não tem meia amostra. Nomear é o que impede alguém de
   * perseguir a diferença de um pixel achando que é bug de conta.
   */
  readonly adjustedFor: readonly ("even" | "none")[];
}

export class ExportResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportResolutionError";
  }
}

/** Teto medido nesta base: `maxCanvasSize` do MapLibre na construção. */
export const DEFAULT_MAX_DIMENSION = 4096;

/**
 * Escalas oferecidas na interface.
 *
 * Meia resolução existe para revisão rápida, e é a única razão pela qual a escala
 * é multiplicador em vez de resolução absoluta: "metade da obra" continua sendo a
 * obra, com a mesma proporção e o mesmo enquadramento. Digitar 960×540 à mão
 * abriria a porta para uma proporção que não é a da composição, e aí o
 * enquadramento muda sem ninguém pedir.
 */
export const EXPORT_SCALES: readonly number[] = Object.freeze([0.5, 1, 2]);

/** Fatores oferecidos na interface. A API aceita qualquer inteiro que caiba. */
export const EXPORT_SUPERSAMPLING_FACTORS: readonly number[] = Object.freeze([1, 2]);

/** Arredonda para baixo até o par mais próximo. Ver `evenSize` no encoder. */
function toEven(value: number): number {
  return value - (value % 2);
}

/**
 * O tamanho do frame, e o que fazer com as superfícies para chegar nele.
 *
 * Recusa em vez de ajustar quando o pedido não cabe. A tentação é cortar para o
 * teto e seguir — e é exatamente o que o MapLibre faz, em silêncio, e o que
 * custou uma sonda inteira para descobrir. Um export de 8K que sai 4K sem avisar
 * é pior que um export que não começa.
 */
export function planExportResolution(input: ExportResolutionInput): ExportResolution {
  const scale = input.scale ?? 1;
  const supersampling = input.supersampling ?? 1;
  const maxDimension = input.maxDimension ?? DEFAULT_MAX_DIMENSION;

  if (!Number.isInteger(input.compositionWidth) || input.compositionWidth <= 0) {
    throw new ExportResolutionError(
      `largura da composição inválida: ${String(input.compositionWidth)}`,
    );
  }
  if (!Number.isInteger(input.compositionHeight) || input.compositionHeight <= 0) {
    throw new ExportResolutionError(
      `altura da composição inválida: ${String(input.compositionHeight)}`,
    );
  }
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new ExportResolutionError(`escala inválida: ${String(scale)}`);
  }
  if (!Number.isInteger(supersampling) || supersampling <= 0) {
    throw new ExportResolutionError(
      `fator de supersampling inválido: ${String(supersampling)}; use inteiro positivo`,
    );
  }
  if (!Number.isInteger(maxDimension) || maxDimension <= 0) {
    throw new ExportResolutionError(`teto por eixo inválido: ${String(maxDimension)}`);
  }

  const rawWidth = Math.round(input.compositionWidth * scale);
  const rawHeight = Math.round(input.compositionHeight * scale);
  if (rawWidth < 2 || rawHeight < 2) {
    throw new ExportResolutionError(
      `escala ${scale} reduz ${input.compositionWidth}×${input.compositionHeight} a ` +
        `${rawWidth}×${rawHeight}, abaixo do mínimo de 2 px por eixo`,
    );
  }
  const renderPixelRatio = scale * supersampling;
  const renderWidth = Math.round(input.compositionWidth * renderPixelRatio);
  const renderHeight = Math.round(input.compositionHeight * renderPixelRatio);
  if (renderWidth > maxDimension || renderHeight > maxDimension) {
    throw new ExportResolutionError(
      `${renderWidth}×${renderHeight} de render (saída ${rawWidth}×${rawHeight}, ` +
        `supersampling ${supersampling}×) passa do teto de ${maxDimension} px por eixo. ` +
        `O teto é o maxCanvasSize do MapLibre, fixado na construção do mapa ` +
        `(ADR-022); subi-lo exige medir o efeito no mapa ao vivo em tela HiDPI.`,
    );
  }
  if (
    supersampling > 1 &&
    (renderWidth % supersampling !== 0 ||
      renderHeight % supersampling !== 0 ||
      renderWidth / supersampling !== rawWidth ||
      renderHeight / supersampling !== rawHeight)
  ) {
    throw new ExportResolutionError(
      `supersampling ${supersampling}× exige blocos inteiros, mas a escala ${scale} ` +
        `produz render ${renderWidth}×${renderHeight} para saída ` +
        `${rawWidth}×${rawHeight}. Ajuste a escala ou use fator 1 (ADR-024).`,
    );
  }

  const width = toEven(rawWidth);
  const height = toEven(rawHeight);
  const adjusted: ("even" | "none")[] = [];
  if (width !== rawWidth || height !== rawHeight) adjusted.push("even");
  if (adjusted.length === 0) adjusted.push("none");

  return Object.freeze({
    layout: Object.freeze([input.compositionWidth, input.compositionHeight] as const),
    scale,
    supersampling,
    renderPixelRatio,
    render: Object.freeze([renderWidth, renderHeight] as const),
    output: Object.freeze([width, height] as const),
    adjustedFor: Object.freeze(adjusted),
  });
}

/**
 * Rótulo curto para a barra de status e o painel de fila.
 *
 * O usuário precisa ver a resolução de saída **antes** de exportar, porque com o
 * ADR-022 o preview deixa de ser o enquadramento quando a proporção do painel
 * difere da da composição. Um número na tela é a mitigação declarada.
 */
export function describeExportResolution(resolution: ExportResolution): string {
  const [width, height] = resolution.output;
  const escala = resolution.scale === 1 ? "" : ` · ${resolution.scale}×`;
  const supersampling =
    resolution.supersampling === 1
      ? ""
      : ` · SS ${resolution.supersampling}× (render ${resolution.render[0]}×${resolution.render[1]})`;
  const par = resolution.adjustedFor.includes("even") ? " (par para H.264)" : "";
  return `${width}×${height}${escala}${supersampling}${par}`;
}
