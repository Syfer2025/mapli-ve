import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_SUPERSAMPLING_STORAGE_KEY,
  getPreviewSupersampling,
  loadPreviewSupersampling,
  previewPixelRatioForSize,
  resetPreviewSupersamplingForTest,
  setPreviewSupersampling,
  subscribePreviewSupersampling,
} from "./preview-supersampling.js";

afterEach(() => {
  resetPreviewSupersamplingForTest();
});

function storageWith(value: string | null) {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  };
}

describe("preferência de supersampling do preview", () => {
  it("nasce desligada quando não há preferência válida", () => {
    expect(loadPreviewSupersampling(storageWith(null))).toBe(1);
    expect(loadPreviewSupersampling(storageWith("8"))).toBe(1);
    expect(loadPreviewSupersampling(storageWith("texto"))).toBe(1);
  });

  it("restaura fator 2 da máquina", () => {
    const storage = storageWith("2");
    expect(loadPreviewSupersampling(storage)).toBe(2);
    expect(getPreviewSupersampling()).toBe(2);
    expect(storage.getItem).toHaveBeenCalledWith(PREVIEW_SUPERSAMPLING_STORAGE_KEY);
  });

  it("persiste, notifica uma vez e recusa fator não oferecido", () => {
    const storage = storageWith(null);
    loadPreviewSupersampling(storage);
    const listener = vi.fn();
    const unsubscribe = subscribePreviewSupersampling(listener);

    setPreviewSupersampling(2, storage);
    setPreviewSupersampling(2, storage);
    expect(getPreviewSupersampling()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenLastCalledWith(PREVIEW_SUPERSAMPLING_STORAGE_KEY, "2");
    expect(() => setPreviewSupersampling(3, storage)).toThrow(/fator de preview inválido/);
    unsubscribe();
  });

  it("mantém a preferência da sessão quando a persistência falha", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("indisponível");
      },
    };
    loadPreviewSupersampling(storage);
    setPreviewSupersampling(2, storage);
    expect(getPreviewSupersampling()).toBe(2);
  });

  it("mantém o fator pedido quando o backing cabe no teto", () => {
    expect(previewPixelRatioForSize(1, 2, 1665, 798)).toBe(2);
  });

  it("aplica o mesmo teto físico do MapLibre em preview HiDPI largo", () => {
    expect(previewPixelRatioForSize(2, 2, 1665, 798)).toBeCloseTo(4096 / 1665, 12);
    expect(previewPixelRatioForSize(2, 2, 800, 2200)).toBeCloseTo(4096 / 2200, 12);
  });
});
