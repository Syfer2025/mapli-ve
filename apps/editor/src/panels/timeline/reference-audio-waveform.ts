import type { ReferenceAudioAnalysis } from "@theatrum/engine";

export interface WaveformViewport {
  readonly startFrame: number;
  readonly pixelsPerFrame: number;
}

export interface VisibleWaveformBar {
  readonly frame: number;
  readonly x: number;
  readonly width: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Projeta os buckets do engine para a mesma escala frame→pixel da Timeline.
 * Somente frames visíveis são percorridos; zoom e pan permanecem sincronizados.
 */
export function visibleWaveformBars(
  analysis: ReferenceAudioAnalysis,
  viewport: WaveformViewport,
  width: number,
  height: number,
): readonly VisibleWaveformBar[] {
  if (
    !Number.isFinite(viewport.startFrame) ||
    !Number.isFinite(viewport.pixelsPerFrame) ||
    viewport.pixelsPerFrame <= 0 ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return Object.freeze([]);
  }
  const firstFrame = Math.max(analysis.track.startFrame, Math.floor(viewport.startFrame) - 1);
  const lastFrame = Math.min(
    analysis.track.endFrameExclusive,
    Math.ceil(viewport.startFrame + width / viewport.pixelsPerFrame) + 1,
  );
  const center = height / 2;
  const amplitude = Math.max(0, center - 3);
  const bars: VisibleWaveformBar[] = [];
  for (let frame = firstFrame; frame < lastFrame; frame++) {
    const sample = analysis.waveform[frame - analysis.track.startFrame];
    if (sample === undefined) continue;
    bars.push(
      Object.freeze({
        frame,
        x: (frame - viewport.startFrame) * viewport.pixelsPerFrame,
        width: Math.max(1, viewport.pixelsPerFrame),
        minY: center - sample.max * amplitude,
        maxY: center - sample.min * amplitude,
      }),
    );
  }
  return Object.freeze(bars);
}
