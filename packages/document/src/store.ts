import { toDisposable, type Disposable } from "@theatrum/core-utils";
import type { ProjectDocument } from "@theatrum/schema";
import {
  applyPatches,
  enablePatches,
  freeze,
  produceWithPatches,
  type Draft,
  type Patch,
} from "immer";
import { assertValidDocument } from "./validation.js";

enablePatches();

export interface MutationResult {
  readonly patches: readonly Patch[];
  readonly inverse: readonly Patch[];
}

export type DocumentMutation = (draft: Draft<ProjectDocument>) => void;
export type DocumentListener = (patches: readonly Patch[]) => void;

export interface DocumentStore {
  /** O valor é profundamente congelado e só muda por referência após commit. */
  get(): ProjectDocument;
  mutate(mutation: DocumentMutation): MutationResult;
  apply(patches: readonly Patch[]): void;
  replace(document: unknown): MutationResult;
  subscribe(listener: DocumentListener): Disposable;
}

export interface DocumentStoreOptions {
  /** Útil apenas para benchmarks; produção e testes devem manter true. */
  readonly validateMutations?: boolean;
}

export function createDocumentStore(
  initialDocument: unknown,
  options: DocumentStoreOptions = {},
): DocumentStore {
  return new ImmutableDocumentStore(initialDocument, options);
}

class ImmutableDocumentStore implements DocumentStore {
  #document: ProjectDocument;
  readonly #listeners = new Set<DocumentListener>();
  readonly #validateMutations: boolean;

  constructor(initialDocument: unknown, options: DocumentStoreOptions) {
    this.#document = freeze(assertValidDocument(initialDocument), true);
    this.#validateMutations = options.validateMutations ?? true;
  }

  get(): ProjectDocument {
    return this.#document;
  }

  mutate(mutation: DocumentMutation): MutationResult {
    const [next, patches, inverse] = produceWithPatches(this.#document, mutation);
    if (patches.length === 0) return EMPTY_MUTATION;
    this.#commit(next, patches);
    return freeze({ patches, inverse }, true);
  }

  apply(patches: readonly Patch[]): void {
    if (patches.length === 0) return;
    const next = applyPatches(this.#document, patches);
    this.#commit(next, patches);
  }

  replace(document: unknown): MutationResult {
    const next = freeze(assertValidDocument(document), true);
    const patches: readonly Patch[] = freeze([{ op: "replace", path: [], value: next }], true);
    const inverse: readonly Patch[] = freeze(
      [{ op: "replace", path: [], value: this.#document }],
      true,
    );
    this.#commit(next, patches);
    return freeze({ patches, inverse }, true);
  }

  subscribe(listener: DocumentListener): Disposable {
    this.#listeners.add(listener);
    return toDisposable(() => {
      this.#listeners.delete(listener);
    });
  }

  #commit(next: ProjectDocument, patches: readonly Patch[]): void {
    if (this.#validateMutations) assertValidDocument(next);
    this.#document = next;
    for (const listener of [...this.#listeners]) listener(patches);
  }
}

const EMPTY_MUTATION: MutationResult = freeze({ patches: [], inverse: [] }, true);

export type { Draft, Patch };
