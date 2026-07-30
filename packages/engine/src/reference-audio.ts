import { createByteChecksum } from "./checksum.js";

export interface ReferenceAudioPcmInput {
  readonly assetId: string;
  readonly name: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly fps: number;
  readonly startFrame?: number;
  /** PCM float32 intercalado por canal, normalizado em `[-1, 1]`. */
  readonly pcm: Float32Array;
}

export interface ReferenceAudioTrack {
  readonly assetId: string;
  readonly name: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly fps: number;
  readonly startFrame: number;
  readonly endFrameExclusive: number;
  readonly durationFrames: number;
  /** Quantidade de amostras temporais; não multiplica pelo número de canais. */
  readonly sampleFrames: number;
  readonly durationSeconds: number;
  readonly pcmChecksum: string;
}

export interface AudioWaveformFrame {
  readonly frame: number;
  readonly startSample: number;
  readonly endSampleExclusive: number;
  readonly sampleFrames: number;
  readonly min: number;
  readonly max: number;
  readonly peak: number;
  readonly rms: number;
}

export interface ReferenceAudioAnalysis {
  readonly track: ReferenceAudioTrack;
  readonly waveform: readonly AudioWaveformFrame[];
}

/** Analisa PCM em ordem fixa e produz exatamente um bucket por frame de vídeo. */
export function analyzeReferenceAudio(input: ReferenceAudioPcmInput): ReferenceAudioAnalysis {
  validText("assetId", input.assetId);
  validText("name", input.name);
  positiveInteger("sampleRate", input.sampleRate);
  positiveInteger("channels", input.channels);
  positiveFinite("fps", input.fps);
  const startFrame = input.startFrame ?? 0;
  nonNegativeInteger("startFrame", startFrame);
  if (!(input.pcm instanceof Float32Array)) {
    throw new TypeError("pcm precisa ser Float32Array");
  }
  if (input.pcm.length % input.channels !== 0) {
    throw new RangeError("PCM intercalado precisa conter o mesmo número de amostras por canal");
  }

  const pcmChecksum = checksumPcm(input.pcm);
  const sampleFrames = input.pcm.length / input.channels;
  const durationFrames =
    sampleFrames === 0 ? 0 : Math.ceil((sampleFrames * input.fps) / input.sampleRate);
  if (!Number.isSafeInteger(durationFrames)) {
    throw new RangeError("duração do áudio excede o limite seguro");
  }
  const endFrameExclusive = startFrame + durationFrames;
  if (!Number.isSafeInteger(endFrameExclusive)) {
    throw new RangeError("fim da trilha excede o limite seguro");
  }

  const track: ReferenceAudioTrack = Object.freeze({
    assetId: input.assetId,
    name: input.name,
    sampleRate: input.sampleRate,
    channels: input.channels,
    fps: input.fps,
    startFrame,
    endFrameExclusive,
    durationFrames,
    sampleFrames,
    durationSeconds: sampleFrames / input.sampleRate,
    pcmChecksum,
  });
  const waveform: AudioWaveformFrame[] = [];
  for (let relativeFrame = 0; relativeFrame < durationFrames; relativeFrame++) {
    const startSample = Math.min(
      sampleFrames,
      sampleBoundaryAtFrame(relativeFrame, input.sampleRate, input.fps),
    );
    const endSampleExclusive = Math.min(
      sampleFrames,
      sampleBoundaryAtFrame(relativeFrame + 1, input.sampleRate, input.fps),
    );
    waveform.push(
      analyzeFrame(
        input.pcm,
        input.channels,
        startFrame + relativeFrame,
        startSample,
        endSampleExclusive,
      ),
    );
  }
  return Object.freeze({ track, waveform: Object.freeze(waveform) });
}

/**
 * Fronteira absoluta, sem acumulador: frames consecutivos sempre compartilham o
 * mesmo limite mesmo em taxas fracionárias como 30000/1001.
 */
