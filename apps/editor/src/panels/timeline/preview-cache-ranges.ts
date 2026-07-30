export interface PreviewFrameRange {
  readonly startFrame: number;
  readonly endFrameExclusive: number;
}

/** Compacta frames isolados em trechos contíguos para a faixa verde da régua. */
export function previewFrameRanges(frames: readonly number[]): readonly PreviewFrameRange[] {
  const sorted = [...new Set(frames)]
    .filter((frame) => Number.isSafeInteger(frame) && frame >= 0)
    .sort((left, right) => left - right);
  const ranges: PreviewFrameRange[] = [];
  for (const frame of sorted) {
    const previous = ranges.at(-1);
    if (previous !== undefined && previous.endFrameExclusive === frame) {
      ranges[ranges.length - 1] = {
        startFrame: previous.startFrame,
        endFrameExclusive: frame + 1,
      };
    } else {
      ranges.push({ startFrame: frame, endFrameExclusive: frame + 1 });
    }
  }
  return Object.freeze(ranges.map((range) => Object.freeze(range)));
}
