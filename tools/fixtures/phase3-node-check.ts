/**
 * Provas da Fase 3 que precisam carregar os pacotes TypeScript diretamente.
 *
 * Este arquivo roda em um subprocesso `tsx` criado por verify-phase3.mjs. Ele
 * usa somente um diretório temporário e sempre o remove no final.
 */

import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Fixture executável fora do grafo de pacotes: tsx precisa carregar as fontes.
import {
  createEmptyProjectDocument,
  createFictionalV2MigrationRegistry,
  type ProjectDocument,
} from "../../packages/schema/src/index.js"; // eslint-disable-line theatrum/enforce-barrel-imports
import {
  createAutosaveManager,
  decodeZip,
  encodeCanonicalJson,
  encodeZip,
  findRecoveryCandidates,
  openProject,
  parseProjectContainer,
  recoverAutosave,
  saveProjectAtomic,
  serializeProjectContainer,
  type ProjectFileSystemPort,
  type ZipEntry,
} from "../../packages/project-io/src/index.js"; // eslint-disable-line theatrum/enforce-barrel-imports

const RESULT_PREFIX = "THEATRUM_PHASE3_NODE_RESULT ";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function equalData(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nodeFileSystem(): ProjectFileSystemPort {
  return {
    async read(filePath) {
      return new Uint8Array(await readFile(filePath));
    },
    async write(filePath, bytes) {
      await writeFile(filePath, bytes);
    },
    async sync(_filePath) {
      // O contrato de durabilidade é coberto pelos testes do adapter Electron.
      // Nesta prova isolada interessa exercitar write-temp + rename no disco.
    },
    async rename(source, destination) {
      await rename(source, destination);
    },
    async remove(filePath, options) {
      await rm(filePath, { recursive: options?.recursive ?? false, force: true });
    },
    async mkdir(directory) {
      await mkdir(directory, { recursive: true });
    },
    async list(directory) {
      return (await readdir(directory, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
      }));
    },
  };
}

async function verifyDeterministicFiles(
  fileSystem: ProjectFileSystemPort,
  directory: string,
  document: ProjectDocument,
) {
  const firstPath = path.join(directory, "first.theatrum");
  const secondPath = path.join(directory, "second.theatrum");
  const firstSave = await saveProjectAtomic(fileSystem, { path: firstPath, document });
  const secondSave = await saveProjectAtomic(fileSystem, { path: secondPath, document });
  assert(
    firstSave.ok,
    `primeiro save falhou: ${firstSave.ok ? "erro desconhecido" : firstSave.error.message}`,
  );
  assert(
    secondSave.ok,
    `segundo save falhou: ${secondSave.ok ? "erro desconhecido" : secondSave.error.message}`,
  );

  const firstBytes = new Uint8Array(await readFile(firstPath));
  const secondBytes = new Uint8Array(await readFile(secondPath));
  assert(equalBytes(firstBytes, secondBytes), "dois saves do mesmo documento divergiram");

  const opened = await openProject(fileSystem, firstPath);
  assert(opened.ok, `reabertura falhou: ${opened.ok ? "erro desconhecido" : opened.error.message}`);
  assert(equalData(opened.value.document, document), "documento reaberto divergiu do original");

  const originalJson = encodeCanonicalJson(document);
  const reopenedJson = encodeCanonicalJson(opened.value.document);
  assert(originalJson.ok && reopenedJson.ok, "não foi possível serializar o documento canônico");
  assert(
    equalBytes(originalJson.value, reopenedJson.value),
    "project.json reaberto não é idêntico byte a byte",
  );

  const resaved = serializeProjectContainer({ document: opened.value.document });
  assert(resaved.ok, `resave falhou: ${resaved.ok ? "erro desconhecido" : resaved.error.message}`);
  assert(equalBytes(firstBytes, resaved.value), "container reaberto e salvo novamente divergiu");

  return {
    bytes: firstBytes.length,
    filesByteIdentical: true,
    projectJsonByteIdentical: true,
    reopenAndResaveByteIdentical: true,
    originalPathUntouched: firstPath,
  };
}

function verifyFutureSchema(document: ProjectDocument) {
  const normal = serializeProjectContainer({ document });
  assert(normal.ok, "não foi possível criar o container-base para schema futuro");
  const decoded = decodeZip(normal.value);
  assert(decoded.ok, "não foi possível abrir o container-base para schema futuro");

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const futureEntries: ZipEntry[] = decoded.value.map((entry) => {
    if (entry.name !== "manifest.json" && entry.name !== "project.json") return entry;
    const value = JSON.parse(decoder.decode(entry.bytes)) as Record<string, unknown>;
    value["schemaVersion"] = 99;
    return { name: entry.name, bytes: encoder.encode(`${JSON.stringify(value)}\n`) };
  });
  const futureContainer = encodeZip(futureEntries);
  assert(futureContainer.ok, "não foi possível montar o container de schema futuro");

  const future = parseProjectContainer(futureContainer.value);
  assert(!future.ok, "schemaVersion 99 foi aceito");
  assert(
    future.error.code === "future-schema",
    `erro futuro classificado como ${future.error.code}`,
  );
  assert(
    future.error.message.includes("99") &&
      future.error.message.toLocaleLowerCase("pt-BR").includes("atualize"),
    `mensagem de schema futuro não é acionável: ${future.error.message}`,
  );
  return { code: future.error.code, message: future.error.message };
}

