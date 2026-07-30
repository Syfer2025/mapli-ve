import { DEFAULT_MAX_DIMENSION, EXPORT_SUPERSAMPLING_FACTORS } from "@theatrum/export";
import { useSyncExternalStore } from "react";

/**
 * Preferência local de qualidade do preview (ADR-024).
 *
 * Não entra no documento nem no Command Bus: mudar a carga desta máquina não
 * muda a obra. O override de um job sempre vence esta preferência.
 */

export const PREVIEW_SUPERSAMPLING_STORAGE_KEY = "theatrum.previewSupersampling";

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const listeners = new Set<() => void>();
let snapshot = 1;
let hydrated = false;

function browserStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPreviewFactor(value: number): boolean {
  return EXPORT_SUPERSAMPLING_FACTORS.includes(value);
}

/**
 * Densidade efetiva compartilhada por MapLibre e Pixi no preview.
 *
 * O MapLibre reduz sozinho o pixel ratio quando um eixo passaria de 4096. Fazer
 * a mesma conta antes de criar o ScreenScene impede mapa e overlay de ficarem
 * com backing stores diferentes em tela HiDPI larga.
 */
export function previewPixelRatioForSize(
  basePixelRatio: number,
  factor: number,
  width: number,
  height: number,
  maxDimension = DEFAULT_MAX_DIMENSION,
): number {
  if (!Number.isFinite(basePixelRatio) || basePixelRatio <= 0) {
    throw new Error(`pixel ratio de preview inválido: ${String(basePixelRatio)}`);
  }
  if (!isPreviewFactor(factor)) {
    throw new Error(`fator de preview inválido: ${String(factor)}`);
  }
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error(`teto de preview inválido: ${String(maxDimension)}`);
  }
  const requested = basePixelRatio * factor;
  if (width <= 0 || height <= 0) return requested;
  return Math.min(requested, maxDimension / width, maxDimension / height);
}

function storedFactor(storage: PreferenceStorage | null): number {
  if (storage === null) return 1;
  try {
    const parsed = Number(storage.getItem(PREVIEW_SUPERSAMPLING_STORAGE_KEY));
    return isPreviewFactor(parsed) ? parsed : 1;
  } catch {
    return 1;
  }
}

function emit(next: number): void {
  if (snapshot === next) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Carrega uma vez; armazenamento ausente ou inválido significa fator 1. */
export function loadPreviewSupersampling(
  storage: PreferenceStorage | null = browserStorage(),
): number {
  const next = storedFactor(storage);
  hydrated = true;
  emit(next);
  return snapshot;
}

export function getPreviewSupersampling(): number {
  if (!hydrated) loadPreviewSupersampling();
  return snapshot;
}

export function subscribePreviewSupersampling(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreviewSupersampling(): number {
  return useSyncExternalStore(
    subscribePreviewSupersampling,
    getPreviewSupersampling,
    getPreviewSupersampling,
  );
}

/**
 * Atualiza e persiste a preferência. Só fatores oferecidos na interface entram:
 * um valor arbitrário salvo à mão não pode transformar o preview em alvo 8K.
 */
export function setPreviewSupersampling(
  factor: number,
  storage: PreferenceStorage | null = browserStorage(),
): void {
  if (!isPreviewFactor(factor)) {
    throw new Error(`fator de preview inválido: ${String(factor)}`);
  }
  hydrated = true;
  if (storage !== null) {
    try {
      storage.setItem(PREVIEW_SUPERSAMPLING_STORAGE_KEY, String(factor));
    } catch {
      // Preferência continua valendo nesta sessão mesmo se persistência falhar.
    }
  }
  emit(factor);
}

/** Só para teste: devolve o módulo ao padrão desligado. */
export function resetPreviewSupersamplingForTest(): void {
  snapshot = 1;
  hydrated = false;
  listeners.clear();
}
