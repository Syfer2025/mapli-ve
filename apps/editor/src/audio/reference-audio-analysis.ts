import { analyzeReferenceAudio, type ReferenceAudioAnalysis } from "@theatrum/engine";
import { assetBytes } from "../assets/asset-media.js";

export interface DecodedReferenceAudio {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface ReferenceAudioAnalysisInput {
  readonly assetSrc: string;
  readonly name: string;
  readonly fps: number;
  readonly startFrame: number;
}

const MEBIBYTE = 1024 * 1024;
export const MAX_REFERENCE_AUDIO_FILE_BYTES = 64 * MEBIBYTE;
export const MAX_REFERENCE_AUDIO_DECODED_BYTES = 256 * MEBIBYTE;
const ANALYSIS_CACHE_BUDGET_BYTES = 32 * MEBIBYTE;
const ANALYSIS_CACHE_MAX_ENTRIES = 4;
const ESTIMATED_WAVEFORM_FRAME_BYTES = 128;

interface CachedAnalysis {
  readonly assetSrc: string;
  readonly analysis: ReferenceAudioAnalysis;
  readonly estimatedBytes: number;
}

interface PendingAnalysis {
  readonly assetSrc: string;
  readonly promise: Promise<ReferenceAudioAnalysis>;
}

export interface ReferenceAudioAnalysisCacheStats {
  readonly budgetBytes: number;
  readonly usedBytes: number;
  readonly entries: number;
  readonly pending: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

/**
 * LRU pequeno para waveforms derivados. Promises em voo são deduplicadas, mas
 * nunca contam como entrada retida; `clear` invalida também o resultado tardio
 * de um decode que já não pertence ao projeto/composição atual.
 */
export class ReferenceAudioAnalysisCache {
  readonly #budgetBytes: number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CachedAnalysis>();
  readonly #pending = new Map<string, PendingAnalysis>();
  readonly #assetGenerations = new Map<string, number>();
  #generation = 0;
  #usedBytes = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;

  constructor(budgetBytes = ANALYSIS_CACHE_BUDGET_BYTES, maxEntries = ANALYSIS_CACHE_MAX_ENTRIES) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
      throw new RangeError("O orçamento do cache de waveform precisa ser um inteiro positivo.");
    }
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError("O limite de waveforms precisa ser um inteiro positivo.");
    }
    this.#budgetBytes = budgetBytes;
    this.#maxEntries = maxEntries;
  }

  load(
    key: string,
    assetSrc: string,
    loader: () => Promise<ReferenceAudioAnalysis>,
  ): Promise<ReferenceAudioAnalysis> {
    const cached = this.#entries.get(key);
    if (cached !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      this.#hits += 1;
      return Promise.resolve(cached.analysis);
    }
    const existing = this.#pending.get(key);
    if (existing !== undefined) {
      this.#hits += 1;
      return existing.promise;
    }

    this.#misses += 1;
    const generation = this.#generation;
    const assetGeneration = this.#assetGenerations.get(assetSrc) ?? 0;
    const pending = Promise.resolve()
      .then(loader)
      .then(
        (analysis) => {
          if (this.#pending.get(key)?.promise === pending) this.#pending.delete(key);
          if (
            this.#generation === generation &&
            (this.#assetGenerations.get(assetSrc) ?? 0) === assetGeneration
          ) {
            this.#store(key, assetSrc, analysis);
          }
          return analysis;
        },
        (error: unknown) => {
          if (this.#pending.get(key)?.promise === pending) this.#pending.delete(key);
          throw error;
        },
      );
    this.#pending.set(key, { assetSrc, promise: pending });
    return pending;
  }

  clear(assetSrc?: string): void {
    if (assetSrc === undefined) {
      this.#generation += 1;
      this.#entries.clear();
      this.#pending.clear();
      this.#assetGenerations.clear();
      this.#usedBytes = 0;
      return;
    }

    this.#assetGenerations.set(assetSrc, (this.#assetGenerations.get(assetSrc) ?? 0) + 1);
    for (const [key, record] of this.#entries) {
      if (record.assetSrc !== assetSrc) continue;
      this.#entries.delete(key);
      this.#usedBytes -= record.estimatedBytes;
    }
    for (const [key, record] of this.#pending) {
      if (record.assetSrc === assetSrc) this.#pending.delete(key);
    }
  }

  stats(): ReferenceAudioAnalysisCacheStats {
    return Object.freeze({
      budgetBytes: this.#budgetBytes,
      usedBytes: this.#usedBytes,
      entries: this.#entries.size,
      pending: this.#pending.size,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
    });
  }

  #store(key: string, assetSrc: string, analysis: ReferenceAudioAnalysis): void {
    const estimatedBytes = estimateAnalysisBytes(analysis);
    if (estimatedBytes > this.#budgetBytes) return;
    const previous = this.#entries.get(key);
    if (previous !== undefined) {
      this.#entries.delete(key);
      this.#usedBytes -= previous.estimatedBytes;
    }
    this.#entries.set(key, { assetSrc, analysis, estimatedBytes });
    this.#usedBytes += estimatedBytes;
    while (this.#usedBytes > this.#budgetBytes || this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.#entries.get(oldestKey);
      this.#entries.delete(oldestKey);
      this.#usedBytes -= oldest?.estimatedBytes ?? 0;
      this.#evictions += 1;
    }
  }
}

const analysisCache = new ReferenceAudioAnalysisCache();

/**
 * Decodifica o arquivo incorporado com a implementação nativa do Chromium e
 * entrega ao engine somente PCM. Esta fronteira não cria nós de áudio, não
 * conecta `AudioDestinationNode` e, portanto, não reproduz nem mistura som.
 */
export function loadReferenceAudioAnalysis(
  input: ReferenceAudioAnalysisInput,
): Promise<ReferenceAudioAnalysis> {
  const key = JSON.stringify([input.assetSrc, input.name, input.fps, input.startFrame]);
  return analysisCache.load(key, input.assetSrc, () => decodeAndAnalyze(input));
}

export function analyzeDecodedReferenceAudio(
  input: ReferenceAudioAnalysisInput,
  decoded: DecodedReferenceAudio,
): ReferenceAudioAnalysis {
  if (
    !Number.isSafeInteger(decoded.numberOfChannels) ||
    decoded.numberOfChannels <= 0 ||
    !Number.isSafeInteger(decoded.length) ||
    decoded.length < 0 ||
    !Number.isSafeInteger(decoded.sampleRate) ||
    decoded.sampleRate <= 0
  ) {
    throw new RangeError("Buffer de áudio decodificado inválido.");
  }
  const scalarSamples = decoded.length * decoded.numberOfChannels;
  const decodedBytes = scalarSamples * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(scalarSamples) || decodedBytes > MAX_REFERENCE_AUDIO_DECODED_BYTES) {
    throw new RangeError(
      `Áudio decodificado excede o limite de ${MAX_REFERENCE_AUDIO_DECODED_BYTES / MEBIBYTE} MiB.`,
    );
  }
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
    decoded.getChannelData(channel),
  );
  return analyzeReferenceAudio({
    assetId: input.assetSrc,
    name: input.name,
    sampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
    fps: input.fps,
    startFrame: input.startFrame,
    pcm: interleaveAudioChannels(channels),
  });
}

