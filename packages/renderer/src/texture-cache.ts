/**
 * Ponte entre a Biblioteca (bloco 7A) e o backend Pixi: nós `image`/`svg`
 * resolvem a textura pelo `src` do asset consultando `Assets.cache` (ver
 * `cachedTexture` no backend). Aquecer o cache é o que faz um asset recém-
 * importado aparecer na cena sem recarregar nada.
 *
 * O import dinâmico mantém o pacote importável em Node (testes, engine) sem
 * tocar DOM — só o editor chama estas funções, no navegador.
 */
export async function warmImageTexture(source: string, bitmap: ImageBitmap): Promise<void> {
  if (source.length === 0) return;
  const module = await import("pixi.js");
  // O src carrega o hash do conteúdo: se já está no cache, é a mesma imagem.
  if (module.Assets.cache.has(source)) return;
  module.Assets.cache.set(source, module.Texture.from(bitmap));
}

export async function evictImageTexture(source: string): Promise<void> {
  if (source.length === 0) return;
  const module = await import("pixi.js");
  if (module.Assets.cache.has(source)) module.Assets.cache.remove(source);
}

/**
 * Dimensões da textura aquecida, ou null quando o src não tem textura real no
 * cache (ausente ou `Texture.EMPTY`). Alimenta a prova do bloco 7A.
 */
export async function inspectImageTexture(
  source: string,
): Promise<{ readonly width: number; readonly height: number } | null> {
  if (source.length === 0) return null;
  const module = await import("pixi.js");
  if (!module.Assets.cache.has(source)) return null;
  const cached: unknown = module.Assets.cache.get(source);
  if (!(cached instanceof module.Texture) || cached === module.Texture.EMPTY) return null;
  return { width: cached.width, height: cached.height };
}
