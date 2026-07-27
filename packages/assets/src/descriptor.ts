/**
 * Convenção de `meta` dos assets da Biblioteca (bloco 7A). O schema mantém
 * `meta` como objeto livre; estes acessores são o contrato que a UI e os
 * comandos usam para não espalhar chaves soltas pelo código.
 *
 * Chaves: `name`, `mime`, `bytes`, `width`, `height`, `tags`.
 */
import type { AssetDescriptor } from "@theatrum/schema";

import type { AssetKind } from "./classify.js";

export interface AssetDescriptorInput {
  readonly id: string;
  readonly kind: AssetKind;
  readonly src: string;
  readonly name: string;
  readonly mime: string;
  readonly byteSize: number;
  readonly width?: number;
  readonly height?: number;
  readonly tags?: readonly string[];
}

export function buildAssetDescriptor(input: AssetDescriptorInput): AssetDescriptor {
  return {
    id: input.id,
    kind: input.kind,
    src: input.src,
    meta: {
      name: input.name,
      mime: input.mime,
      bytes: input.byteSize,
      ...(input.width === undefined ? {} : { width: input.width }),
      ...(input.height === undefined ? {} : { height: input.height }),
      tags: [...(input.tags ?? [])],
    },
  };
}

export function assetDisplayName(asset: AssetDescriptor): string {
  const name = asset.meta["name"];
  return typeof name === "string" && name.trim().length > 0 ? name : asset.id;
}

export function assetMime(asset: AssetDescriptor): string {
  const mime = asset.meta["mime"];
  return typeof mime === "string" ? mime : "";
}

export function assetByteSize(asset: AssetDescriptor): number | null {
  const bytes = asset.meta["bytes"];
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

export function assetDimensions(
  asset: AssetDescriptor,
): { readonly width: number; readonly height: number } | null {
  const width = asset.meta["width"];
  const height = asset.meta["height"];
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !(width > 0) ||
    !(height > 0) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  return { width, height };
}

export function assetTags(asset: AssetDescriptor): readonly string[] {
  const tags = asset.meta["tags"];
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
}

/** "ww2, tanque; ww2" → ["ww2", "tanque"] — separa, apara e remove duplicata. */
export function normalizeTags(input: string): string[] {
  const seen = new Set<string>();
  for (const piece of input.split(/[,;]/)) {
    const tag = piece.trim();
    if (tag.length > 0) seen.add(tag);
  }
  return [...seen];
}

export function formatAssetSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
