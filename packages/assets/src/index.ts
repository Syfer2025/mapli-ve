/**
 * @theatrum/assets — L2 · domínio
 *
 * Biblioteca de ativos importados pelo usuário (bloco 7A do roadmap):
 * classificação de arquivos, convenção de `meta` dos descriptors e varredura
 * de usos no documento. Os bytes e o endereçamento por hash ficam em
 * `@theatrum/project-io` (camada acima), a textura GPU em `@theatrum/renderer`
 * (também acima) — este pacote é puro e testável em Node.
 *
 * Superfície pública única deste pacote. Importar
 * `@theatrum/assets/src/...` é erro de lint.
 *
 * Ver docs/02-MODULES.md.
 */
export {
  ASSET_IMPORT_ACCEPT,
  ASSET_KIND_LABELS,
  assetKindForFile,
  baseNameFromFileName,
  extensionForFileName,
  type AssetKind,
} from "./classify.js";
export {
  assetByteSize,
  assetDimensions,
  assetDisplayName,
  assetMime,
  assetTags,
  buildAssetDescriptor,
  formatAssetSize,
  normalizeTags,
  type AssetDescriptorInput,
} from "./descriptor.js";
export { findAssetReferences, type AssetReference } from "./usages.js";
