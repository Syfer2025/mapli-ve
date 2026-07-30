import type { ShortcutPreferences } from "@theatrum/shell";

export const EDITOR_COMMANDS = [
  {
    id: "project:new",
    label: "Novo projeto",
    category: "Arquivo",
    defaultChords: ["Mod+KeyN"],
    scope: "global",
  },
  {
    id: "project:open",
    label: "Abrir projeto",
    category: "Arquivo",
    defaultChords: ["Mod+KeyO"],
    scope: "global",
  },
  {
    id: "project:save",
    label: "Salvar projeto",
    category: "Arquivo",
    defaultChords: ["Mod+KeyS"],
    scope: "global",
  },
  {
    id: "project:save-as",
    label: "Salvar projeto como",
    category: "Arquivo",
    defaultChords: ["Mod+Shift+KeyS"],
    scope: "global",
  },
  {
    id: "history:undo",
    label: "Desfazer",
    category: "Editar",
    defaultChords: ["Mod+KeyZ"],
    scope: "editor",
  },
  {
    id: "history:redo",
    label: "Refazer",
    category: "Editar",
    defaultChords: ["Mod+Shift+KeyZ"],
    scope: "editor",
  },
  {
    id: "selection:copy",
    label: "Copiar seleção",
    category: "Editar",
    defaultChords: ["Mod+KeyC"],
    scope: "editor",
  },
  {
    id: "selection:paste",
    label: "Colar seleção",
    category: "Editar",
    defaultChords: ["Mod+KeyV"],
    scope: "editor",
  },
  {
    id: "selection:duplicate",
    label: "Duplicar seleção",
    category: "Editar",
    defaultChords: ["Mod+KeyD"],
    scope: "editor",
  },
  {
    id: "selection:group",
    label: "Agrupar seleção",
    category: "Editar",
    defaultChords: ["Mod+KeyG"],
    scope: "editor",
  },
  {
    id: "selection:ungroup",
    label: "Desagrupar seleção",
    category: "Editar",
    defaultChords: ["Mod+Shift+KeyG"],
    scope: "editor",
  },
  {
    id: "selection:delete",
    label: "Excluir seleção",
    category: "Editar",
    defaultChords: ["Delete", "Backspace"],
    scope: "editor",
  },
  {
    id: "selection:clear",
    label: "Limpar seleção",
    category: "Editar",
    defaultChords: ["Escape"],
    scope: "editor",
  },
  {
    id: "playback:toggle",
    label: "Reproduzir / pausar",
    category: "Timeline",
    defaultChords: ["Space"],
    scope: "editor",
  },
] as const;

export type EditorCommandDefinition = (typeof EDITOR_COMMANDS)[number];
export type EditorCommandId = EditorCommandDefinition["id"];
export type ShortcutOverrides = ShortcutPreferences["shortcutOverrides"];

export interface ShortcutKeyboardInput {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly repeat?: boolean;
}

export interface ShortcutConflict {
  readonly chord: string;
  readonly commandIds: readonly EditorCommandId[];
}

export type ShortcutRebindResult =
  | { readonly ok: true; readonly overrides: ShortcutOverrides }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "conflict";
      readonly conflict?: ShortcutConflict;
    };

const COMMAND_IDS = new Set<string>(EDITOR_COMMANDS.map((command) => command.id));
const MODIFIERS = ["Mod", "Shift", "Alt"] as const;
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
]);

/** Snapshot imutável que resolve um chord para no máximo um comando. */
export class ShortcutRegistry {
  readonly #bindings = new Map<EditorCommandId, readonly string[]>();
  readonly #commandsByChord = new Map<string, EditorCommandId[]>();

  constructor(overrides: ShortcutOverrides = {}) {
    const supported = sanitizeShortcutOverrides(overrides);
    for (const command of EDITOR_COMMANDS) {
      const hasOverride = Object.hasOwn(supported, command.id);
      const override = supported[command.id];
      const chords: readonly string[] = hasOverride
        ? override === null
          ? Object.freeze([])
          : typeof override === "string"
            ? Object.freeze([override])
            : command.defaultChords
        : command.defaultChords;
      this.#bindings.set(command.id, chords);
      for (const chord of chords) {
        const commands = this.#commandsByChord.get(chord) ?? [];
        commands.push(command.id);
        this.#commandsByChord.set(chord, commands);
      }
    }
  }

