/**
 * @theatrum/document — L1 · dados
 *
 * Store imutável, patches, validação relacional, migração e seletores.
 */

export {
  createDocumentStore,
  type DocumentListener,
  type DocumentMutation,
  type DocumentStore,
  type DocumentStoreOptions,
  type Draft,
  type MutationResult,
  type Patch,
} from "./store.js";
export { select, type PropertyPath } from "./selectors.js";
export {
  assertValidDocument,
  formatValidationIssues,
  validateDocument,
  DocumentValidationError,
  type DocumentValidationCode,
  type DocumentValidationIssue,
} from "./validation.js";
export {
  migrate,
  registerMigration,
  type MigrationError,
  type MigrationErrorKind,
} from "./migrations.js";
