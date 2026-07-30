import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SHORTCUT_PREFERENCES_VERSION } from "../../ipc/contracts.js";
import {
  isShortcutPreferences,
  loadShortcutPreferences,
  resetShortcutPreferences,
  saveShortcutPreferences,
} from "./shortcut-preferences-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("persistência de preferências de atalhos", () => {
  it("salva, carrega uma cópia congelada e reseta de forma idempotente", async () => {
    const target = await temporaryFile();
    const preferences = {
      version: SHORTCUT_PREFERENCES_VERSION,
      shortcutOverrides: {
        "history:undo": "Mod+Alt+KeyZ",
        "selection:delete": null,
      },
    } as const;

    await saveShortcutPreferences(target, preferences);
    const loaded = await loadShortcutPreferences(target);
    expect(loaded).toEqual(preferences);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded?.shortcutOverrides)).toBe(true);

    await resetShortcutPreferences(target);
    await resetShortcutPreferences(target);
    expect(await loadShortcutPreferences(target)).toBeNull();
  });

  it("recusa versão, estrutura, ids e chords inválidos", () => {
    expect(
      isShortcutPreferences({
        version: SHORTCUT_PREFERENCES_VERSION + 1,
        shortcutOverrides: {},
      }),
    ).toBe(false);
    expect(
      isShortcutPreferences({
        version: SHORTCUT_PREFERENCES_VERSION,
        shortcutOverrides: [],
      }),
    ).toBe(false);
    expect(
      isShortcutPreferences({
        version: SHORTCUT_PREFERENCES_VERSION,
        shortcutOverrides: { "History Undo": "Mod+KeyZ" },
      }),
    ).toBe(false);
    expect(
      isShortcutPreferences({
        version: SHORTCUT_PREFERENCES_VERSION,
        shortcutOverrides: { "history:undo": "Shift+Mod+KeyZ" },
      }),
    ).toBe(false);
  });

  it("trata JSON truncado e arquivo grande como preferência ausente", async () => {
    const target = await temporaryFile();
    await writeFile(target, '{"version":', "utf8");
    expect(await loadShortcutPreferences(target)).toBeNull();

    await writeFile(target, "x".repeat(65 * 1024), "utf8");
    expect(await loadShortcutPreferences(target)).toBeNull();
  });

  it("não substitui um arquivo válido quando a próxima gravação é rejeitada", async () => {
    const target = await temporaryFile();
    const valid = {
      version: SHORTCUT_PREFERENCES_VERSION,
      shortcutOverrides: { "history:undo": "Mod+KeyZ" },
    } as const;
    await saveShortcutPreferences(target, valid);
    const before = await readFile(target, "utf8");

    await expect(
      saveShortcutPreferences(target, {
        version: SHORTCUT_PREFERENCES_VERSION,
        shortcutOverrides: { "history:undo": "Shift+Mod+KeyZ" },
      }),
    ).rejects.toThrow(/inválidas/);
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("serializa mutações concorrentes na ordem de chamada e preserva a mais recente", async () => {
    const target = await temporaryFile();
    const first = {
      version: SHORTCUT_PREFERENCES_VERSION,
      shortcutOverrides: { "history:undo": "Mod+Alt+KeyZ" },
    } as const;
    const second = {
      version: SHORTCUT_PREFERENCES_VERSION,
      shortcutOverrides: { "history:undo": "Mod+Shift+KeyZ" },
    } as const;

    await Promise.all([
      saveShortcutPreferences(target, first),
      saveShortcutPreferences(target, second),
    ]);
    expect(await loadShortcutPreferences(target)).toEqual(second);

    await Promise.all([saveShortcutPreferences(target, first), resetShortcutPreferences(target)]);
    expect(await loadShortcutPreferences(target)).toBeNull();
  });

  it("exige caminho absoluto", async () => {
    await expect(loadShortcutPreferences("preferences.json")).rejects.toThrow(/absoluto/);
    await expect(resetShortcutPreferences("preferences.json")).rejects.toThrow(/absoluto/);
  });
});

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "theatrum-shortcuts-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "preferences.json");
}
