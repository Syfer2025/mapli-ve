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

const analysisByKey = new Map<string, Promise<ReferenceAudioAnalysis>>();

/**
 * Decodifica o arquivo incorporado com a implementação nativa do Chromium e
 * entrega ao engine somente PCM. Esta fronteira não cria nós de áudio, não
 * conecta `AudioDestinationNode` e, portanto, não reproduz nem mistura som.
 */
export function loadReferenceAudioAnalysis(
  input: ReferenceAudioAnalysisInput,
): Promise<ReferenceAudioAnalysis> {
  const key = JSON.stringify([input.assetSrc, input.name, input.fps, input.startFrame]);
  const cached = analysisByKey.get(key);
  if (cached !== undefined) return cached;

  const pending = decodeAndAnalyze(input).catch((error: unknown) => {
    analysisByKey.delete(key);
    throw error;
  });
  analysisByKey.set(key, pending);
  return pending;
}

export function analyzeDecodedReferenceAudio(
  input: ReferenceAudioAnalysisInput,
  decoded: DecodedReferenceAudio,
): ReferenceAudioAnalysis {
  if (
    !Number.isSafeInteger(decoded.numberOfChannels) ||
    decoded.numberOfChannels <= 0 ||
    !Number.isSafeInteger(decoded.length) ||
    decoded.length < 0
  ) {
    throw new RangeError("Buffer de áudio decodificado inválido.");
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

export function clearReferenceAudioAnalysisCache(): void {
  analysisByKey.clear();
}

async function decodeAndAnalyze(
  input: ReferenceAudioAnalysisInput,
): Promise<ReferenceAudioAnalysis> {
  const bytes = assetBytes(input.assetSrc);
  if (bytes === null) throw new Error("Os bytes do áudio não estão disponíveis no projeto.");
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("O decoder de áudio não está disponível neste ambiente.");
  }
  const context = new OfflineAudioContext(1, 1, 44_100);
  const decoded = await context.decodeAudioData(bytes.slice().buffer);
  return analyzeDecodedReferenceAudio(input, decoded);
}