  bindingFor(commandId: EditorCommandId): readonly string[] {
    return this.#bindings.get(commandId) ?? Object.freeze([]);
  }

  resolveChord(chord: string): EditorCommandId | null {
    const commands = this.#commandsByChord.get(chord);
    return commands?.length === 1 ? (commands[0] ?? null) : null;
  }

  resolveKeyboardEvent(event: ShortcutKeyboardInput): EditorCommandId | null {
    if (event.repeat === true) return null;
    const chord = shortcutFromKeyboardEvent(event);
    return chord === null ? null : this.resolveChord(chord);
  }

  conflicts(): readonly ShortcutConflict[] {
    return Object.freeze(
      [...this.#commandsByChord.entries()]
        .filter(([, commandIds]) => commandIds.length > 1)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([chord, commandIds]) =>
          Object.freeze({
            chord,
            commandIds: Object.freeze([...commandIds]),
          }),
        ),
    );
  }
}

export function shortcutFromKeyboardEvent(event: ShortcutKeyboardInput): string | null {
  if (MODIFIER_CODES.has(event.code) || !isShortcutCode(event.code)) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(event.code);
  const chord = parts.join("+");
  return isShortcutChord(chord) ? chord : null;
}

export function isShortcutChord(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) return false;
  const parts = value.split("+");
  if (parts.length === 0 || parts.length > 4) return false;
  const code = parts.at(-1);
  if (code === undefined || !isShortcutCode(code)) return false;
  let previous = -1;
  for (const modifier of parts.slice(0, -1)) {
    const index = MODIFIERS.indexOf(modifier as (typeof MODIFIERS)[number]);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

export function isEditorCommandId(value: string): value is EditorCommandId {
  return COMMAND_IDS.has(value);
}

export function commandDefinition(commandId: EditorCommandId): EditorCommandDefinition {
  const definition = EDITOR_COMMANDS.find((command) => command.id === commandId);
  if (definition === undefined) throw new RangeError(`comando desconhecido: ${commandId}`);
  return definition;
}

export function sanitizeShortcutOverrides(overrides: ShortcutOverrides): ShortcutOverrides {
  const supported: Record<string, string | null> = {};
  for (const [commandId, chord] of Object.entries(overrides)) {
    if (!isEditorCommandId(commandId)) continue;
    if (chord !== null && !isShortcutChord(chord)) continue;
    supported[commandId] = chord;
  }
  return Object.freeze(supported);
}

export function rebindShortcut(
  overrides: ShortcutOverrides,
  commandId: EditorCommandId,
  chord: string | null,
): ShortcutRebindResult {
  if (chord !== null && !isShortcutChord(chord)) {
    return Object.freeze({ ok: false, reason: "invalid" as const });
  }
  const next = { ...sanitizeShortcutOverrides(overrides), [commandId]: chord };
  const registry = new ShortcutRegistry(next);
  const conflict = registry
    .conflicts()
    .find((candidate) => candidate.commandIds.includes(commandId));
  return conflict === undefined
    ? Object.freeze({ ok: true, overrides: Object.freeze(next) })
    : Object.freeze({ ok: false, reason: "conflict" as const, conflict });
}

export function restoreShortcutDefault(
  overrides: ShortcutOverrides,
  commandId: EditorCommandId,
): ShortcutOverrides {
  const next: Record<string, string | null> = { ...sanitizeShortcutOverrides(overrides) };
  delete next[commandId];
  return Object.freeze(next);
}

export function formatShortcut(chord: string, mac = false): string {
  if (!isShortcutChord(chord)) return chord;
  return chord
    .split("+")
    .map((part) => {
      if (part === "Mod") return mac ? "⌘" : "Ctrl";
      if (part.startsWith("Key")) return part.slice(3);
      if (part.startsWith("Digit")) return part.slice(5);
      if (part === "Space") return "Espaço";
      if (part === "Escape") return "Esc";
      if (part === "Backspace") return "Backspace";
      if (part === "Delete") return "Delete";
      return part;
    })
    .join("+");
}

function isShortcutCode(value: string): boolean {
  return (
    /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(value) &&
    !MODIFIER_CODES.has(value) &&
    value !== "Unidentified" &&
    !MODIFIERS.includes(value as (typeof MODIFIERS)[number])
  );
}
