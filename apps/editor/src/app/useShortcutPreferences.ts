import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SHORTCUT_PREFERENCES_VERSION } from "@theatrum/shell";
import { bridge } from "../bridge/index.js";
import {
  ShortcutRegistry,
  commandDefinition,
  rebindShortcut,
  restoreShortcutDefault,
  sanitizeShortcutOverrides,
  type EditorCommandId,
  type ShortcutOverrides,
  type ShortcutRebindResult,
} from "./command-shortcuts.js";

const EMPTY_OVERRIDES: ShortcutOverrides = Object.freeze({});

export interface ShortcutPreferencesController {
  readonly ready: boolean;
  readonly registry: ShortcutRegistry;
  readonly overrides: ShortcutOverrides;
  readonly error: string | null;
  readonly rebind: (commandId: EditorCommandId, chord: string | null) => ShortcutRebindResult;
  readonly restoreDefault: (commandId: EditorCommandId) => void;
  readonly resetAll: () => Promise<void>;
  readonly clearError: () => void;
}

export function useShortcutPreferences(): ShortcutPreferencesController {
  const [overrides, setOverrides] = useState<ShortcutOverrides>(EMPTY_OVERRIDES);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overridesRef = useRef<ShortcutOverrides>(EMPTY_OVERRIDES);
  const mutations = useRef(0);

  const replace = useCallback((next: ShortcutOverrides): void => {
    overridesRef.current = next;
    setOverrides(next);
  }, []);

  const save = useCallback((next: ShortcutOverrides): void => {
    void bridge.preferences
      .save({
        version: SHORTCUT_PREFERENCES_VERSION,
        shortcutOverrides: next,
      })
      .then(() => setError(null))
      .catch((reason: unknown) => {
        setError(`Não foi possível salvar os atalhos: ${errorMessage(reason)}`);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const mutationAtStart = mutations.current;
    void bridge.preferences
      .load()
      .then((loaded) => {
        if (cancelled || mutations.current !== mutationAtStart) return;
        replace(sanitizeShortcutOverrides(loaded?.shortcutOverrides ?? EMPTY_OVERRIDES));
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(`Não foi possível carregar os atalhos: ${errorMessage(reason)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [replace]);

  const rebind = useCallback(
    (commandId: EditorCommandId, chord: string | null): ShortcutRebindResult => {
      const result = rebindShortcut(overridesRef.current, commandId, chord);
      if (!result.ok) {
        const other =
          result.conflict?.commandIds.find((candidate) => candidate !== commandId) ?? null;
        setError(
          result.reason === "conflict" && other !== null
            ? `Atalho já usado por “${commandDefinition(other).label}”.`
            : "Essa combinação não pode ser usada como atalho.",
        );
        return result;
      }
      mutations.current += 1;
      replace(result.overrides);
      save(result.overrides);
      return result;
    },
    [replace, save],
  );

  const restoreDefault = useCallback(
    (commandId: EditorCommandId): void => {
      mutations.current += 1;
      const next = restoreShortcutDefault(overridesRef.current, commandId);
      replace(next);
      save(next);
    },
    [replace, save],
  );

  const resetAll = useCallback(async (): Promise<void> => {
    mutations.current += 1;
    try {
      await bridge.preferences.reset();
      replace(EMPTY_OVERRIDES);
      setError(null);
    } catch (reason: unknown) {
      setError(`Não foi possível restaurar os atalhos: ${errorMessage(reason)}`);
    }
  }, [replace]);

  return {
    ready,
    registry: useMemo(() => new ShortcutRegistry(overrides), [overrides]),
    overrides,
    error,
    rebind,
    restoreDefault,
    resetAll,
    clearError: useCallback(() => setError(null), []),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
