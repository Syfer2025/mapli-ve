import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheRenderedPreviewFrame,
  cachedPreviewFrames,
  previewCacheStats,
  resetPreviewCacheForTests,
  subscribePreviewCache,
} from "./preview-cache-session.js";

function frame(number: number, byte = number): Parameters<typeof cacheRenderedPreviewFrame>[0] {
  return {
    compositionId: "cmp_main",
    documentFingerprint: "0123456789abcdef",
    frame: number,
    width: 1,
    height: 1,
    scale: 1,
    variant: "composite:rgba",
    rgba: new Uint8Array([byte, byte, byte, 255]),
  };
}

describe("cache real de frames do editor", () => {
  beforeEach(() => resetPreviewCacheForTests(8));

  it("expõe somente frames armazenados para a revisão correta", () => {
    expect(cacheRenderedPreviewFrame(frame(10))).toBe(true);
    expect(cachedPreviewFrames("cmp_main", "0123456789abcdef")).toEqual([10]);
    expect(cachedPreviewFrames("cmp_main", "fedcba9876543210")).toEqual([]);
  });

  it("remove o indicador junto com a expulsão LRU", () => {
    cacheRenderedPreviewFrame(frame(1));
    cacheRenderedPreviewFrame(frame(2));
    cacheRenderedPreviewFrame(frame(3));
    expect(cachedPreviewFrames("cmp_main", "0123456789abcdef")).toEqual([2, 3]);
    expect(previewCacheStats()).toMatchObject({ entries: 2, evictions: 1 });
  });

  it("notifica a Timeline depois de uma escrita confirmada", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePreviewCache(listener);
    cacheRenderedPreviewFrame(frame(1));
    unsubscribe();
    cacheRenderedPreviewFrame(frame(2));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
