/**
 * @theatrum/engine — L5 · composição
 *
 * Superfície pública única deste pacote. Importar
 * `@theatrum/engine/src/...` é erro de lint.
 *
 * Ver docs/02-MODULES.md.
 */
export { checksumBytes, createByteChecksum, type ByteChecksum } from "./checksum.js";
export {
  PreviewDiskCacheAdapter,
  RamPreviewCache,
  TieredPreviewCache,
  createPreviewFrameKey,
  type PreviewCacheEntry,
  type PreviewCachePutResult,
  type PreviewCacheStats,
  type PreviewDiskRecord,
  type PreviewDiskRecordMetadata,
  type PreviewDiskStoragePort,
  type PreviewFrameKeyInput,
  type TieredPreviewCachePutResult,
} from "./preview-cache.js";
export {
  analyzeReferenceAudio,
  sampleBoundaryAtFrame,
  sampleRangeForTimelineFrame,
  waveformAtFrame,
  type AudioWaveformFrame,
  type ReferenceAudioAnalysis,
  type ReferenceAudioPcmInput,
  type ReferenceAudioTrack,
} from "./reference-audio.js";
