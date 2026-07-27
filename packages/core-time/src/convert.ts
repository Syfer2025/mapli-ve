/**
 * Conversões entre frames, segundos e componentes de timecode.
 */

import { frame, nominalFps, seconds, type Frame, type Seconds, type TimeBase } from "./units.js";

export function framesToSeconds(f: Frame, base: TimeBase): Seconds {
  return seconds(f / base.fps);
}

/**
 * Segundos → frames, arredondando **half-up**.
 *
 * A regra de arredondamento é documentada e testada porque governa onde um
 * keyframe cai: `"1.008s"` a 60 fps dá frame 60,48 → 60. Um Scene Script emite
 * aviso quando o arredondamento desloca o tempo em mais de meio frame.
 */
export function secondsToFrames(s: Seconds, base: TimeBase): Frame {
  return frame(s * base.fps);
}

/** Duração em frames de um intervalo em segundos, sem arredondar. */
export function exactFrames(s: Seconds, base: TimeBase): number {
  return s * base.fps;
}

export interface TimecodeParts {
  readonly negative: boolean;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly frames: number;
}

const DROP_FACTOR = 0.066666;

interface DropFrameConstants {
  readonly dropped: number;
  readonly perMinute: number;
  readonly per10Minutes: number;
}

function dropFrameConstants(base: TimeBase): DropFrameConstants {
  const nominal = nominalFps(base);
  const dropped = Math.round(base.fps * DROP_FACTOR);
  return {
    dropped,
    perMinute: nominal * 60 - dropped,
    per10Minutes: nominal * 60 * 10 - 9 * dropped,
  };
}

/**
 * Número de frame → componentes de timecode.
 *
 * Em drop-frame, números de quadro são **saltados** a cada minuto (exceto a
 * cada décimo) para que o timecode não derive do tempo de parede — o relógio
 * anda a 30 rótulos por segundo enquanto o vídeo anda a 29,97 quadros.
 * Nenhum quadro de imagem é descartado; só rótulos.
 */
export function framesToTimecode(f: Frame, base: TimeBase): TimecodeParts {
  const negative = f < 0;
  let count = Math.abs(Math.round(f));
  const nominal = nominalFps(base);

  if (base.dropFrame) {
    const { dropped, perMinute, per10Minutes } = dropFrameConstants(base);
    const tenMinuteBlocks = Math.floor(count / per10Minutes);
    const remainder = count % per10Minutes;

    count += dropped * 9 * tenMinuteBlocks;
    if (remainder > dropped) {
      count += dropped * Math.floor((remainder - dropped) / perMinute);
    }
  }

  return {
    negative,
    hours: Math.floor(count / (nominal * 3600)),
    minutes: Math.floor(count / (nominal * 60)) % 60,
    seconds: Math.floor(count / nominal) % 60,
    frames: count % nominal,
  };
}

/** Componentes de timecode → número de frame. Inverso de `framesToTimecode`. */
export function timecodeToFrames(parts: TimecodeParts, base: TimeBase): Frame {
  const nominal = nominalFps(base);
  let count =
    parts.hours * nominal * 3600 +
    parts.minutes * nominal * 60 +
    parts.seconds * nominal +
    parts.frames;

  if (base.dropFrame) {
    const { dropped } = dropFrameConstants(base);
    const totalMinutes = parts.hours * 60 + parts.minutes;
    count -= dropped * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  return frame(parts.negative ? -count : count);
}

/**
 * Recalcula um tempo ao mudar o fps da composição, **preservando os segundos**.
 *
 * É a opção "remapear" do diálogo de mudança de fps. A alternativa,
 * "reinterpretar", preserva o número do frame e altera a duração — e é só não
 * chamar esta função. Nunca implícito: ver docs/03-DATA-MODEL.md § 2.
 */
export function remapFrame(f: Frame, from: TimeBase, to: TimeBase): Frame {
  return secondsToFrames(framesToSeconds(f, from), to);
}
