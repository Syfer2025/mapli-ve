/**
 * Persistência pequena e validada das preferências de atalhos.
 *
 * O caminho entra por argumento para manter este adapter testável sem Electron.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { SHORTCUT_PREFERENCES_VERSION, type ShortcutPreferences } from "../../ipc/contracts.js";

export const SHORTCUT_PREFERENCES_FILE_NAME = "preferences.json";
const MAX_FILE_BYTES = 64 * 1024;
const MAX_OVERRIDES = 128;
const MAX_COMMAND_ID_LENGTH = 80;
const MAX_CHORD_LENGTH = 80;

export async function loadShortcutPreferences(target: string): Promise<ShortcutPreferences | null> {
  const file = validAbsoluteFile(target);
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return isShortcutPreferences(parsed) ? freezePreferences(parsed) : null;
  } catch {
    // Ausência, truncamento ou falha de leitura nunca impede o editor de abrir.
    return null;
  }
}

export async function saveShortcutPreferences(
  target: string,
  preferences: ShortcutPreferences,
): Promise<void> {
  const file = validAbsoluteFile(target);
  if (!isShortcutPreferences(preferences)) {
    throw new RangeError("preferências de atalhos inválidas");
  }
  const bytes = JSON.stringify(preferences, null, 2);
  if (Buffer.byteLength(bytes, "utf8") > MAX_FILE_BYTES) {
    throw new RangeError("preferências de atalhos excedem o limite local");
  }

  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, "utf8");
    await rename(temporary, file);
  } catch (error: unknown) {
    await removeIfPresent(temporary);
    throw error;
  }
}

export async function resetShortcutPreferences(target: string): Promise<void> {
  await removeIfPresent(validAbsoluteFile(target));
}

export function isShortcutPreferences(value: unknown): value is ShortcutPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (Reflect.get(value, "version") !== SHORTCUT_PREFERENCES_VERSION) return false;
  const overrides = Reflect.get(value, "shortcutOverrides");
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    return false;
  }
  const entries = Object.entries(overrides);
  if (entries.length > MAX_OVERRIDES) return false;
  return entries.every(
    ([commandId, chord]) =>
      commandId.length > 0 &&
      commandId.length <= MAX_COMMAND_ID_LENGTH &&
      /^[a-z][a-z0-9:-]*$/.test(commandId) &&
      (chord === null ||
        (typeof chord === "string" &&
          chord.length <= MAX_CHORD_LENGTH &&
          isStoredShortcutChord(chord))),
  );
}

function freezePreferences(preferences: ShortcutPreferences): ShortcutPreferences {
  return Object.freeze({
    version: preferences.version,
    shortcutOverrides: Object.freeze({ ...preferences.shortcutOverrides }),
  });
}

function isStoredShortcutChord(value: string): boolean {
  const parts = value.split("+");
  if (parts.length === 0 || parts.length > 4) return false;
  const code = parts.at(-1);
  if (code === undefined || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(code)) return false;
  const modifiers = parts.slice(0, -1);
  const order = ["Mod", "Shift", "Alt"] as const;
  let previous = -1;
  for (const modifier of modifiers) {
    const index = order.indexOf(modifier as (typeof order)[number]);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

function validAbsoluteFile(target: string): string {
  if (typeof target !== "string" || target.length === 0 || !path.isAbsolute(target)) {
    throw new RangeError("arquivo de preferências precisa ter caminho absoluto");
  }
  return path.resolve(target);
}

async function removeIfPresent(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Reflect.get(error, "code") === "ENOENT"
  );
}
