import { subframe, type Frame } from "@theatrum/core-time";

/** Configuração temporal do job. Ausente significa export legado, sem blur. */
export interface MotionBlurSpec {
  /** Ângulo de obturador em graus. Zero desliga. */
  readonly shutterAngle: number;
  /** Amostras temporais por frame de saída. Uma desliga. */
  readonly samples: number;
}

/** Configuração validada e os valores que o pump deve realmente executar. */
export interface PlannedMotionBlur extends MotionBlurSpec {
  readonly enabled: boolean;
  readonly effectiveSamples: number;
  /** Largura da janela temporal, em frames da composição. */
  readonly exposureFrames: number;
}

/** O painel oferece poucos degraus explícitos; a API aceita até o teto validado. */
export const MOTION_BLUR_SAMPLE_COUNTS = [1, 4, 8] as const;
export const MOTION_BLUR_SHUTTER_ANGLES = [90, 180, 360] as const;
export const DEFAULT_SHUTTER_ANGLE = 180;
export const DEFAULT_MOTION_BLUR_SAMPLES = 1;
export const MAX_MOTION_BLUR_SAMPLES = 64;
export const MOTION_BLUR_SETTLE_REFERENCE_MS = 100;

export class MotionBlurError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MotionBlurError";
  }
}

/**
 * Valida uma vez, antes de abrir pasta ou mover o playhead.
 *
 * O caminho desligado tem uma amostra efetiva mesmo quando a configuração pediu
 * oito com ângulo zero: isto é o que permite ao pump contornar inteiramente o
 * acumulador e preservar os bytes do export anterior.
 */
export function planMotionBlur(spec?: MotionBlurSpec | null): PlannedMotionBlur {
  const shutterAngle = spec?.shutterAngle ?? DEFAULT_SHUTTER_ANGLE;
  const samples = spec?.samples ?? DEFAULT_MOTION_BLUR_SAMPLES;
  if (!Number.isFinite(shutterAngle) || shutterAngle < 0 || shutterAngle > 360) {
    throw new MotionBlurError(
      `ângulo de obturador inválido: ${String(shutterAngle)}°; use de 0° a 360°`,
    );
  }
  if (!Number.isInteger(samples) || samples < 1 || samples > MAX_MOTION_BLUR_SAMPLES) {
    throw new MotionBlurError(
      `amostras de motion blur inválidas: ${String(samples)}; use um inteiro de 1 a ${String(MAX_MOTION_BLUR_SAMPLES)}`,
    );
  }
  const enabled = shutterAngle > 0 && samples > 1;
  return Object.freeze({
    shutterAngle,
    samples,
    enabled,
    effectiveSamples: enabled ? samples : 1,
    exposureFrames: enabled ? shutterAngle / 360 : 0,
  });
}

/**
 * Pontos médios dos N estratos da janela do obturador.
 *
 * A expressão usa multiplicação sobre o índice, nunca soma acumulada. Nas bordas
 * limita à composição inteira, e não ao trecho do job: um recorte ainda recebe
 * movimento dos frames vizinhos que existem no documento.
 */
export function motionBlurSampleFrames(
  centerFrame: number,
  durationFrames: number,
  plan: PlannedMotionBlur,
): readonly Frame[] {
  if (!Number.isFinite(centerFrame)) {
    throw new MotionBlurError(`frame central inválido: ${String(centerFrame)}`);
  }
  if (!Number.isInteger(durationFrames) || durationFrames <= 0) {
    throw new MotionBlurError(`duração inválida: ${String(durationFrames)} frames`);
  }
  const lastFrame = durationFrames - 1;
  const clampToComposition = (value: number): Frame =>
    subframe(Math.max(0, Math.min(lastFrame, value)));
  if (!plan.enabled) return Object.freeze([clampToComposition(centerFrame)]);

  const firstEdge = centerFrame - plan.exposureFrames / 2;
  const frames: Frame[] = [];
  for (let index = 0; index < plan.effectiveSamples; index += 1) {
    const value = firstEdge + (plan.exposureFrames * (index + 0.5)) / plan.effectiveSamples;
    frames.push(clampToComposition(value));
  }
  return Object.freeze(frames);
}

/**
 * Referência anterior ao clique: custo de settle, não promessa de duração total.
 *
 * Render, box espacial, encode e finalização ficam deliberadamente fora. O valor
 * padrão de 100 ms é o p99 arredondado registrado no ADR-025.
 */
export function estimateMotionBlurSettleMs(
  outputFrames: number,
  plan: PlannedMotionBlur,
  perSampleMs = MOTION_BLUR_SETTLE_REFERENCE_MS,
): number {
  if (!Number.isInteger(outputFrames) || outputFrames < 0) {
    throw new MotionBlurError(`contagem de frames inválida: ${String(outputFrames)}`);
  }
  if (!Number.isFinite(perSampleMs) || perSampleMs < 0) {
    throw new MotionBlurError(`referência de settle inválida: ${String(perSampleMs)} ms`);
  }
  return outputFrames * plan.effectiveSamples * perSampleMs;
}

