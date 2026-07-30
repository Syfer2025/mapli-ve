import { describe, expect, it } from "vitest";
import {
  analyzeActivity,
  analyzeHeap,
  analyzeNativeCoverage,
  summarizeNativeMemory,
} from "./phase11-soak-analysis.mjs";

const sample = (
  minute: number,
  renders: number | null,
  evaluatedFrame: number | null,
  playheadFrame = minute,
) => ({
  elapsedMinutes: minute,
  trackedMemoryMb: 100 + minute,
  editor: { renders, evaluatedFrame, playheadFrame, isPlaying: true },
  nativeMemory: { processes: 3, workingSetMb: 100 + minute },
});

describe("análise pura do soak da Fase 11", () => {
  it("não aceita avanço apenas do playhead como prova de render", () => {
    const activity = analyzeActivity([sample(0, null, null), sample(1, null, null)]);
    expect(activity).toMatchObject({
      distinctPlayheadFrames: 2,
      renderDelta: 0,
      renderMetricsAvailable: false,
      evaluatedMetricsAvailable: false,
      verified: false,
    });
  });

  it("exige render e frame avaliado avançando de verdade", () => {
    expect(analyzeActivity([sample(0, 10, 0), sample(1, 20, 1)])).toMatchObject({
      renderDelta: 10,
      distinctEvaluatedFrames: 2,
      verified: true,
    });
    expect(analyzeActivity([sample(0, 10, 0), sample(1, 10, 1)]).verified).toBe(false);
  });

  it("mede tendência e exige métricas nativas em todas as amostras", () => {
    expect(analyzeHeap([sample(0, 1, 0), sample(60, 2, 1)])).toMatchObject({
      growthMb: 60,
      slopeMbPerHour: 60,
      peakMb: 160,
    });
    expect(analyzeNativeCoverage([sample(0, 1, 0), sample(1, 2, 1)]).verified).toBe(true);
    expect(
      analyzeNativeCoverage([sample(0, 1, 0), { ...sample(1, 2, 1), nativeMemory: null }]).verified,
    ).toBe(false);
  });

  it("soma working set e trata privateBytes como métrica opcional", () => {
    expect(
      summarizeNativeMemory([
        { workingSetKb: 1_024, peakWorkingSetKb: 2_048, privateBytesKb: 512 },
        { workingSetKb: 2_048, peakWorkingSetKb: 3_072 },
      ]),
    ).toEqual({
      processes: 2,
      workingSetMb: 3,
      peakWorkingSetMb: 5,
      privateBytesMb: 0.5,
    });
  });
});
