/**
 * Tempo com unidade no tipo.
 *
 * Frames e segundos são os dois números mais fáceis de confundir num editor de
 * vídeo, e confundi-los custa um fator de 60. As marcas (`brands`) tornam a
 * troca um erro de compilação em vez de uma animação com duração errada.
 *
 * Ver docs/adr/ADR-004-time-in-frames.md.
 */

declare const FrameBrand: unique symbol;
declare const SecondsBrand: unique symbol;

/** Unidade canônica. Sempre inteiro quando persistido. */
export type Frame = number & { readonly [FrameBrand]: "frame" };

/** Derivado. Nunca persistido como tempo de keyframe. */
export type Seconds = number & { readonly [SecondsBrand]: "seconds" };

export interface TimeBase {
  /** Quadros por segundo. Para NTSC use o valor real: 29.97, não 30. */
  readonly fps: number;
  /**
   * Timecode drop-frame. Só válido para fps NTSC (29.97 / 59.94), onde o
   * timecode salta números de quadro para não derivar do tempo de parede.
   */
  readonly dropFrame: boolean;
}

export const FPS_PRESETS = [24, 25, 29.97, 30, 50, 59.94, 60, 120] as const;

export function timeBase(fps: number, dropFrame = false): TimeBase {
  return { fps, dropFrame };
}

/** Arredonda para inteiro (half-up) e marca como Frame. */
export function frame(value: number): Frame {
  return Math.round(value) as Frame;
}

/** Marca sem arredondar. Só para amostragem subframe de motion blur. */
export function subframe(value: number): Frame {
  return value as Frame;
}

export function seconds(value: number): Seconds {
  return value as Seconds;
}

/**
 * Operações que preservam a marca. Existem porque `f + 1` devolve `number`
 * puro — as marcas custam esta pequena cerimônia nas bordas e, em troca,
 * impedem a classe inteira de bug de fator-fps.
 */
export const frames = {
  add(a: Frame, delta: number): Frame {
    return (a + delta) as Frame;
  },
  sub(a: Frame, b: Frame): number {
    return a - b;
  },
  clamp(value: Frame, min: Frame, max: Frame): Frame {
    return (value < min ? min : value > max ? max : value) as Frame;
  },
  min(a: Frame, b: Frame): Frame {
    return (a < b ? a : b) as Frame;
  },
  max(a: Frame, b: Frame): Frame {
    return (a > b ? a : b) as Frame;
  },
  isInteger(value: Frame): boolean {
    return Number.isInteger(value);
  },
} as const;

/** fps nominal (inteiro) usado na aritmética de timecode. 29.97 → 30. */
export function nominalFps(base: TimeBase): number {
  return Math.round(base.fps);
}

/** Drop-frame só faz sentido em fps NTSC. */
export function isDropFrameValid(base: TimeBase): boolean {
  if (!base.dropFrame) return true;
  return Math.abs(base.fps - 29.97) < 0.01 || Math.abs(base.fps - 59.94) < 0.01;
}
