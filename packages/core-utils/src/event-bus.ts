/**
 * Event bus tipado, síncrono.
 *
 * Para notificação **lateral** entre módulos da mesma camada, sem criar
 * dependência de import. Não é fila de trabalho, não é caminho de mutação
 * (use o Command Bus) e não serve para pedir dados (use import direto).
 * Ver docs/01-ARCHITECTURE.md § 5.4.
 */

import { toDisposable, type Disposable } from "./disposable.js";

export interface EventBus<M extends Record<string, unknown>> {
  on<K extends keyof M>(event: K, listener: (payload: M[K]) => void): Disposable;
  once<K extends keyof M>(event: K, listener: (payload: M[K]) => void): Disposable;
  emit<K extends keyof M>(event: K, payload: M[K]): void;
  listenerCount(event: keyof M): number;
  clear(event?: keyof M): void;
}

export function createEventBus<M extends Record<string, unknown>>(): EventBus<M> {
  type AnyListener = (payload: never) => void;
  const listeners = new Map<keyof M, Set<AnyListener>>();

  function subscribe<K extends keyof M>(event: K, listener: (payload: M[K]) => void): Disposable {
    let set = listeners.get(event);
    if (set === undefined) {
      set = new Set();
      listeners.set(event, set);
    }
    const entry = listener as AnyListener;
    set.add(entry);
    return toDisposable(() => {
      const current = listeners.get(event);
      current?.delete(entry);
      if (current !== undefined && current.size === 0) listeners.delete(event);
    });
  }

  return {
    on: subscribe,

    once<K extends keyof M>(event: K, listener: (payload: M[K]) => void): Disposable {
      const handle = subscribe(event, (payload) => {
        handle.dispose();
        listener(payload);
      });
      return handle;
    },

    emit<K extends keyof M>(event: K, payload: M[K]): void {
      const set = listeners.get(event);
      if (set === undefined || set.size === 0) return;

      // Snapshot: um listener pode se remover, ou registrar outro, durante o
      // emit. Iterar o Set vivo daria comportamento dependente de ordem.
      const snapshot = [...set];
      const errors: unknown[] = [];

      for (const listener of snapshot) {
        try {
          (listener as (p: M[K]) => void)(payload);
        } catch (error: unknown) {
          // Um listener quebrado não impede os outros de rodar — mas o erro
          // não desaparece: é agregado e relançado abaixo.
          errors.push(error);
        }
      }

      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, `falhas em listeners de "${String(event)}"`);
      }
    },

    listenerCount(event: keyof M): number {
      return listeners.get(event)?.size ?? 0;
    },

    clear(event?: keyof M): void {
      if (event === undefined) listeners.clear();
      else listeners.delete(event);
    },
  };
}
