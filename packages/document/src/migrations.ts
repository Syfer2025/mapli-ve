import { err, ok, type Result } from "@theatrum/core-utils";
import {
  FutureSchemaVersionError,
  InvalidSchemaVersionError,
  MissingMigrationError,
  migrateProjectDocument,
  registerMigration as registerSchemaMigration,
  type MigrationFunction,
  type ProjectDocument,
} from "@theatrum/schema";
import { validateDocument } from "./validation.js";

export type MigrationErrorKind =
  | "future-version"
  | "invalid-version"
  | "missing-migration"
  | "migration-failed"
  | "invalid-document";

export interface MigrationError {
  readonly kind: MigrationErrorKind;
  readonly message: string;
  readonly cause?: unknown;
}

/** Registra uma etapa monotônica no registry canônico do schema. */
export function registerMigration(from: number, to: number, migration: MigrationFunction): void {
  registerSchemaMigration(from, to, migration);
}

/** Migra, valida com Zod e então verifica as relações internas do documento. */
export function migrate(raw: unknown): Result<ProjectDocument, MigrationError> {
  let migrated: unknown;
  try {
    migrated = migrateProjectDocument(raw);
  } catch (error: unknown) {
    return err(toMigrationError(error));
  }

  const validated = validateDocument(migrated);
  if (validated.ok) return ok(validated.value);
  return err({
    kind: "invalid-document",
    message: `O documento migrado continua inválido: ${validated.error[0]?.message ?? "erro desconhecido"}`,
    cause: validated.error,
  });
}

function toMigrationError(error: unknown): MigrationError {
  if (error instanceof FutureSchemaVersionError) {
    return { kind: "future-version", message: error.message, cause: error };
  }
  if (error instanceof InvalidSchemaVersionError) {
    return { kind: "invalid-version", message: error.message, cause: error };
  }
  if (error instanceof MissingMigrationError) {
    return { kind: "missing-migration", message: error.message, cause: error };
  }
  return {
    kind: "migration-failed",
    message: error instanceof Error ? error.message : "A migração falhou.",
    cause: error,
  };
}
