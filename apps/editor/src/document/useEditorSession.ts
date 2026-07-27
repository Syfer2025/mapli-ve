import { useSyncExternalStore } from "react";
import {
  getEditorSessionSnapshot,
  subscribeEditorSession,
  type EditorSessionSnapshot,
} from "./editor-session.js";

export function useEditorSession(): EditorSessionSnapshot {
  return useSyncExternalStore(
    subscribeEditorSession,
    getEditorSessionSnapshot,
    getEditorSessionSnapshot,
  );
}
