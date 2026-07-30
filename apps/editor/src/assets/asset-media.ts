/**
 * Mídia de runtime da Biblioteca (bloco 7A): para cada asset do documento,
 * mantém o object URL do thumbnail do painel e a textura GPU aquecida (via
 * `@theatrum/renderer`). Os bytes vêm do container `.theatrum` na abertura ou
 * do arquivo escolhido no import. Estado de módulo, fora do documento e do
 * histórico — é cache, não conteúdo.
 */
import { evictImageTexture, warmImageTexture } from "@theatrum/renderer";

export { inspectImageTexture as assetTextureInfo } from "@theatrum/renderer";

interface AssetMediaEntry {
  readonly bytes: Uint8Array;
  readonly objectUrl: string | null;
}

const mediaBySrc = new Map<string, AssetMediaEntry>();

/**
 * Decodifica o bitmap que vira textura GPU. Raster usa `createImageBitmap`
 * direto; SVG passa por <img> + canvas porque nem todo SVG traz dimensões
 * explícitas e o Pixi não rasteriza SVG solto. Falha de decode não é fatal:
 * o nó renderiza vazio e o thumbnail (object URL) segue funcionando.
 */
export async function createTextureBitmap(
  bytes: Uint8Array,
  kind: string,
): Promise<ImageBitmap | null> {
  try {
    if (kind === "image") return await createImageBitmap(blobFromBytes(bytes));
    if (kind === "svg") return await rasterizeSvg(bytes);
  } catch {
    return null;
  }
  return null;
}

export async function registerAssetMedia(
  src: string,
  bytes: Uint8Array,
  kind: string,
  bitmap?: ImageBitmap | null,
): Promise<void> {
  const previous = mediaBySrc.get(src);
  if (previous?.objectUrl != null) URL.revokeObjectURL(previous.objectUrl);
  const visual = kind === "image" || kind === "svg";
  const objectUrl = visual ? URL.createObjectURL(blobFromBytes(bytes)) : null;
  mediaBySrc.set(src, { bytes, objectUrl });
  if (!visual) return;
  // Src é hash de conteúdo: textura já aquecida para o mesmo src é a mesma
  // imagem, e `warmImageTexture` no-ops nesse caso.
  const resolved = bitmap === undefined ? await createTextureBitmap(bytes, kind) : bitmap;
  if (resolved !== null) await warmImageTexture(src, resolved);
}

export function unregisterAssetMedia(src: string): void {
  const entry = mediaBySrc.get(src);
  if (entry === undefined) return;
  if (entry.objectUrl !== null) URL.revokeObjectURL(entry.objectUrl);
  mediaBySrc.delete(src);
  void evictImageTexture(src);
}

export function resetAssetMedia(): void {
  for (const src of [...mediaBySrc.keys()]) unregisterAssetMedia(src);
}

export function assetThumbnailUrl(src: string): string | null {
  return mediaBySrc.get(src)?.objectUrl ?? null;
}

export function assetMediaSources(): readonly string[] {
  return [...mediaBySrc.keys()];
}

/**
 * Bytes brutos do asset (cache de runtime). Necessário para o loader 3D: este
 * renderer bloqueia fetch de blob: (CSP), então o GLTFLoader recebe o buffer
 * via `parse`, nunca uma URL.
 */
export function assetBytes(src: string): Uint8Array | null {
  return mediaBySrc.get(src)?.bytes ?? null;
}

function blobFromBytes(bytes: Uint8Array): Blob {
  // Cópia fresca: satisfaz ArrayBuffer (não ArrayBufferLike) para o Blob e
  // desconecta o blob do buffer que o container pode reutilizar.
  return new Blob([new Uint8Array(bytes)]);
}

async function rasterizeSvg(bytes: Uint8Array): Promise<ImageBitmap | null> {
  const url = URL.createObjectURL(new Blob([blobFromBytes(bytes)], { type: "image/svg+xml" }));
  try {
    const image = await loadImage(url);
    const width = image.naturalWidth > 0 ? image.naturalWidth : 320;
    const height = image.naturalHeight > 0 ? image.naturalHeight : 180;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(image, 0, 0, width, height);
    return await createImageBitmap(canvas);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Falha ao decodificar a imagem."));
    image.src = url;
  });
}