/** Intercala canais sem alterar os arrays retornados pelo decoder. */
export function interleaveAudioChannels(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (first === undefined) throw new RangeError("O áudio precisa conter ao menos um canal.");
  const sampleFrames = first.length;
  for (const channel of channels) {
    if (!(channel instanceof Float32Array) || channel.length !== sampleFrames) {
      throw new RangeError("Todos os canais precisam ter a mesma duração.");
    }
  }
  const interleaved = new Float32Array(sampleFrames * channels.length);
  for (let sample = 0; sample < sampleFrames; sample++) {
    for (let channel = 0; channel < channels.length; channel++) {
      interleaved[sample * channels.length + channel] = channels[channel]?.[sample] ?? 0;
    }
  }
  return interleaved;
}

export function clearReferenceAudioAnalysisCache(assetSrc?: string): void {
  analysisCache.clear(assetSrc);
}

export function referenceAudioAnalysisCacheStats(): ReferenceAudioAnalysisCacheStats {
  return analysisCache.stats();
}

async function decodeAndAnalyze(
  input: ReferenceAudioAnalysisInput,
): Promise<ReferenceAudioAnalysis> {
  const bytes = assetBytes(input.assetSrc);
  if (bytes === null) throw new Error("Os bytes do áudio não estão disponíveis no projeto.");
  if (bytes.byteLength > MAX_REFERENCE_AUDIO_FILE_BYTES) {
    throw new RangeError(
      `Arquivo de áudio excede o limite de ${MAX_REFERENCE_AUDIO_FILE_BYTES / MEBIBYTE} MiB.`,
    );
  }
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("O decoder de áudio não está disponível neste ambiente.");
  }
  const context = new OfflineAudioContext(1, 1, 44_100);
  const decoded = await context.decodeAudioData(bytes.slice().buffer);
  return analyzeDecodedReferenceAudio(input, decoded);
}

function estimateAnalysisBytes(analysis: ReferenceAudioAnalysis): number {
  return 512 + analysis.waveform.length * ESTIMATED_WAVEFORM_FRAME_BYTES;
}
