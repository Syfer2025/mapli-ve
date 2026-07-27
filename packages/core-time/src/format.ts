/**
 * Apresentação de tempo. Nunca usado para persistência.
 */

import { framesToSeconds, framesToTimecode } from "./convert.js";
import { nominalFps, type Frame, type TimeBase } from "./units.js";

export type TimecodeStyle =
  /** `01:23:45:14` — HH:MM:SS:FF. Drop-frame usa `;` antes dos frames. */
  | "timecode"
  /** `1:23.500` — M:SS.mmm. O formato do playhead. */
  | "clock"
  /** `2.5s` */
  | "seconds"
  /** `90f` */
  | "frames"
  /** `1m30s` — compacto, legível, aceito de volta pelo parser. */
  | "compact";

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

export function format(f: Frame, base: TimeBase, style: TimecodeStyle = "timecode"): string {
  switch (style) {
    case "timecode": {
      const t = framesToTimecode(f, base);
      const frameSeparator = base.dropFrame ? ";" : ":";
      const digits = nominalFps(base) >= 100 ? 3 : 2;
      const body =
        `${pad(t.hours)}:${pad(t.minutes)}:${pad(t.seconds)}` +
        `${frameSeparator}${pad(t.frames, digits)}`;
      return t.negative ? `-${body}` : body;
    }

    case "clock": {
      const total = framesToSeconds(f, base);
      const negative = total < 0;
      const abs = Math.abs(total);
      const minutes = Math.floor(abs / 60);
      const secs = Math.floor(abs % 60);
      const millis = Math.round((abs - Math.floor(abs)) * 1000);
      const body = `${minutes}:${pad(secs)}.${pad(millis, 3)}`;
      return negative ? `-${body}` : body;
    }

    case "seconds": {
      const total = framesToSeconds(f, base);
      // Até 3 decimais, sem zeros à direita: 2.5s, não 2.500s.
      return `${Number.parseFloat(total.toFixed(3))}s`;
    }

    case "frames":
      return `${Math.round(f)}f`;

    case "compact": {
      const total = framesToSeconds(f, base);
      const negative = total < 0;
      const abs = Math.abs(total);
      const minutes = Math.floor(abs / 60);
      const secs = Number.parseFloat((abs % 60).toFixed(3));
      const body = minutes === 0 ? `${secs}s` : secs === 0 ? `${minutes}m` : `${minutes}m${secs}s`;
      return negative ? `-${body}` : body;
    }
  }
}

/** Duração legível para relatório de render: `1h 24m 18s`. */
export function formatDuration(f: Frame, base: TimeBase): string {
  const total = Math.abs(framesToSeconds(f, base));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}
