import { RamPreviewCache, createPreviewFrameKey, type PreviewCacheStats } from "@theatrum/engine";

const DEFAULT_BUDGET_BYTES = 96 * 1024 * 1024;

export interface RenderedPreviewFrame {
  readonly compositionId: string;
  readonly documentFingerprint: string;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly variant: string;
  readonly rgba: Uint8Array;
}

interface FrameMetadata {
  readonly compositionId: string;
  readonly documentFingerprint: string;
  readonly frame: number;
}

let cache = new RamPreviewCache(DEFAULT_BUDGET_BYTES);
const metadataByKey = new Map<string, FrameMetadata>();
const listeners = new Set<() => void>();

/**
 * Registra somente pixels que já atravessaram o compositor e foram aceitos
 * pelo destino do export. Assim, a faixa verde nunca promete um frame ainda
 * não renderizado nem um cache sintético.
 */
export function cacheRenderedPreviewFrame(input: RenderedPreviewFrame): boolean {
  const key = createPreviewFrameKey(input);
  const result = cache.put(key, input.rgba);
  for (const evicted of result.evicted) metadataByKey.delete(evicted);
  if (!result.stored) {
    metadataByKey.delete(key);
    return false;
  }
  metadataByKey.set(key, {
    compositionId: input.compositionId,
    documentFingerprint: input.documentFingerprint,
    frame: input.frame,
  });
  notify();
  return true;
}

export function cachedPreviewFrames(
  compositionId: string,
  documentFingerprint: string,
): readonly number[] {
  const frames = new Set<number>();
  for (const metadata of metadataByKey.values()) {
    if (
      metadata.compositionId === compositionId &&
      metadata.documentFingerprint === documentFingerprint
    ) {
      frames.add(metadata.frame);
    }
  }
  return Object.freeze([...frames].sort((left, right) => left - right));
}

export function subscribePreviewCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function previewCacheStats(): PreviewCacheStats {
  return cache.stats();
}

export function resetPreviewCacheForTests(budgetBytes = DEFAULT_BUDGET_BYTES): void {
  cache = new RamPreviewCache(budgetBytes);
  metadataByKey.clear();
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}
