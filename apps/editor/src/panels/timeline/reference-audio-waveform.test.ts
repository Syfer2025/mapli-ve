import type { ReferenceAudioAnalysis } from "@theatrum/engine";
import { describe, expect, it } from "vitest";
import { visibleWaveformBars } from "./reference-audio-waveform.js";

const analysis: ReferenceAudioAnalysis = {
  track: {
    assetId: "assets/audio.wav",
    name: "Áudio",
    sampleRate: 48_000,
    channels: 1,
    fps: 24,
    startFrame: 10,
    endFrameExclusive: 13,
    durationFrames: 3,
    sampleFrames: 6_000,
    durationSeconds: 0.125,
    pcmChecksum: "crc32:00000000",
  },
  waveform: [
    {
      frame: 10,
      startSample: 0,
      endSampleExclusive: 2_000,
      sampleFrames: 2_000,
      min: -1,
      max: 0.5,
      peak: 1,
      rms: 0.5,
    },
    {
      frame: 11,
      startSample: 2_000,
      endSampleExclusive: 4_000,
      sampleFrames: 2_000,
      min: -0.25,
      max: 0.25,
      peak: 0.25,
      rms: 0.2,
    },
    {
      frame: 12,
      startSample: 4_000,
      endSampleExclusive: 6_000,
      sampleFrames: 2_000,
      min: -0.5,
      max: 1,
      peak: 1,
      rms: 0.6,
    },
  ],
};

describe("projeção da waveform na Timeline", () => {
  it("usa exatamente a escala e o deslocamento de frames da Timeline", () => {
    const bars = visibleWaveformBars(analysis, { startFrame: 9, pixelsPerFrame: 4 }, 20, 40);
    expect(bars.map(({ frame, x, width }) => ({ frame, x, width }))).toEqual([
      { frame: 10, x: 4, width: 4 },
      { frame: 11, x: 8, width: 4 },
      { frame: 12, x: 12, width: 4 },
    ]);
    expect(bars[0]).toMatchObject({ minY: 11.5, maxY: 37 });
  });

  it("descarta buckets fora da janela visível", () => {
    const bars = visibleWaveformBars(analysis, { startFrame: 11, pixelsPerFrame: 10 }, 10, 20);
    expect(bars.map(({ frame }) => frame)).toEqual([10, 11, 12]);
  });

  it("falha fechado para viewport inválido", () => {
    expect(visibleWaveformBars(analysis, { startFrame: 0, pixelsPerFrame: 0 }, 100, 40)).toEqual(
      [],
    );
  });
});
