/**
 * Pixi publica o entrypoint runtime, mas não associa seu `init.d.ts` vazio no
 * mapa `exports`. O módulo é importado somente pelo efeito colateral que
 * instala os geradores compatíveis com CSP.
 */
declare module "pixi.js/unsafe-eval";
