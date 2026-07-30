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
  const persistenceTail = useRef<Promise<void>>(Promise.resolve());
  const persistenceRevision = useRef(0);

  const replace = useCallback((next: ShortcutOverrides): void => {
    overridesRef.current = next;
    setOverrides(next);
  }, []);

  const enqueuePersistence = useCallback(
    (operation: () => Promise<void>, failurePrefix: string): Promise<void> => {
      const revision = ++persistenceRevision.current;
      const execution = persistenceTail.current.then(operation, operation);
      persistenceTail.current = execution.then(
        () => undefined,
        () => undefined,
      );
      void execution.then(
        () => {
          if (persistenceRevision.current === revision) setError(null);
        },
        (reason: unknown) => {
          if (persistenceRevision.current === revision) {
            setError(`${failurePrefix}: ${errorMessage(reason)}`);
          }
        },
      );
      return execution;
    },
    [],
  );

  const save = useCallback(
    (next: ShortcutOverrides): void => {
      void enqueuePersistence(
        () =>
          bridge.preferences.save({
            version: SHORTCUT_PREFERENCES_VERSION,
            shortcutOverrides: next,
          }),
        "Não foi possível salvar os atalhos",
      );
    },
    [enqueuePersistence],
  );

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
    const mutation = mutations.current;
    try {
      await enqueuePersistence(
        () => bridge.preferences.reset(),
        "Não foi possível restaurar os atalhos",
      );
      if (mutations.current === mutation) replace(EMPTY_OVERRIDES);
    } catch {
      // `enqueuePersistence` já publicou o erro somente se esta ainda é a
      // operação mais recente; uma falha antiga não pode apagar o estado novo.
    }
  }, [enqueuePersistence, replace]);

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