/** Estrutura mínima compartilhada com o compositor, sem depender do aplicativo. */
export interface RgbaFrame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/**
 * Acumulador temporal RGBA8 sRGB com alfa pré-multiplicado.
 *
 * O `Float32Array` e o destino RGBA são alocados na primeira amostra do job e
 * depois somente zerados/reutilizados. Mudar a resolução no meio é erro: um
 * arquivo de vídeo não representa isso e uma sequência esconderia o defeito.
 */
export class MotionBlurAccumulator {
  #sums: Float32Array | null = null;
  #output: Uint8Array | null = null;
  #width = 0;
  #height = 0;
  #samples = 0;
  #allocations = 0;
  #resolvedFrames = 0;

  begin(width: number, height: number): void {
    const bytes = checkedRgbaBytes(width, height);
    if (this.#sums === null || this.#output === null) {
      this.#sums = new Float32Array(bytes);
      this.#output = new Uint8Array(bytes);
      this.#width = width;
      this.#height = height;
      this.#allocations += 1;
    } else {
      if (width !== this.#width || height !== this.#height) {
        throw new MotionBlurError(
          `resolução mudou durante o motion blur: ${String(this.#width)}×${String(this.#height)} → ${String(width)}×${String(height)}`,
        );
      }
      this.#sums.fill(0);
    }
    this.#samples = 0;
  }

  add(frame: RgbaFrame): void {
    const sums = this.#sums;
    if (sums === null) throw new MotionBlurError("acumulador não iniciado");
    if (frame.width !== this.#width || frame.height !== this.#height) {
      throw new MotionBlurError(
        `subframe fora da resolução: ${String(frame.width)}×${String(frame.height)}; esperado ${String(this.#width)}×${String(this.#height)}`,
      );
    }
    if (frame.rgba.byteLength !== sums.length) {
      throw new MotionBlurError(
        `subframe RGBA incompleto: ${String(frame.rgba.byteLength)} bytes; esperado ${String(sums.length)}`,
      );
    }
    const source = frame.rgba;
    for (let offset = 0; offset < source.length; offset += 4) {
      const alpha = source[offset + 3] as number;
      sums[offset] = (sums[offset] as number) + (source[offset] as number) * alpha;
      sums[offset + 1] = (sums[offset + 1] as number) + (source[offset + 1] as number) * alpha;
      sums[offset + 2] = (sums[offset + 2] as number) + (source[offset + 2] as number) * alpha;
      sums[offset + 3] = (sums[offset + 3] as number) + alpha;
    }
    this.#samples += 1;
  }

  resolve(expectedSamples?: number): RgbaFrame {
    const sums = this.#sums;
    const output = this.#output;
    if (sums === null || output === null || this.#samples === 0) {
      throw new MotionBlurError("nenhuma amostra para resolver");
    }
    if (expectedSamples !== undefined && this.#samples !== expectedSamples) {
      throw new MotionBlurError(
        `acumulação parcial: ${String(this.#samples)}/${String(expectedSamples)} amostras`,
      );
    }
    for (let offset = 0; offset < sums.length; offset += 4) {
      const alphaSum = sums[offset + 3] as number;
      const resolvedAlpha = halfUpByte(alphaSum / this.#samples);
      if (resolvedAlpha === 0) {
        output[offset] = 0;
        output[offset + 1] = 0;
        output[offset + 2] = 0;
        output[offset + 3] = 0;
        continue;
      }
      output[offset] = halfUpByte((sums[offset] as number) / alphaSum);
      output[offset + 1] = halfUpByte((sums[offset + 1] as number) / alphaSum);
      output[offset + 2] = halfUpByte((sums[offset + 2] as number) / alphaSum);
      output[offset + 3] = resolvedAlpha;
    }
    this.#resolvedFrames += 1;
    return { width: this.#width, height: this.#height, rgba: output };
  }

  get allocations(): number {
    return this.#allocations;
  }

  get bytes(): number {
    return (this.#sums?.byteLength ?? 0) + (this.#output?.byteLength ?? 0);
  }

  get floatBytes(): number {
    return this.#sums?.byteLength ?? 0;
  }

  get resolvedFrames(): number {
    return this.#resolvedFrames;
  }

  dispose(): void {
    this.#sums = null;
    this.#output = null;
    this.#width = 0;
    this.#height = 0;
    this.#samples = 0;
  }
}

function checkedRgbaBytes(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new MotionBlurError(`resolução inválida: ${String(width)}×${String(height)}`);
  }
  const bytes = width * height * 4;
  if (!Number.isSafeInteger(bytes)) {
    throw new MotionBlurError(`resolução grande demais: ${String(width)}×${String(height)}`);
  }
  return bytes;
}

function halfUpByte(value: number): number {
  return Math.max(0, Math.min(255, Math.floor(value + 0.5)));
}
