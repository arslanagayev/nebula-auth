/**
 * A tiny, strongly typed publish/subscribe bus.
 *
 * The UI and the WebGL scene never import each other: the UI publishes intent
 * ("a field got focus", "sign-in is pending") and the scene decides how to react.
 * That keeps the scene lazy-loadable and every UI module testable without a GPU.
 */

export type Handler<Payload> = (payload: Payload) => void;

export interface SubscribeOptions {
  /** Immediately invoke the handler with the most recent payload of this type, if any. */
  readonly replay?: boolean;
  /** Unsubscribe automatically when this signal aborts. */
  readonly signal?: AbortSignal;
}

export interface EventBusOptions {
  /**
   * Called when a handler throws. The default re-throws asynchronously so the error
   * still reaches the console / error tracking without breaking other subscribers,
   * mirroring how the DOM reports exceptions thrown by event listeners.
   */
  readonly onError?: (error: unknown, type: PropertyKey) => void;
}

type AnyHandler = (payload: never) => void;

const rethrowAsync = (error: unknown): void => {
  queueMicrotask(() => {
    throw error;
  });
};

export class EventBus<Events extends object> {
  readonly #handlers = new Map<keyof Events, Set<AnyHandler>>();
  readonly #latest = new Map<keyof Events, unknown>();
  readonly #onError: (error: unknown, type: PropertyKey) => void;

  constructor(options: EventBusOptions = {}) {
    this.#onError = options.onError ?? rethrowAsync;
  }

  /** Subscribe to an event. Returns a function that removes the subscription. */
  on<K extends keyof Events>(
    type: K,
    handler: Handler<Events[K]>,
    options: SubscribeOptions = {},
  ): () => void {
    const { signal, replay = false } = options;
    const unsubscribe = (): void => {
      this.off(type, handler);
    };

    if (signal?.aborted) return unsubscribe;

    let handlers = this.#handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(type, handlers);
    }
    handlers.add(handler);
    signal?.addEventListener('abort', unsubscribe, { once: true });

    if (replay && this.#latest.has(type)) {
      this.#invoke(type, handler, this.#latest.get(type) as Events[K]);
    }
    return unsubscribe;
  }

  /** Subscribe to the next occurrence of an event only. */
  once<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    const handlers = this.#handlers.get(type);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) this.#handlers.delete(type);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.#latest.set(type, payload);
    const handlers = this.#handlers.get(type);
    if (!handlers) return;
    // Snapshot so handlers may (un)subscribe while the event is being dispatched.
    for (const handler of [...handlers]) {
      this.#invoke(type, handler as Handler<Events[K]>, payload);
    }
  }

  /** The most recent payload emitted for `type`, if any. */
  latest<K extends keyof Events>(type: K): Events[K] | undefined {
    return this.#latest.get(type) as Events[K] | undefined;
  }

  listenerCount(type: keyof Events): number {
    return this.#handlers.get(type)?.size ?? 0;
  }

  /** Remove every subscription and forget all remembered payloads. */
  clear(): void {
    this.#handlers.clear();
    this.#latest.clear();
  }

  #invoke<K extends keyof Events>(type: K, handler: Handler<Events[K]>, payload: Events[K]): void {
    try {
      handler(payload);
    } catch (error) {
      this.#onError(error, type);
    }
  }
}
