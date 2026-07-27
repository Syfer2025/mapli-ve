import { createEmptyProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";

import { createAutosaveManager, findRecoveryCandidates, recoverAutosave } from "./autosave.js";
import { MemoryProjectFileSystem, renameProject } from "./test-support.js";

describe("autosave e recuperação", () => {
  it("recupera base + patches após crash sem tocar no .theatrum", async () => {
    const fs = new MemoryProjectFileSystem();
    const project = createEmptyProjectDocument({ id: "prj_recovery", name: "Antes" });
    fs.files.set("projects/original.theatrum", Uint8Array.of(7, 7, 7));
    let clock = 1_000;
    const manager = createAutosaveManager({
      fileSystem: fs,
      recoveryRoot: "recovery",
      projectId: project.id,
      projectPath: "projects/original.theatrum",
      pid: 42,
      clock: { now: () => clock },
    });

    expect(await manager.initialize(project)).toEqual({ ok: true, value: undefined });
    const edited = renameProject(project, "Depois do crash");
    clock += 30_001;
    expect(await manager.record(edited)).toEqual({ ok: true, value: "patch" });

    const recovered = await recoverAutosave({
      fileSystem: fs,
      recoveryRoot: "recovery",
      projectId: project.id,
    });
    expect(recovered).toEqual({ ok: true, value: edited });
    expect(fs.files.get("projects/original.theatrum")).toEqual(Uint8Array.of(7, 7, 7));

    clock += 20_000;
    const candidates = await findRecoveryCandidates({
      fileSystem: fs,
      recoveryRoot: "recovery",
      clock: { now: () => clock },
    });
    expect(candidates).toMatchObject({
      ok: true,
      value: [
        {
          projectId: project.id,
          projectPath: "projects/original.theatrum",
          sequence: 1,
        },
      ],
    });
  });

  it("dispara por 20 comandos, compacta base em 10 min e remove no fechamento limpo", async () => {
    const fs = new MemoryProjectFileSystem();
    const project = createEmptyProjectDocument({ id: "prj_compact", name: "Base" });
    let clock = 0;
    const manager = createAutosaveManager({
      fileSystem: fs,
      recoveryRoot: "recovery",
      projectId: project.id,
      projectPath: null,
      pid: 1,
      clock: { now: () => clock },
    });
    await manager.initialize(project);

    const firstEdit = renameProject(project, "20 comandos");
    expect(await manager.record(firstEdit, { commands: 19 })).toEqual({
      ok: true,
      value: "skipped",
    });
    expect(await manager.record(firstEdit)).toEqual({ ok: true, value: "patch" });
    expect(fs.files.has("recovery/prj_compact/000001.patch.json")).toBe(true);
    const stalePatch = fs.files.get("recovery/prj_compact/000001.patch.json")?.slice();

    clock = 600_001;
    const secondEdit = renameProject(project, "Base compactada");
    expect(await manager.record(secondEdit)).toEqual({ ok: true, value: "base" });
    expect(fs.files.has("recovery/prj_compact/000001.patch.json")).toBe(false);
    // Simula crash logo após o novo base.json, antes da limpeza de patch antigo.
    if (stalePatch !== undefined) {
      fs.files.set("recovery/prj_compact/000001.patch.json", stalePatch);
    }
    expect(
      await recoverAutosave({
        fileSystem: fs,
        recoveryRoot: "recovery",
        projectId: project.id,
      }),
    ).toEqual({ ok: true, value: secondEdit });

    expect(await manager.closeClean()).toEqual({ ok: true, value: undefined });
    expect([...fs.files.keys()].some((path) => path.startsWith("recovery/prj_compact/"))).toBe(
      false,
    );
  });

  it("não avança estado quando a escrita do patch falha e recupera no retry", async () => {
    const fs = new MemoryProjectFileSystem();
    const project = createEmptyProjectDocument({ id: "prj_retry", name: "Base" });
    const manager = createAutosaveManager({
      fileSystem: fs,
      recoveryRoot: "recovery",
      projectId: project.id,
      projectPath: null,
      pid: 2,
      clock: { now: () => 1_000 },
    });
    await manager.initialize(project);
    fs.failWrite = true;
    const edited = renameProject(project, "Retry");
    expect(await manager.record(edited, { force: true })).toMatchObject({
      ok: false,
      error: { code: "io" },
    });

    fs.failWrite = false;
    expect(await manager.record(edited, { force: true })).toEqual({ ok: true, value: "patch" });
    expect(
      await recoverAutosave({
        fileSystem: fs,
        recoveryRoot: "recovery",
        projectId: project.id,
      }),
    ).toEqual({ ok: true, value: edited });
  });

  it("serializa record e heartbeat para que não disputem o mesmo temporário", async () => {
    const fs = new ConcurrencyDetectingFileSystem();
    const project = createEmptyProjectDocument({ id: "prj_serial", name: "Base" });
    const manager = createAutosaveManager({
      fileSystem: fs,
      recoveryRoot: "recovery",
      projectId: project.id,
      projectPath: null,
      pid: 4,
      clock: { now: () => 1_000 },
    });
    await manager.initialize(project);
    fs.resetConcurrency();

    const edited = renameProject(project, "Concorrência protegida");
    const [recorded, heartbeatOne, heartbeatTwo] = await Promise.all([
      manager.record(edited, { force: true }),
      manager.heartbeat(),
      manager.heartbeat(),
    ]);

    expect(recorded).toEqual({ ok: true, value: "patch" });
    expect(heartbeatOne).toEqual({ ok: true, value: undefined });
    expect(heartbeatTwo).toEqual({ ok: true, value: undefined });
    expect(fs.maximumConcurrentSessionWrites).toBe(1);
    expect(
      await recoverAutosave({
        fileSystem: fs,
        recoveryRoot: "recovery",
        projectId: project.id,
      }),
    ).toEqual({ ok: true, value: edited });
  });

  it("detecta lacuna de patches e schema futuro na recuperação", async () => {
    const fs = new MemoryProjectFileSystem();
    const project = createEmptyProjectDocument({ id: "prj_failure", name: "Falhas" });
    const manager = createAutosaveManager({
      fileSystem: fs,
      recoveryRoot: "recovery",
      projectId: project.id,
      projectPath: null,
      pid: 3,
      clock: { now: () => 1_000 },
    });
    await manager.initialize(project);
    await manager.record(renameProject(project, "Editado"), { force: true });
    const patch = fs.files.get("recovery/prj_failure/000001.patch.json");
    if (patch === undefined) throw new Error("patch fixture ausente");
    fs.files.delete("recovery/prj_failure/000001.patch.json");
    fs.files.set("recovery/prj_failure/000002.patch.json", patch);
    expect(
      await recoverAutosave({
        fileSystem: fs,
        recoveryRoot: "recovery",
        projectId: project.id,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-container", expected: 1, actual: 2 },
    });

    const basePath = "recovery/prj_failure/base.json";
    const base = JSON.parse(new TextDecoder().decode(fs.files.get(basePath))) as {
      document: Record<string, unknown>;
    };
    base.document["schemaVersion"] = 99;
    fs.files.set(basePath, new TextEncoder().encode(JSON.stringify(base)));
    expect(
      await recoverAutosave({
        fileSystem: fs,
        recoveryRoot: "recovery",
        projectId: project.id,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "future-schema", actual: 99 },
    });
  });
});

class ConcurrencyDetectingFileSystem extends MemoryProjectFileSystem {
  maximumConcurrentSessionWrites = 0;
  private concurrentSessionWrites = 0;

  resetConcurrency(): void {
    this.concurrentSessionWrites = 0;
    this.maximumConcurrentSessionWrites = 0;
  }

  override async write(path: string, bytes: Uint8Array): Promise<void> {
    const isSessionTemporary = path.replaceAll("\\", "/").endsWith("/session.json.tmp");
    if (!isSessionTemporary) {
      await super.write(path, bytes);
      return;
    }

    this.concurrentSessionWrites += 1;
    this.maximumConcurrentSessionWrites = Math.max(
      this.maximumConcurrentSessionWrites,
      this.concurrentSessionWrites,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await super.write(path, bytes);
    } finally {
      this.concurrentSessionWrites -= 1;
    }
  }
}