async function verifyFictionalMigration() {
  const fixtureUrl = new URL(
    "../../packages/schema/src/__fixtures__/migrations/v1/project.json",
    import.meta.url,
  );
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as Record<string, unknown>;
  const before = JSON.parse(JSON.stringify(fixture)) as unknown;
  const migrated = createFictionalV2MigrationRegistry().migrate(fixture, 2);
  const compositions = migrated["compositions"] as Array<{
    nodes: Record<string, { size: unknown; pluginPayload?: unknown }>;
  }>;

  assert(migrated.schemaVersion === 2, "migração fictícia não chegou à v2");
  assert(
    equalData(compositions[0]?.nodes["nd_legacy"]?.size, {
      mode: "screen",
      size: [56, 56],
    }),
    "migração fictícia não converteu size legado",
  );
  assert(migrated["$note"] === "campos desconhecidos devem sobreviver", "campo $ foi perdido");
  assert(
    equalData(compositions[0]?.nodes["nd_legacy"]?.pluginPayload, { future: "preservar" }),
    "payload opaco foi perdido",
  );
  assert(equalData(fixture, before), "migração alterou o fixture de entrada");
  return { from: 1, to: 2, fixturePreserved: true, opaqueFieldsPreserved: true };
}

async function verifyRecovery(
  fileSystem: ProjectFileSystemPort,
  directory: string,
  document: ProjectDocument,
  originalProjectPath: string,
) {
  const recoveryRoot = path.join(directory, "recovery");
  let clock = 1_000;
  const manager = createAutosaveManager({
    fileSystem,
    recoveryRoot,
    projectId: document.id,
    projectPath: originalProjectPath,
    pid: 42,
    clock: { now: () => clock },
  });
  const initialized = await manager.initialize(document);
  assert(
    initialized.ok,
    `inicialização do autosave falhou: ${initialized.ok ? "" : initialized.error.message}`,
  );

  const edited = { ...document, name: "Depois do crash simulado" };
  clock += 30_001;
  const recorded = await manager.record(edited, { force: true });
  assert(recorded.ok && recorded.value === "patch", "autosave não gravou patch incremental");

  const candidates = await findRecoveryCandidates({
    fileSystem,
    recoveryRoot,
    clock: { now: () => clock + 20_000 },
    isProcessAlive: async () => false,
  });
  assert(
    candidates.ok,
    `busca de recovery falhou: ${candidates.ok ? "" : candidates.error.message}`,
  );
  assert(candidates.value.length === 1, "crash simulado não produziu um candidato");

  const recovered = await recoverAutosave({
    fileSystem,
    recoveryRoot,
    projectId: document.id,
  });
  assert(recovered.ok, `recuperação falhou: ${recovered.ok ? "" : recovered.error.message}`);
  assert(equalData(recovered.value, edited), "base + patch não recuperou o documento editado");

  const originalBytes = new Uint8Array(await readFile(originalProjectPath));
  const originalParsed = parseProjectContainer(originalBytes);
  assert(originalParsed.ok, "autosave tocou ou corrompeu o .theatrum original");
  assert(
    equalData(originalParsed.value.document, document),
    "autosave alterou o .theatrum original",
  );

  await manager.closeClean();
  return {
    candidateCount: candidates.value.length,
    sequence: candidates.value[0]?.sequence ?? 0,
    recoveredName: recovered.value.name,
    originalProjectUntouched: true,
  };
}

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "theatrum-phase3-check-"));
  try {
    const fileSystem = nodeFileSystem();
    const document = createEmptyProjectDocument({
      id: "prj_phase3_verification",
      name: "Verificação Fase 3",
    });
    const deterministic = await verifyDeterministicFiles(fileSystem, directory, document);
    const futureSchema = verifyFutureSchema(document);
    const migration = await verifyFictionalMigration();
    const recovery = await verifyRecovery(
      fileSystem,
      directory,
      document,
      deterministic.originalPathUntouched,
    );

    process.stdout.write(
      `${RESULT_PREFIX}${JSON.stringify({
        deterministic: {
          bytes: deterministic.bytes,
          filesByteIdentical: deterministic.filesByteIdentical,
          projectJsonByteIdentical: deterministic.projectJsonByteIdentical,
          reopenAndResaveByteIdentical: deterministic.reopenAndResaveByteIdentical,
        },
        futureSchema,
        migration,
        recovery,
      })}\n`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
