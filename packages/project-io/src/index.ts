/**
 * @theatrum/project-io — L4 · serviços
 *
 * Superfície pública única deste pacote. Importar
 * `@theatrum/project-io/src/...` é erro de lint.
 *
 * Ver docs/02-MODULES.md.
 */
export { type ProjectError, type ProjectErrorCode } from "./errors.js";

export { stringifyCanonicalJson, encodeCanonicalJson, parseJsonBytes } from "./canonical-json.js";

export { sha256 } from "./sha256.js";

export {
  type ContentAddressedAsset,
  contentAddressAsset,
  verifyContentAddressedAsset,
} from "./assets.js";

export { type ZipEntry, encodeZip, decodeZip } from "./zip.js";

export {
  DETERMINISTIC_TIMESTAMP,
  type ProjectContainerInput,
  type OpenedProject,
  createEmbeddedAsset,
  serializeProjectContainer,
  parseProjectContainer,
} from "./container.js";

export { type JsonPatchOperation, diffJson, applyJsonPatch } from "./json-patch.js";

export { type FileSystemEntry, type ProjectFileSystemPort, writeAtomic } from "./filesystem.js";

export {
  type SaveProjectArgs,
  type ProjectIO,
  saveProjectAtomic,
  openProject,
  createProjectIO,
} from "./project-io.js";

export {
  type RecoverySession,
  type RecoveryPatch,
  type RecoveryCandidate,
  type RecoveryClockPort,
  type AutosaveOptions,
  type RecordAutosaveOptions,
  type AutosaveManager,
  type FindRecoveryOptions,
  type RecoverAutosaveOptions,
  createAutosaveManager,
  findRecoveryCandidates,
  recoverAutosave,
} from "./autosave.js";
