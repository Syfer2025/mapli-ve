import { describe, expect, it } from "vitest";
import {
  MAX_REFERENCE_AUDIO_DECODED_BYTES,
  ReferenceAudioAnalysisCache,
  analyzeDecodedReferenceAudio,
  interleaveAudioChannels,
} from "./reference-audio-analysis.js";
import type { ReferenceAudioAnalysis } from "@theatrum/engine";

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

  it("recusa PCM decodificado acima do orçamento antes de ler os canais", () => {
    expect(() =>
      analyzeDecodedReferenceAudio(
        { assetSrc: "audio.wav", name: "Longo", fps: 30, startFrame: 0 },
        {
          sampleRate: 44_100,
          numberOfChannels: 1,
          length: MAX_REFERENCE_AUDIO_DECODED_BYTES / Float32Array.BYTES_PER_ELEMENT + 1,
          getChannelData: () => {
            throw new Error("não deveria ler o canal");
          },
        },
      ),
    ).toThrow(/excede o limite/);
  });

  it("limita análises resolvidas por LRU e invalida resultados tardios", async () => {
    const cache = new ReferenceAudioAnalysisCache(2_048, 2);
    const loads = new Map<string, number>();
    const load = (key: string, assetSrc = key): Promise<ReferenceAudioAnalysis> =>
      cache.load(key, assetSrc, async () => {
        loads.set(key, (loads.get(key) ?? 0) + 1);
        return analysisFixture(assetSrc);
      });

    await load("a");
    await load("b");
    await load("a");
    await load("c");
    await load("b");
    expect(loads).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 1],
      ]),
    );
    expect(cache.stats()).toMatchObject({ entries: 2, evictions: 2, usedBytes: 1_280 });

    let finish!: (analysis: ReferenceAudioAnalysis) => void;
    const late = cache.load(
      "late",
      "asset-late",
      () => new Promise((resolve) => (finish = resolve)),
    );
    await Promise.resolve();
    cache.clear("asset-late");
    finish(analysisFixture("asset-late"));
    await late;
    expect(cache.stats()).toMatchObject({ entries: 2, pending: 0 });
  });
});

function analysisFixture(assetId: string): ReferenceAudioAnalysis {
  return {
    track: {
      assetId,
      name: assetId,
      sampleRate: 1,
      channels: 1,
      fps: 1,
      startFrame: 0,
      endFrameExclusive: 1,
      durationFrames: 1,
      sampleFrames: 1,
      durationSeconds: 1,
      pcmChecksum: "crc32:00000000",
    },
    waveform: [
      {
        frame: 0,
        startSample: 0,
        endSampleExclusive: 1,
        sampleFrames: 1,
        min: 0,
        max: 0,
        peak: 0,
        rms: 0,
      },
    ],
  };
}
