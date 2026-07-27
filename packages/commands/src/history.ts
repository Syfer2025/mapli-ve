import { toDisposable, type Disposable } from "@theatrum/core-utils";
import type { DocumentStore, Patch } from "@theatrum/document";

export interface HistoryEntry {
  readonly sequence: number;
  readonly label: string;
  readonly commandTypes: readonly string[];
  readonly patches: readonly Patch[];
  readonly inverse: readonly Patch[];
}

export interface HistorySnapshot {
  readonly entries: readonly HistoryEntry[];
  /** Índice da última entrada aplicada; -1 representa o documento inicial. */
  readonly cursor: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type HistoryListener = (snapshot: HistorySnapshot) => void;

export interface History {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  entries(): readonly HistoryEntry[];
  cursor(): number;
  jumpTo(index: number): void;
  clear(): void;
  subscribe(listener: HistoryListener): Disposable;
}

export interface CommandHistoryOptions {
  readonly limit?: number;
}

export class CommandHistory implements History {
  readonly #document: DocumentStore;
  readonly #limit: number;
  readonly #listeners = new Set<HistoryListener>();
  #entries: HistoryEntry[] = [];
  #cursor = -1;
  #nextSequence = 1;

  constructor(document: DocumentStore, options: CommandHistoryOptions = {}) {
    const limit = options.limit ?? 500;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("O limite do histórico deve ser um inteiro positivo.");
    }
    this.#document = document;
    this.#limit = limit;
  }

  record(
    label: string,
    commandTypes: readonly string[],
    patches: readonly Patch[],
    inverse: readonly Patch[],
  ): HistoryEntry | undefined {
    if (patches.length === 0) return undefined;
    if (this.#cursor < this.#entries.length - 1) {
      this.#entries.splice(this.#cursor + 1);
    }

    const entry: HistoryEntry = Object.freeze({
      sequence: this.#nextSequence,
      label,
      commandTypes: Object.freeze([...commandTypes]),
      patches: Object.freeze([...patches]),
      inverse: Object.freeze([...inverse]),
    });
    this.#nextSequence += 1;
    this.#entries.push(entry);
    this.#cursor = this.#entries.length - 1;

    if (this.#entries.length > this.#limit) {
      const removed = this.#entries.length - this.#limit;
      this.#entries.splice(0, removed);
      this.#cursor -= removed;
    }
    this.#emit();
    return entry;
  }

  undo(): boolean {
    const entry = this.#entries[this.#cursor];
    if (entry === undefined) return false;
    this.#document.apply(entry.inverse);
    this.#cursor -= 1;
    this.#emit();
    return true;
  }

  redo(): boolean {
    const entry = this.#entries[this.#cursor + 1];
    if (entry === undefined) return false;
    this.#document.apply(entry.patches);
    this.#cursor += 1;
    this.#emit();
    return true;
  }

  canUndo(): boolean {
    return this.#cursor >= 0;
  }

  canRedo(): boolean {
    return this.#cursor < this.#entries.length - 1;
  }

  entries(): readonly HistoryEntry[] {
    return Object.freeze([...this.#entries]);
  }

  cursor(): number {
    return this.#cursor;
  }

  jumpTo(index: number): void {
    if (!Number.isInteger(index) || index < -1 || index >= this.#entries.length) {
      throw new RangeError(`Índice de histórico fora do intervalo: ${index}.`);
    }
    while (this.#cursor > index) this.undo();
    while (this.#cursor < index) this.redo();
  }

  clear(): void {
    if (this.#entries.length === 0 && this.#cursor === -1) return;
    this.#entries = [];
    this.#cursor = -1;
    this.#emit();
  }

  subscribe(listener: HistoryListener): Disposable {
    this.#listeners.add(listener);
    return toDisposable(() => {
      this.#listeners.delete(listener);
    });
  }

  #snapshot(): HistorySnapshot {
    return Object.freeze({
      entries: this.entries(),
      cursor: this.#cursor,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
  }

  #emit(): void {
    const snapshot = this.#snapshot();
    for (const listener of [...this.#listeners]) listener(snapshot);
  }
}
