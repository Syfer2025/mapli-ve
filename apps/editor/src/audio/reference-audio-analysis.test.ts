import { describe, expect, it } from "vitest";
import {
  analyzeDecodedReferenceAudio,
  interleaveAudioChannels,
} from "./reference-audio-analysis.js";

describe("análise de áudio de referência no editor", () => {
  it("intercala canais sem alterar a ordem temporal", () => {
    const left = new Float32Array([0.25, -0.5]);
    const right = new Float32Array([0.75, 1]);
    expect([...interleaveAudioChannels([left, right])]).toEqual([0.25, 0.75, -0.5, 1]);
    expect([...left]).toEqual([0.25, -0.5]);
  });

  it("produz buckets sincronizados por frame usando apenas o engine público", () => {
    const channels = [
      new Float32Array([0.25, -0.5, 0.75, -1]),
      new Float32Array([0.5, -0.25, 1, -0.75]),
    ];
    const analysis = analyzeDecodedReferenceAudio(
      {
        assetSrc: "assets/ab/audio.wav",
        name: "Narração",
        fps: 2,
        startFrame: 10,
      },
      {
        sampleRate: 4,
        numberOfChannels: 2,
        length: 4,
        getChannelData: (channel) => channels[channel]!,
      },
    );

    expect(analysis.track).toMatchObject({
      assetId: "assets/ab/audio.wav",
      channels: 2,
      startFrame: 10,
      endFrameExclusive: 12,
    });
    expect(analysis.waveform.map(({ frame }) => frame)).toEqual([10, 11]);
    expect(analysis.waveform[0]).toMatchObject({ min: -0.5, max: 0.5 });
    expect(analysis.waveform[1]).toMatchObject({ min: -1, max: 1 });
  });

  it("recusa canais com durações diferentes", () => {
    expect(() =>
      interleaveAudioChannels([new Float32Array([0]), new Float32Array([0, 1])]),
    ).toThrow(/mesma duração/);
  });
});
