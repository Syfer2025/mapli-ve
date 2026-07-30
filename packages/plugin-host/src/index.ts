/**
 * @theatrum/plugin-host — L4 · serviços
 *
 * Descoberta e ciclo de vida transacional de plugins locais, além do catálogo
 * de conteúdo empacotado. Plugins só recebem registries delimitados; todo
 * registro é capturado e removido no unload.
 */

export {
  EXTENSION_POINT_NAMES,
  PLUGIN_API_VERSION,
  parsePluginManifest,
  type ExtensionPointName,
  type ManifestDiagnostic,
  type PluginManifest,
} from "./manifest.js";

export {
  ExtensionRegistrationError,
  createNamedExtensionRegistry,
  targetSizes,
  type IdentifiedContribution,
  type NamedExtensionRegistry,
  type PluginContributionTypes,
  type PluginExtensionTargets,
  type PluginRegistrationApi,
  type PluginRegistrationPoint,
  type RegistrationTarget,
} from "./extensions.js";

export {
  discoverPlugins,
  type PluginCandidate,
  type PluginDiscovery,
  type PluginDiscoveryDiagnostic,
  type PluginFileSystem,
} from "./discovery.js";

export {
  createPluginHost,
  type LoadedPlugin,
  type PluginApi,
  type PluginError,
  type PluginErrorCode,
  type PluginHost,
  type PluginModule,
  type PluginModuleLoader,
} from "./host.js";

export {
  createUnresolvedNodePlaceholder,
  restoreUnresolvedNode,
  type UnresolvedNodePlaceholder,
} from "./unresolved.js";

export {
  UNIT_CATEGORIES,
  UNIT_ERAS,
  createUnitCatalog,
  missingUnitAssets,
  parseUnitCatalog,
  type UnitCatalog,
  type UnitCatalogDiagnostic,
  type UnitCategory,
  type UnitDefinition,
  type UnitEra,
  type UnitSearchOptions,
  type UnitSearchResult,
} from "./unit-catalog.js";

export {
  parseFlagCatalog,
  parsePaletteCatalog,
  parsePresetCatalog,
  type BundledContentDiagnostic,
  type EffectPresetDefinition,
  type FlagDefinition,
  type PaletteDefinition,
  type PresetCatalog,
  type ScenePresetDefinition,
} from "./content-catalog.js";
