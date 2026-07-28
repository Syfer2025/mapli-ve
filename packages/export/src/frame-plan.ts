/**
 * O plano de frames de um export: exatamente quais frames, em que ordem, com
 * que nome de arquivo.
 *
 * É função pura de propósito, e é a peça em que o critério byte-idêntico da
 * [Fase 8](../../../docs/08-ROADMAP.md#fase-8--exportação) se apoia primeiro:
 * duas execuções do mesmo projeto têm de percorrer **a mesma lista**, na mesma
 * ordem. Se o plano depender de tempo, de arredondamento de ponto flutuante
 * acumulado ou da ordem de um `Object.keys`, o resto não tem salvação.
 *
 * Nada aqui conhece GPU, disco nem codec.
 */

/** Trecho a exportar, em frames da composição. Inclusivo nas duas pontas. */
export interface FrameRange {
  readonly first: number;
  readonly last: number;
}

export interface ExportPlanInput {
  readonly compositionId: string;
  /** Duração total da composição, em frames. */
  readonly durationFrames: number;
  /** Taxa da composição. Usada para o passo quando a saída tem outra taxa. */
  readonly compositionFps: number;
  /** Taxa do arquivo de saída. Igual à da composição no caso normal. */
  readonly outputFps?: number;
  /** Sem trecho, exporta a composição inteira. */
  readonly range?: FrameRange;
  /** Prefixo dos arquivos. Sem barras nem extensão. */
  readonly basename?: string;
}

export interface PlannedFrame {
  /** Índice na sequência de saída, começando em zero. */
  readonly index: number;
  /**
   * Frame da composição a avaliar. **Inteiro**: o avaliador é indexado por
   * frame, e passar 12,4 significaria interpolar duas vezes — uma aqui e outra
   * lá dentro — com resultados que dependem da ordem.
   */
  readonly frame: number;
  /** Nome do arquivo, com contagem zero-padded e extensão. */
  readonly filename: string;
}

export interface ExportPlan {
  readonly compositionId: string;
  readonly frames: readonly PlannedFrame[];
  readonly outputFps: number;
  /** Duração real da saída em segundos, derivada da contagem e da taxa. */
  readonly durationSeconds: number;
}

/** Erros de plano são de programação ou de entrada do usuário, não de runtime. */
export class ExportPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportPlanError";
  }
}

/**
 * Quantos dígitos o contador do nome de arquivo precisa.
 *
 * Fixo por plano, e calculado do total: `frame_9.png` e `frame_10.png` ordenam
 * errado em qualquer listagem alfabética, e é exatamente assim que um `ffmpeg
 * -pattern_type glob` monta o vídeo com os frames trocados de lugar. Mínimo de
 * quatro porque é o que a maioria das ferramentas espera ver.
 */
export function counterDigits(total: number): number {
  return Math.max(4, String(Math.max(1, total)).length);
}

/**
 * Plano de export a partir da composição e do trecho pedido.
 *
 * O passo entre frames de saída sai de `compositionFps / outputFps` e é aplicado
 * por **multiplicação sobre o índice**, nunca por acumulação. Somar o passo a
 * cada iteração acumula erro de ponto flutuante: com passo 1/3, o frame 3000 de
 * um export sai deslocado, e o deslocamento depende de quantos frames vieram
 * antes — não-determinismo pela porta dos fundos.
 */
export function planExport(input: ExportPlanInput): ExportPlan {
  const outputFps = input.outputFps ?? input.compositionFps;
  if (!Number.isFinite(input.compositionFps) || input.compositionFps <= 0) {
    throw new ExportPlanError(`taxa da composição inválida: ${input.compositionFps}`);
  }
  if (!Number.isFinite(outputFps) || outputFps <= 0) {
    throw new ExportPlanError(`taxa de saída inválida: ${outputFps}`);
  }
  if (!Number.isInteger(input.durationFrames) || input.durationFrames <= 0) {
    throw new ExportPlanError(`duração inválida: ${input.durationFrames} frames`);
  }

  const last = input.durationFrames - 1;
  const requested = input.range ?? { first: 0, last };
  const first = clampInteger(requested.first, 0, last);
  const end = clampInteger(requested.last, first, last);

  const step = input.compositionFps / outputFps;
  const spanFrames = end - first;
  // Quantos frames de saída cabem no trecho. `floor` mais um: o trecho é
  // inclusivo, então first==end dá exatamente um frame.
  const count = Math.floor(spanFrames / step) + 1;
  const digits = counterDigits(count);
  const basename = sanitizeBasename(input.basename ?? "frame");

  const frames: PlannedFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = first + index * step;
    // `round`, não `floor`: com passo fracionário, truncar puxa todo frame para
    // trás e a saída fica sistematicamente adiantada em relação ao áudio.
    const frame = Math.min(end, Math.round(raw));
    frames.push({
      index,
      frame,
      filename: `${basename}_${String(index).padStart(digits, "0")}.png`,
    });
  }

  return {
    compositionId: input.compositionId,
    frames: Object.freeze(frames),
    outputFps,
    durationSeconds: count / outputFps,
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/**
 * Prefixo seguro para nome de arquivo.
 *
 * Barra, dois-pontos e companhia saem porque o nome vem do usuário e vai virar
 * caminho: um projeto chamado `Kursk/Julho` criaria um diretório no meio do
 * export, ou falharia, dependendo do sistema. Ficar com um nome padrão é melhor
 * que qualquer das duas coisas.
 */
export function sanitizeBasename(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
  return cleaned === "" ? "frame" : cleaned;
}
