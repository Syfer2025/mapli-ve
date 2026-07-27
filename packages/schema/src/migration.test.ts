import migrationFixture from "./__fixtures__/migrations/v1/project.json";
import { describe, expect, it } from "vitest";
import {
  FutureSchemaVersionError,
  MigrationRegistry,
  MissingMigrationError,
  createFictionalV2MigrationRegistry,
} from "./index.js";

describe("migrações", () => {
  it("executa a migração fictícia v1 → v2 e preserva dados opacos", () => {
    const inputSnapshot = JSON.parse(JSON.stringify(migrationFixture)) as unknown;
    const registry = createFictionalV2MigrationRegistry();
    const migrated = registry.migrate(migrationFixture, 2);
    const compositions = migrated["compositions"];

    expect(migrated.schemaVersion).toBe(2);
    expect(compositions).toEqual([
      {
        id: "cmp_main",
        nodes: {
          nd_legacy: {
            id: "nd_legacy",
            size: { mode: "screen", size: [56, 56] },
            pluginPayload: { future: "preservar" },
          },
          nd_modern: {
            id: "nd_modern",
            size: { mode: "ground", meters: [5000, 5000] },
          },
        },
      },
    ]);
    expect(migrated["$note"]).toBe("campos desconhecidos devem sobreviver");
    expect(migrated["pluginState"]).toEqual(migrationFixture.pluginState);
    expect(migrationFixture).toEqual(inputSnapshot);
  });

  it("encadeia apenas versões adjacentes e monotônicas", () => {
    const registry = new MigrationRegistry([
      {
        from: 1,
        to: 2,
        migrate: (document) => ({ ...document, schemaVersion: 2, v2: true }),
      },
      {
        from: 2,
        to: 3,
        migrate: (document) => ({ ...document, schemaVersion: 3, v3: true }),
      },
    ]);

    expect(registry.migrate({ schemaVersion: 1, untouched: true }, 3)).toEqual({
      schemaVersion: 3,
      untouched: true,
      v2: true,
      v3: true,
    });
    expect(
      () =>
        new MigrationRegistry([
          {
            from: 1,
            to: 3,
            migrate: (document) => ({ ...document, schemaVersion: 3 }),
          },
        ]),
    ).toThrow("adjacentes");
  });

  it("falha em lacuna, duplicata e retorno com versão errada", () => {
    expect(() => new MigrationRegistry().migrate({ schemaVersion: 1 }, 2)).toThrow(
      MissingMigrationError,
    );

    const duplicate = new MigrationRegistry([
      {
        from: 1,
        to: 2,
        migrate: (document) => ({ ...document, schemaVersion: 2 }),
      },
    ]);
    expect(() =>
      duplicate.register({
        from: 1,
        to: 2,
        migrate: (document) => ({ ...document, schemaVersion: 2 }),
      }),
    ).toThrow("Já existe migração");

    const broken = new MigrationRegistry([
      {
        from: 1,
        to: 2,
        migrate: (document) => document,
      },
    ]);
    expect(() => broken.migrate({ schemaVersion: 1 }, 2)).toThrow("devolveu schemaVersion 1");
  });

  it("não tenta migrar versão futura para trás", () => {
    expect(() => createFictionalV2MigrationRegistry().migrate({ schemaVersion: 99 }, 2)).toThrow(
      FutureSchemaVersionError,
    );
  });
});
