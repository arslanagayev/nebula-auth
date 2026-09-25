/**
 * A tiny, strongly typed publish/subscribe bus.
 *
 * The UI and the WebGL scene never import each other: the UI publishes intent
 * ("a field got focus", "sign-in is pending") and the scene decides how to react.
 * That keeps the scene lazy-loadable and every UI module testable without a GPU.
 *
 * Events come in two kinds:
 * - **transient** events describe something that happened (`auth:error`, `view:flip`). They
 *   are delivered to current subscribers and then forgotten.
 * - **state** events describe the current value of something (`layout:card`). The bus
 *   remembers their latest payload, so a late subscriber (the lazily loaded scene) can
 *   `replay` it. Only state events accept `replay` and `latest()`, enforced at compile time.
 */

export type Handler<Payload> = (payload: Payload) => void;

export interface SubscribeOptions {
  /** Unsubscribe automatically when this signal aborts. */
  readonly signal?: AbortSignal;
}

export interface ReplayOptions extends SubscribeOptions {
  /** Immediately invoke the handler with the most recent payload of this type, if any. */
  readonly replay?: boolean;
}

export interface EventBusOptions<State> {
  /** Event types whose latest payload is remembered and can be replayed. */
  readonly state?: readonly State[];
  /**
   * Called when a handler throws. The default re-throws asynchronously so the error
   * still reaches the console / error tracking without breaking other subscribers,
   * mirroring how the DOM reports exceptions thrown by event listeners.
   */
  readonly onError?: (error: unknown, type: PropertyKey) => void;
}

type AnyHandler = (payload: never) => void;

/** One call to `on()`. Subscribing the same function twice creates two subscriptions. */
interface Subscription {
  readonly handler: AnyHandler;
}

const rethrowAsync = (error: unknown): void => {
  queueMicrotask(() => {
    throw error;
  });
};

export class EventBus<Events extends object, State extends keyof Events = never> {
  readonly #subscriptions = new Map<keyof Events, Set<Subscription>>();
  readonly #latest = new Map<keyof Events, unknown>();
  readonly #state: ReadonlySet<keyof Events>;
  readonly #onError: (error: unknown, type: PropertyKey) => void;

  constructor(options: EventBusOptions<State> = {}) {
    this.#state = new Set<keyof Events>(options.state ?? []);
    this.#onError = options.onError ?? rethrowAsync;
  }

  /** Subscribe to an event. Returns a function that removes the subscription. */
  on<K extends keyof Events>(
    type: K,
    handler: Handler<Events[K]>,
    options: K extends State ? ReplayOptions : SubscribeOptions = {},
  ): () => void {
    // Widening is safe: `replay` can only be present for state events (see the signature).
    const { signal, replay = false }: ReplayOptions = options;
    const subscription: Subscription = { handler };

    const onAbort = (): void => {
      this.#remove(type, subscription);
    };
    const unsubscribe = (): void => {
      signal?.removeEventListener('abort', onAbort);
      this.#remove(type, subscription);
    };

    if (signal?.aborted) return unsubscribe;

    let subscriptions = this.#subscriptions.get(type);
    if (!subscriptions) {
      subscriptions = new Set();
      this.#subscriptions.set(type, subscriptions);
    }
    subscriptions.add(subscription);
    signal?.addEventListener('abort', onAbort, { once: true });

    if (replay && this.#latest.has(type)) {
      this.#invoke(type, handler, this.#latest.get(type) as Events[K]);
    }
    return unsubscribe;
  }

  /** Subscribe to the next occurrence of an event only. */
  once<K extends keyof Events>(
    type: K,
    handler: Handler<Events[K]>,
    options: SubscribeOptions = {},
  ): () => void {
    const unsubscribe = this.on<K>(
      type,
      (payload) => {
        unsubscribe();
        handler(payload);
      },
      options,
    );
    return unsubscribe;
  }

  /** Removes every subscription of `handler` to `type`. */
  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    for (const subscription of this.#subscriptions.get(type) ?? []) {
      if (subscription.handler === handler) this.#remove(type, subscription);
    }
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    if (this.#state.has(type)) this.#latest.set(type, payload);
    const subscriptions = this.#subscriptions.get(type);
    if (!subscriptions) return;
    // Snapshot so handlers may (un)subscribe while the event is being dispatched.
    for (const { handler } of [...subscriptions]) {
      this.#invoke(type, handler as Handler<Events[K]>, payload);
    }
  }

  /** The most recent payload emitted for the state event `type`, if any. */
  latest<K extends State>(type: K): Events[K] | undefined {
    return this.#latest.get(type) as Events[K] | undefined;
  }

  listenerCount(type: keyof Events): number {
    return this.#subscriptions.get(type)?.size ?? 0;
  }

  /** Remove every subscription and forget all remembered payloads. */
  clear(): void {
    this.#subscriptions.clear();
    this.#latest.clear();
  }

  #remove(type: keyof Events, subscription: Subscription): void {
    const subscriptions = this.#subscriptions.get(type);
    if (!subscriptions) return;
    subscriptions.delete(subscription);
    if (subscriptions.size === 0) this.#subscriptions.delete(type);
  }

  #invoke<K extends keyof Events>(type: K, handler: Handler<Events[K]>, payload: Events[K]): void {
    try {
      handler(payload);
    } catch (error) {
      this.#onError(error, type);
    }
  }
}
