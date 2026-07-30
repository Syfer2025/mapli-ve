export function analyzeHeap(samples) {
  if (samples.length < 2) {
    throw new Error("o ensaio precisa de ao menos duas amostras após o aquecimento");
  }
  const windowSize = Math.min(5, Math.max(1, Math.floor(samples.length / 4)));
  const first = median(samples.slice(0, windowSize).map(({ trackedMemoryMb }) => trackedMemoryMb));
  const last = median(samples.slice(-windowSize).map(({ trackedMemoryMb }) => trackedMemoryMb));
  const meanX = samples.reduce((sum, sample) => sum + sample.elapsedMinutes, 0) / samples.length;
  const meanY = samples.reduce((sum, sample) => sum + sample.trackedMemoryMb, 0) / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const x = sample.elapsedMinutes - meanX;
    numerator += x * (sample.trackedMemoryMb - meanY);
    denominator += x * x;
  }
  const slopeMbPerMinute = denominator === 0 ? 0 : numerator / denominator;
  return {
    samples: samples.length,
    firstMedianMb: first,
    lastMedianMb: last,
    growthMb: last - first,
    slopeMbPerHour: slopeMbPerMinute * 60,
    peakMb: Math.max(...samples.map(({ trackedMemoryMb }) => trackedMemoryMb)),
  };
}

export function analyzeActivity(samples) {
  const playheads = new Set(samples.map(({ editor }) => editor.playheadFrame));
  const evaluatedFrames = samples.map(({ editor }) => editor.evaluatedFrame);
  const renderCounts = samples.map(({ editor }) => editor.renders);
  const evaluatedMetricsAvailable = evaluatedFrames.every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  const renderMetricsAvailable = renderCounts.every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  const evaluated = new Set(evaluatedFrames.filter((value) => typeof value === "number"));
  const numericRenderCounts = renderCounts.filter((value) => typeof value === "number");
  const renderDelta =
    numericRenderCounts.length < 2
      ? 0
      : Math.max(...numericRenderCounts) - Math.min(...numericRenderCounts);
  const playingSamples = samples.filter(({ editor }) => editor.isPlaying === true).length;
  return {
    samples: samples.length,
    playingSamples,
    distinctPlayheadFrames: playheads.size,
    distinctEvaluatedFrames: evaluated.size,
    renderDelta,
    renderMetricsAvailable,
    evaluatedMetricsAvailable,
    verified:
      samples.length >= 2 &&
      playingSamples >= samples.length - 1 &&
      playheads.size > 1 &&
      evaluated.size > 1 &&
      renderDelta > 0 &&
      renderMetricsAvailable &&
      evaluatedMetricsAvailable,
  };
}

export function summarizeNativeMemory(processMetrics) {
  if (!Array.isArray(processMetrics) || processMetrics.length === 0) return null;
  const valid = processMetrics.filter(
    (metric) =>
      typeof metric === "object" &&
      metric !== null &&
      typeof metric.workingSetKb === "number" &&
      Number.isFinite(metric.workingSetKb) &&
      metric.workingSetKb >= 0,
  );
  if (valid.length === 0) return null;
  const privateValues = valid
    .map(({ privateBytesKb }) => privateBytesKb)
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return {
    processes: valid.length,
    workingSetMb: valid.reduce((sum, metric) => sum + metric.workingSetKb, 0) / 1024,
    peakWorkingSetMb:
      valid.reduce(
        (sum, metric) =>
          sum +
          (typeof metric.peakWorkingSetKb === "number" && Number.isFinite(metric.peakWorkingSetKb)
            ? metric.peakWorkingSetKb
            : metric.workingSetKb),
        0,
      ) / 1024,
    privateBytesMb:
      privateValues.length === 0
        ? null
        : privateValues.reduce((sum, value) => sum + value, 0) / 1024,
  };
}

export function analyzeNativeCoverage(samples) {
  const withNativeMetrics = samples.filter(({ nativeMemory }) => nativeMemory !== null).length;
  const processCounts = samples
    .map(({ nativeMemory }) => nativeMemory?.processes)
    .filter((value) => typeof value === "number");
  return {
    samples: samples.length,
    samplesWithNativeMetrics: withNativeMetrics,
    minimumProcesses: processCounts.length === 0 ? 0 : Math.min(...processCounts),
    verified: samples.length >= 2 && withNativeMetrics === samples.length,
  };
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : (ordered[middle] ?? 0);
}
