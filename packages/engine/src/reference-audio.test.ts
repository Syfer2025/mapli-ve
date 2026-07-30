import { describe, expect, it } from "vitest";
import { checksumBytes } from "./checksum.js";
import {
  analyzeReferenceAudio,
  sampleBoundaryAtFrame,
  sampleRangeForTimelineFrame,
  waveformAtFrame,
} from "./reference-audio.js";

describe("análise determinística de áudio de referência", () => {
  it("mede min, max, pico e RMS em buckets alinhados aos frames", () => {
    const analysis = analyzeReferenceAudio({
      assetId: "asset_voice",
      name: "Narração",
      sampleRate: 4,
      channels: 1,
      fps: 2,
      startFrame: 10,
      pcm: new Float32Array([-1, -0.5, 0.5, 1]),
    });

    expect(analysis.track).toEqual({
      assetId: "asset_voice",
      name: "Narração",
      sampleRate: 4,
      channels: 1,
      fps: 2,
      startFrame: 10,
      endFrameExclusive: 12,
      durationFrames: 2,
      sampleFrames: 4,
      durationSeconds: 1,
      pcmChecksum: "crc32:d6e22cd7",
    });
    expect(analysis.waveform).toEqual([
      {
        frame: 10,
        startSample: 0,
        endSampleExclusive: 2,
        sampleFrames: 2,
        min: -1,
        max: -0.5,
        peak: 1,
        rms: Math.sqrt(0.625),
      },
      {
        frame: 11,
        startSample: 2,
        endSampleExclusive: 4,
        sampleFrames: 2,
        min: 0.5,
        max: 1,
        peak: 1,
        rms: Math.sqrt(0.625),
      },
    ]);
    expect(waveformAtFrame(analysis, 10)).toBe(analysis.waveform[0]);
    expect(waveformAtFrame(analysis, 9)).toBeNull();
    expect(waveformAtFrame(analysis, 12)).toBeNull();
  });

  it("analisa PCM estéreo intercalado sem perder canais", () => {
    const analysis = analyzeReferenceAudio({
      assetId: "asset_stereo",
      name: "Stereo",
      sampleRate: 2,
      channels: 2,
      fps: 1,
      pcm: new Float32Array([1, -1, 0.25, -0.5]),
    });

    expect(analysis.waveform).toEqual([
      expect.objectContaining({
        startSample: 0,
        endSampleExclusive: 2,
        sampleFrames: 2,
        min: -1,
        max: 1,
        peak: 1,
        rms: Math.sqrt((1 + 1 + 0.25 ** 2 + 0.5 ** 2) / 4),
      }),
    ]);
  });

  it("calcula cada fronteira de 29,97 fps de forma absoluta, sem deriva", () => {
    const sampleRate = 44_100;
    const fps = 30_000 / 1_001;
    let previousEnd = 0;
    for (let frame = 0; frame < 17_982; frame++) {
      const start = sampleBoundaryAtFrame(frame, sampleRate, fps);
      const end = sampleBoundaryAtFrame(frame + 1, sampleRate, fps);
      if (start !== previousEnd || end <= start) {
        throw new Error(`fronteira descontínua no frame ${frame}`);
      }
      previousEnd = end;
    }
    expect(previousEnd).toBe(Math.round((17_982 * sampleRate) / fps));
  });

  it("mapeia frame da timeline para amostras respeitando offset e último bucket", () => {
    const analysis = analyzeReferenceAudio({
      assetId: "asset_short",
      name: "Curto",
      sampleRate: 5,
      channels: 1,
      fps: 2,
      startFrame: 20,
      pcm: new Float32Array([0, 0.25, 0.5, 0.75, 1]),
    });

    expect(sampleRangeForTimelineFrame(analysis.track, 19)).toBeNull();
    expect(sampleRangeForTimelineFrame(analysis.track, 20)).toEqual([0, 3]);
    expect(sampleRangeForTimelineFrame(analysis.track, 21)).toEqual([3, 5]);
    expect(sampleRangeForTimelineFrame(analysis.track, 22)).toBeNull();
  });

  it("produz checksum estável, inclusive normalizando zero negativo", () => {
    const common = {
      assetId: "asset_checksum",
      name: "Checksum",
      sampleRate: 48_000,
      channels: 1,
      fps: 60,
    };
    const positive = analyzeReferenceAudio({
      ...common,
      pcm: new Float32Array([0, 0.25, -0.25]),
    });
    const negativeZero = analyzeReferenceAudio({
      ...common,
      pcm: new Float32Array([-0, 0.25, -0.25]),
    });
    const changed = analyzeReferenceAudio({
      ...common,
      pcm: new Float32Array([0, 0.25, -0.5]),
    });

    expect(positive.track.pcmChecksum).toBe(negativeZero.track.pcmChecksum);
    expect(changed.track.pcmChecksum).not.toBe(positive.track.pcmChecksum);
    expect(analyzeReferenceAudio({ ...common, pcm: new Float32Array([]) })).toMatchObject({
      track: { durationFrames: 0, sampleFrames: 0 },
      waveform: [],
    });
  });

  it("mantém o checksum canônico ao atravessar blocos da análise streaming", () => {
    const pcm = new Float32Array(4_097);
    const canonical = new Uint8Array(pcm.byteLength);
    const view = new DataView(canonical.buffer);
    for (let index = 0; index < pcm.length; index++) {
      const sample = (index % 17) / 16 - 0.5;
      pcm[index] = sample;
      view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, sample, true);
    }

    const analysis = analyzeReferenceAudio({
      assetId: "asset_streaming",
      name: "Streaming",
      sampleRate: 48_000,
      channels: 1,
      fps: 60,
      pcm,
    });
    expect(analysis.track.pcmChecksum).toBe(checksumBytes(canonical));
  });

  it("rejeita PCM ambíguo ou inválido em vez de corrigir silenciosamente", () => {
    const base = {
      assetId: "asset_invalid",
      name: "Inválido",
      sampleRate: 48_000,
      channels: 2,
      fps: 60,
    };
    expect(() => analyzeReferenceAudio({ ...base, pcm: new Float32Array([0, 1, 0]) })).toThrow(
      /mesmo número/,
    );
    expect(() => analyzeReferenceAudio({ ...base, pcm: new Float32Array([0, 1.1, 0, 0]) })).toThrow(
      /PCM inválido/,
    );
    expect(() =>
      analyzeReferenceAudio({ ...base, pcm: new Float32Array([0, Number.NaN, 0, 0]) }),
    ).toThrow(/PCM inválido/);
  });
});
