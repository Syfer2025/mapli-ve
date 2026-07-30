/**
 * Redução box determinística do ADR-024.
 *
 * O navegador não participa do filtro: recebe-se RGBA8 já composto, acumulam-se
 * blocos inteiros em ordem fixa e escreve-se RGBA8 final. Somente aritmética
 * inteira é usada, inclusive no arredondamento, para o mesmo buffer produzir os
 * mesmos bytes em qualquer CPU.
 */

export interface BoxDownsampleInput {
  /** Pixels RGBA8, linha a linha de cima para baixo. */
  readonly rgba: Uint8Array;
  /** Dimensões do buffer ampliado. Precisam ser divisíveis pelo fator. */
  readonly width: number;
  readonly height: number;
  /** Amostras por eixo. */
  readonly factor: number;
  /**
   * Recorte final depois do box.
   *
   * O ADR-022 exige dimensões pares para vídeo. Quando o box produz um lado
   * ímpar, omitir a última coluna/linha aqui é o corte declarado — nunca uma
   * escala espacial.
   */
  readonly outputWidth?: number;
  readonly outputHeight?: number;
}

export class SupersamplingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupersamplingError";
  }
}

/** Divisão inteira com empate arredondado para cima. */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

/**
 * Reduz RGBA8 por box em sRGB, com alfa premultiplicado.
 *
 * `destination` é opcional para teste e uso avulso. O compositor passa sempre o
 * mesmo buffer entre frames; assim SS2 em 1080p não aloca outros 8 MiB a cada
 * volta do pump.
 */
export function downsampleRgbaBox(input: BoxDownsampleInput, destination?: Uint8Array): Uint8Array {
  const { rgba, width, height, factor } = input;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new SupersamplingError(`dimensão de render inválida: ${width}×${height}`);
  }
  if (!Number.isInteger(factor) || factor <= 0) {
    throw new SupersamplingError(`fator box inválido: ${String(factor)}`);
  }
  const expectedBytes = width * height * 4;
  if (rgba.byteLength !== expectedBytes) {
    throw new SupersamplingError(
      `RGBA incompatível: esperava ${expectedBytes} bytes para ${width}×${height}, ` +
        `recebi ${rgba.byteLength}`,
    );
  }
  if (width % factor !== 0 || height % factor !== 0) {
    throw new SupersamplingError(
      `${width}×${height} não forma blocos inteiros de ${factor}×${factor}`,
    );
  }

  const boxWidth = width / factor;
  const boxHeight = height / factor;
  const outputWidth = input.outputWidth ?? boxWidth;
  const outputHeight = input.outputHeight ?? boxHeight;
  if (
    !Number.isInteger(outputWidth) ||
    outputWidth <= 0 ||
    outputWidth > boxWidth ||
    !Number.isInteger(outputHeight) ||
    outputHeight <= 0 ||
    outputHeight > boxHeight
  ) {
    throw new SupersamplingError(
      `recorte ${String(outputWidth)}×${String(outputHeight)} não cabe no box ` +
        `${boxWidth}×${boxHeight}`,
    );
  }

  const outputBytes = outputWidth * outputHeight * 4;
  const result = destination ?? new Uint8Array(outputBytes);
  if (result.byteLength !== outputBytes) {
    throw new SupersamplingError(
      `destino incompatível: esperava ${outputBytes} bytes, recebi ${result.byteLength}`,
    );
  }

  if (factor === 1) {
    // Identidade verdadeira, inclusive RGB escondido sob alfa zero. O caminho
    // normal do compositor nem chama o redutor em fator 1; esta defesa mantém a
    // função pura com o mesmo contrato.
    const sourceStride = width * 4;
    const outputStride = outputWidth * 4;
    for (let y = 0; y < outputHeight; y += 1) {
      const source = y * sourceStride;
      result.set(rgba.subarray(source, source + outputStride), y * outputStride);
    }
    return result;
  }

  const samples = factor * factor;
  let target = 0;
  for (let outputY = 0; outputY < outputHeight; outputY += 1) {
    const sourceY = outputY * factor;
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const sourceX = outputX * factor;
      let alphaSum = 0;
      let redAlphaSum = 0;
      let greenAlphaSum = 0;
      let blueAlphaSum = 0;

      for (let boxY = 0; boxY < factor; boxY += 1) {
        let source = ((sourceY + boxY) * width + sourceX) * 4;
        for (let boxX = 0; boxX < factor; boxX += 1) {
          const alpha = rgba[source + 3] as number;
          alphaSum += alpha;
          redAlphaSum += (rgba[source] as number) * alpha;
          greenAlphaSum += (rgba[source + 1] as number) * alpha;
          blueAlphaSum += (rgba[source + 2] as number) * alpha;
          source += 4;
        }
      }

      if (alphaSum === 0) {
        result[target] = 0;
        result[target + 1] = 0;
        result[target + 2] = 0;
      } else {
        result[target] = divideHalfUp(redAlphaSum, alphaSum);
        result[target + 1] = divideHalfUp(greenAlphaSum, alphaSum);
        result[target + 2] = divideHalfUp(blueAlphaSum, alphaSum);
      }
      result[target + 3] = divideHalfUp(alphaSum, samples);
      target += 4;
    }
  }

  return result;
}
