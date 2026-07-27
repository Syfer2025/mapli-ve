/**
 * Descarte determinístico de recursos.
 *
 * Todo registro em registry devolve um `Disposable`. É isso que permite ao
 * plugin-host descarregar um plugin sem deixar resíduo — critério de saída da
 * Fase 10.
 */

export interface Disposable {
  dispose(): void;
}

export function toDisposable(fn: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (done) return; // idempotente: descartar duas vezes não é erro
      done = true;
      fn();
    },
  };
}

export const NO_OP_DISPOSABLE: Disposable = { dispose() {} };

/**
 * Descarta todos, mesmo que algum lance. Erros são agregados e relançados no
 * final — nada é engolido em silêncio, e um recurso quebrado não impede o
 * descarte dos outros.
 */
export function disposeAll(disposables: Iterable<Disposable>): void {
  const errors: unknown[] = [];
  for (const d of disposables) {
    try {
      d.dispose();
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "falhas ao descartar recursos");
}

/** Coleção de `Disposable`s com descarte em lote. */
export class DisposableStore implements Disposable {
  #items = new Set<Disposable>();
  #disposed = false;

  get size(): number {
    return this.#items.size;
  }

  get isDisposed(): boolean {
    return this.#disposed;
  }

  /**
   * Adiciona ao store e devolve o próprio recurso, para uso em cadeia.
   * Adicionar a um store já descartado descarta imediatamente — evita
   * vazamento silencioso em código de inicialização que chega atrasado.
   */
  add<T extends Disposable>(item: T): T {
    if (this.#disposed) {
      item.dispose();
      return item;
    }
    this.#items.add(item);
    return item;
  }

  /** Remove sem descartar — para transferir a posse do recurso. */
  detach(item: Disposable): boolean {
    return this.#items.delete(item);
  }

  /** Descarta tudo, mas mantém o store utilizável. */
  clear(): void {
    const items = [...this.#items];
    this.#items.clear();
    disposeAll(items);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const items = [...this.#items];
    this.#items.clear();
    disposeAll(items);
  }
}
