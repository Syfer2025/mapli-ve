/**
 * Classificação dos arquivos que a Biblioteca (bloco 7A) aceita importar.
 * PNG/JPG/WebP viram nós `image`, SVG vira nó `svg`, GLB/glTF fica registrado
 * para o viewport 3D futuro. A extensão manda; o mime só desempata arquivos
 * sem extensão reconhecida.
 */
export type AssetKind = "image" | "svg" | "model";

export const ASSET_IMPORT_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.glb,.gltf";

export const ASSET_KIND_LABELS: Readonly<Record<AssetKind, string>> = Object.freeze({
  image: "Imagem",
  svg: "SVG",
  model: "Modelo 3D",
});

const EXTENSION_KINDS: Readonly<Record<string, AssetKind>> = Object.freeze({
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  svg: "svg",
  glb: "model",
  gltf: "model",
});

const MIME_KINDS: Readonly<Record<string, AssetKind>> = Object.freeze({
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/svg+xml": "svg",
  "model/gltf-binary": "model",
  "model/gltf+json": "model",
});

export function extensionForFileName(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1] === undefined ? null : match[1].toLowerCase();
}

export function assetKindForFile(fileName: string, mime: string): AssetKind | null {
  const extension = extensionForFileName(fileName);
  if (extension !== null) {
    const kind = EXTENSION_KINDS[extension];
    if (kind !== undefined) return kind;
  }
  return MIME_KINDS[mime.trim().toLowerCase()] ?? null;
}

/** "T-34 soviético.png" → "T-34 soviético". Arquivo sem nome vira "asset". */
export function baseNameFromFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf(".");
  const base = (dot >= 0 ? trimmed.slice(0, dot) : trimmed).trim();
  return base.length > 0 ? base : "asset";
}
