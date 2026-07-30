import { describe, expect, it } from "vitest";
import {
  EDITOR_COMMANDS,
  ShortcutRegistry,
  formatShortcut,
  rebindShortcut,
  restoreShortcutDefault,
  sanitizeShortcutOverrides,
  shortcutFromKeyboardEvent,
} from "./command-shortcuts.js";

describe("registry de comandos e atalhos", () => {
  it("mantém defaults sem conflito e resolve aliases de exclusão", () => {
    const registry = new ShortcutRegistry();
    expect(registry.conflicts()).toEqual([]);
    expect(registry.resolveChord("Mod+KeyS")).toBe("project:save");
    expect(registry.resolveChord("Delete")).toBe("selection:delete");
    expect(registry.resolveChord("Backspace")).toBe("selection:delete");
    expect(EDITOR_COMMANDS.length).toBeGreaterThan(10);
  });

  it("detecta conflito e não despacha combinação ambígua", () => {
    const result = rebindShortcut({}, "selection:duplicate", "Mod+KeyS");
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      conflict: {
        chord: "Mod+KeyS",
        commandIds: ["project:save", "selection:duplicate"],
      },
    });

    const registry = new ShortcutRegistry({
      "selection:duplicate": "Mod+KeyS",
    });
    expect(registry.resolveChord("Mod+KeyS")).toBeNull();
    expect(registry.conflicts()).toHaveLength(1);
  });

  it("permite substituir, desabilitar e restaurar o default", () => {
    const rebound = rebindShortcut({}, "history:undo", "Mod+Alt+KeyZ");
    if (!rebound.ok) throw new Error("fixture deveria ser válida");
    expect(new ShortcutRegistry(rebound.overrides).resolveChord("Mod+Alt+KeyZ")).toBe(
      "history:undo",
    );
    expect(new ShortcutRegistry(rebound.overrides).resolveChord("Mod+KeyZ")).toBeNull();

    const disabled = rebindShortcut(rebound.overrides, "history:undo", null);
    if (!disabled.ok) throw new Error("desabilitar deveria ser válido");
    expect(new ShortcutRegistry(disabled.overrides).bindingFor("history:undo")).toEqual([]);

    const restored = restoreShortcutDefault(disabled.overrides, "history:undo");
    expect(new ShortcutRegistry(restored).resolveChord("Mod+KeyZ")).toBe("history:undo");
  });

  it("normaliza KeyboardEvent por code e ignora modificador puro ou repeat", () => {
    const input = {
      code: "KeyS",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
    };
    expect(shortcutFromKeyboardEvent(input)).toBe("Mod+Shift+KeyS");
    expect(new ShortcutRegistry().resolveKeyboardEvent(input)).toBe("project:save-as");
    expect(new ShortcutRegistry().resolveKeyboardEvent({ ...input, repeat: true })).toBeNull();
    expect(shortcutFromKeyboardEvent({ ...input, code: "ControlLeft" })).toBeNull();
  });

  it("remove ids e chords externos ao catálogo ao carregar", () => {
    expect(
      sanitizeShortcutOverrides({
        "history:undo": "Mod+Alt+KeyZ",
        "plugin:desconhecido": "Mod+KeyP",
        "selection:copy": "Shift+Mod+KeyC",
      }),
    ).toEqual({ "history:undo": "Mod+Alt+KeyZ" });
  });

  it("formata chords sem alterar a representação persistida", () => {
    expect(formatShortcut("Mod+Shift+KeyS")).toBe("Ctrl+Shift+S");
    expect(formatShortcut("Mod+Shift+KeyS", true)).toBe("⌘+Shift+S");
    expect(formatShortcut("Space")).toBe("Espaço");
  });
});
