import { z } from "zod";
import { APP_NAME, SCHEMA_VERSION } from "./branding.js";
import { ProjectDocumentSchema, type ProjectDocument } from "./project-document.js";

type VersionedObject = Record<string, unknown> & { schemaVersion: number };

export class FutureSchemaVersionError extends Error {
  readonly foundVersion: number;
  readonly supportedVersion: number;

  constructor(foundVersion: number, supportedVersion = SCHEMA_VERSION) {
    super(
      `Este projeto usa schemaVersion ${foundVersion}, mas esta versão do ${APP_NAME} suporta até ${supportedVersion}. Atualize o ${APP_NAME} para abrir o arquivo.`,
    );
    this.name = "FutureSchemaVersionError";
    this.foundVersion = foundVersion;
    this.supportedVersion = supportedVersion;
  }
}

export class InvalidSchemaVersionError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    super("schemaVersion deve ser um número inteiro positivo.");
    this.name = "InvalidSchemaVersionError";
    this.value = value;
  }
}

export class MissingMigrationError extends Error {
  readonly fromVersion: number;
  readonly targetVersion: number;

  constructor(fromVersion: number, targetVersion: number) {
    super(
      `Não há migração registrada de schemaVersion ${fromVersion} para ${fromVersion + 1} (destino ${targetVersion}).`,
    );
    this.name = "MissingMigrationError";
    this.fromVersion = fromVersion;
    this.targetVersion = targetVersion;
  }
}

export type MigrationFunction = (document: VersionedObject) => VersionedObject;

export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly migrate: MigrationFunction;
}

export class MigrationRegistry {
  readonly #migrations = new Map<number, Migration>();

  constructor(migrations: readonly Migration[] = []) {
    for (const migration of migrations) this.register(migration);
  }

  register(migration: Migration): this {
    assertVersion(migration.from);
    assertVersion(migration.to);
    if (migration.to !== migration.from + 1) {
      throw new RangeError(
        `Migrações devem ser monotônicas e adjacentes; recebido v${migration.from} → v${migration.to}.`,
      );
    }
    if (this.#migrations.has(migration.from)) {
      throw new Error(`Já existe migração registrada de v${migration.from} para v${migration.to}.`);
    }
    this.#migrations.set(migration.from, migration);
    return this;
  }

  get(fromVersion: number): Migration | undefined {
    return this.#migrations.get(fromVersion);
  }

  migrate(input: unknown, targetVersion = SCHEMA_VERSION): VersionedObject {
    assertVersion(targetVersion);
    const sourceVersion = getSchemaVersion(input);
    if (sourceVersion > targetVersion) {
      throw new FutureSchemaVersionError(sourceVersion, targetVersion);
    }

    let document = cloneData(input) as VersionedObject;
    while (document.schemaVersion < targetVersion) {
      const migration = this.#migrations.get(document.schemaVersion);
      if (migration === undefined) {
        throw new MissingMigrationError(document.schemaVersion, targetVersion);
      }
      const beforeVersion = document.schemaVersion;
      document = migration.migrate(document);
      if (document.schemaVersion !== migration.to) {
        throw new Error(
          `A migração v${beforeVersion} → v${migration.to} devolveu schemaVersion ${String(document.schemaVersion)}.`,
        );
      }
    }
    return document;
  }
}

export const projectMigrationRegistry = new MigrationRegistry();

export function registerMigration(
  from: number,
  to: number,
  migrate: MigrationFunction,
  registry: MigrationRegistry = projectMigrationRegistry,
): MigrationRegistry {
  return registry.register({ from, to, migrate });
}

export function getSchemaVersion(input: unknown): number {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InvalidSchemaVersionError(undefined);
  }
  const value = Reflect.get(input, "schemaVersion");
  assertVersion(value);
  return value;
}

export function assertSupportedSchemaVersion(
  input: unknown,
  supportedVersion = SCHEMA_VERSION,
): number {
  const version = getSchemaVersion(input);
  if (version > supportedVersion) throw new FutureSchemaVersionError(version, supportedVersion);
  return version;
}

export function migrateProjectDocument(
  input: unknown,
  targetVersion = SCHEMA_VERSION,
  registry: MigrationRegistry = projectMigrationRegistry,
): VersionedObject {
  return registry.migrate(input, targetVersion);
}

/**
 * Migração de prova pedida pela Fase 3. Ela não integra o registry de produção:
 * o formato corrente segue v1. O fixture imita um v1 pré-release em que `size`
 * era apenas Vec2 e prova preservação de campos desconhecidos.
 */
export const FICTIONAL_V1_TO_V2_MIGRATION: Migration = {
  from: 1,
  to: 2,
  migrate(document) {
    const compositions = Array.isArray(document["compositions"]) ? document["compositions"] : [];
    for (const composition of compositions) {
      if (typeof composition !== "object" || composition === null) continue;
      const nodes = Reflect.get(composition, "nodes");
      if (typeof nodes !== "object" || nodes === null || Array.isArray(nodes)) continue;
      for (const node of Object.values(nodes)) {
        if (typeof node !== "object" || node === null) continue;
        const size = Reflect.get(node, "size");
        if (Array.isArray(size) && size.length === 2) {
          Reflect.set(node, "size", { mode: "screen", size });
        }
      }
    }
    document.schemaVersion = 2;
    return document;
  },
};

export function createFictionalV2MigrationRegistry(): MigrationRegistry {
  return new MigrationRegistry([FICTIONAL_V1_TO_V2_MIGRATION]);
}

export function parseProjectDocument(input: unknown): ProjectDocument {
  assertSupportedSchemaVersion(input);
  return ProjectDocumentSchema.parse(input);
}

export function safeParseProjectDocument(input: unknown):
  | { readonly success: true; readonly data: ProjectDocument }
  | {
      readonly success: false;
      readonly error: FutureSchemaVersionError | InvalidSchemaVersionError | z.ZodError;
    } {
  try {
    return { success: true, data: parseProjectDocument(input) };
  } catch (error) {
    if (
      error instanceof FutureSchemaVersionError ||
      error instanceof InvalidSchemaVersionError ||
      error instanceof z.ZodError
    ) {
      return { success: false, error };
    }
    throw error;
  }
}

function assertVersion(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new InvalidSchemaVersionError(value);
  }
}

function cloneData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneData);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, cloneData(nestedValue)]),
  );
}