export function sampleBoundaryAtFrame(
  relativeFrame: number,
  sampleRate: number,
  fps: number,
): number {
  nonNegativeInteger("relativeFrame", relativeFrame);
  positiveInteger("sampleRate", sampleRate);
  positiveFinite("fps", fps);
  const boundary = Math.round((relativeFrame * sampleRate) / fps);
  if (!Number.isSafeInteger(boundary)) {
    throw new RangeError("fronteira de amostra excede o limite seguro");
  }
  return boundary;
}

export function sampleRangeForTimelineFrame(
  track: ReferenceAudioTrack,
  timelineFrame: number,
): readonly [startSample: number, endSampleExclusive: number] | null {
  nonNegativeInteger("timelineFrame", timelineFrame);
  if (timelineFrame < track.startFrame || timelineFrame >= track.endFrameExclusive) return null;
  const relativeFrame = timelineFrame - track.startFrame;
  return Object.freeze([
    Math.min(track.sampleFrames, sampleBoundaryAtFrame(relativeFrame, track.sampleRate, track.fps)),
    Math.min(
      track.sampleFrames,
      sampleBoundaryAtFrame(relativeFrame + 1, track.sampleRate, track.fps),
    ),
  ]);
}

export function waveformAtFrame(
  analysis: ReferenceAudioAnalysis,
  timelineFrame: number,
): AudioWaveformFrame | null {
  nonNegativeInteger("timelineFrame", timelineFrame);
  const index = timelineFrame - analysis.track.startFrame;
  return index < 0 || index >= analysis.waveform.length ? null : (analysis.waveform[index] ?? null);
}

function analyzeFrame(
  pcm: Float32Array,
  channels: number,
  frame: number,
  startSample: number,
  endSampleExclusive: number,
): AudioWaveformFrame {
  let min = 1;
  let max = -1;
  let squareSum = 0;
  let scalarSamples = 0;
  for (let sampleFrame = startSample; sampleFrame < endSampleExclusive; sampleFrame++) {
    const offset = sampleFrame * channels;
    for (let channel = 0; channel < channels; channel++) {
      const value = pcm[offset + channel] as number;
      min = Math.min(min, value);
      max = Math.max(max, value);
      squareSum += value * value;
      scalarSamples += 1;
    }
  }
  if (scalarSamples === 0) {
    min = 0;
    max = 0;
  }
  return Object.freeze({
    frame,
    startSample,
    endSampleExclusive,
    sampleFrames: endSampleExclusive - startSample,
    min,
    max,
    peak: Math.max(Math.abs(min), Math.abs(max)),
    rms: scalarSamples === 0 ? 0 : Math.sqrt(squareSum / scalarSamples),
  });
}

function checksumPcm(pcm: Float32Array): string {
  const checksum = createByteChecksum();
  const samplesPerChunk = 4_096;
  const bytes = new Uint8Array(samplesPerChunk * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  let bufferedSamples = 0;
  for (let index = 0; index < pcm.length; index++) {
    const sample = pcm[index] as number;
    if (!Number.isFinite(sample) || sample < -1 || sample > 1) {
      throw new RangeError(`PCM inválido na amostra ${index}: esperado valor finito em [-1, 1]`);
    }
    view.setFloat32(
      bufferedSamples * Float32Array.BYTES_PER_ELEMENT,
      Object.is(sample, -0) ? 0 : sample,
      true,
    );
    bufferedSamples += 1;
    if (bufferedSamples === samplesPerChunk) {
      checksum.update(bytes);
      bufferedSamples = 0;
    }
  }
  if (bufferedSamples > 0) {
    checksum.update(bytes.subarray(0, bufferedSamples * Float32Array.BYTES_PER_ELEMENT));
  }
  return checksum.digest();
}

function validText(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} não pode ser vazio`);
  }
}

function nonNegativeInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} precisa ser inteiro seguro e não negativo`);
  }
}

function positiveInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} precisa ser inteiro seguro e positivo`);
  }
}

function positiveFinite(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} precisa ser finito e positivo`);
  }
}
