import { describe, expect, it, vi } from 'vitest';
import { APP_STATE_EVENTS, createAppBus } from '../src/core/appEvents';
import { EventBus } from '../src/core/events';

interface TestEvents {
  ping: { count: number };
  name: string;
}

/** `name` is a state event (remembered, replayable); `ping` is transient. */
const createBus = () => new EventBus<TestEvents, 'name'>({ state: ['name'] });

describe('EventBus', () => {
  it('delivers typed payloads to every subscriber', () => {
    const bus = new EventBus<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();
    bus.on('ping', first);
    bus.on('ping', second);

    bus.emit('ping', { count: 1 });

    expect(first).toHaveBeenCalledWith({ count: 1 });
    expect(second).toHaveBeenCalledWith({ count: 1 });
  });

  it('does not call handlers of other event types', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('name', handler);

    bus.emit('ping', { count: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes through the returned function and through off()', () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = bus.on('ping', a);
    bus.on('ping', b);

    unsubscribeA();
    bus.off('ping', b);
    bus.emit('ping', { count: 2 });

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('ignores off() for unknown handlers', () => {
    const bus = new EventBus<TestEvents>();
    expect(() => {
      bus.off('name', vi.fn());
    }).not.toThrow();
  });

  it('unsubscribes when the provided AbortSignal aborts', () => {
    const bus = new EventBus<TestEvents>();
    const controller = new AbortController();
    const handler = vi.fn();
    bus.on('name', handler, { signal: controller.signal });

    controller.abort();
    bus.emit('name', 'nebula');

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not subscribe with an already aborted signal', () => {
    const bus = new EventBus<TestEvents>();
    bus.on('name', vi.fn(), { signal: AbortSignal.abort() });
    expect(bus.listenerCount('name')).toBe(0);
  });

  it('treats every on() call as its own subscription', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribeFirst = bus.on('ping', handler);
    bus.on('ping', handler);

    unsubscribeFirst();
    bus.emit('ping', { count: 1 });
    expect(handler).toHaveBeenCalledTimes(1);

    // off() removes every subscription of that handler.
    bus.off('ping', handler);
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('stops listening to the signal after a manual unsubscribe', () => {
    const bus = new EventBus<TestEvents>();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    const unsubscribe = bus.on('ping', vi.fn(), { signal: controller.signal });
    unsubscribe();

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('calls once() handlers a single time', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.once('ping', handler);

    bus.emit('ping', { count: 1 });
    bus.emit('ping', { count: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ count: 1 });
  });

  it('supports an AbortSignal for once() subscriptions', () => {
    const bus = new EventBus<TestEvents>();
    const controller = new AbortController();
    const handler = vi.fn();
    bus.once('ping', handler, { signal: controller.signal });

    controller.abort();
    bus.emit('ping', { count: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('remembers the latest payload of state events and replays it to late subscribers', () => {
    const bus = createBus();
    expect(bus.latest('name')).toBeUndefined();

    bus.emit('name', 'first');
    bus.emit('name', 'second');
    const replayed = vi.fn();
    const notReplayed = vi.fn();
    bus.on('name', replayed, { replay: true });
    bus.on('name', notReplayed);

    expect(bus.latest('name')).toBe('second');
    expect(replayed).toHaveBeenCalledExactlyOnceWith('second');
    expect(notReplayed).not.toHaveBeenCalled();
  });

  it('forgets transient events once they are delivered', () => {
    const bus = createBus();
    bus.emit('ping', { count: 1 });
    const handler = vi.fn();
    // @ts-expect-error `replay` is only available for state events.
    bus.on('ping', handler, { replay: true });
    // @ts-expect-error `latest()` is only available for state events.
    expect(bus.latest('ping')).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not replay when nothing has been emitted yet', () => {
    const bus = createBus();
    const handler = vi.fn();
    bus.on('name', handler, { replay: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets handlers unsubscribe during dispatch without skipping others', () => {
    const bus = new EventBus<TestEvents>();
    const calls: string[] = [];
    const unsubscribeFirst = bus.on('name', () => {
      calls.push('first');
      unsubscribeFirst();
    });
    bus.on('name', () => calls.push('second'));

    bus.emit('name', 'x');
    bus.emit('name', 'y');

    expect(calls).toEqual(['first', 'second', 'second']);
  });

  it('isolates throwing handlers and reports errors through onError', () => {
    const onError = vi.fn();
    const bus = new EventBus<TestEvents>({ onError });
    const failure = new Error('boom');
    const healthy = vi.fn();
    bus.on('ping', () => {
      throw failure;
    });
    bus.on('ping', healthy);

    bus.emit('ping', { count: 3 });

    expect(healthy).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure, 'ping');
  });

  it('re-throws handler errors asynchronously by default', () => {
    const scheduled: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
      scheduled.push(task);
    });
    const bus = new EventBus<TestEvents>();
    bus.on('name', () => {
      throw new Error('async boom');
    });

    expect(() => {
      bus.emit('name', 'x');
    }).not.toThrow();
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow('async boom');
  });

  it('clear() drops subscribers and remembered payloads', () => {
    const bus = createBus();
    const handler = vi.fn();
    bus.on('name', handler);
    bus.emit('name', 'before');

    bus.clear();
    bus.emit('ping', { count: 1 });

    expect(bus.listenerCount('name')).toBe(0);
    expect(bus.latest('name')).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('createAppBus', () => {
  it('creates an isolated bus for the application event map', () => {
    const first = createAppBus();
    const second = createAppBus();
    const handler = vi.fn();
    first.on('view:flip', handler);

    second.emit('view:flip', { view: 'register' });
    first.emit('view:flip', { view: 'sign-in' });

    expect(handler).toHaveBeenCalledExactlyOnceWith({ view: 'sign-in' });
  });

  it('remembers exactly the state events of the contract', () => {
    const bus = createAppBus();
    bus.emit('layout:card', { left: 1, top: 2, width: 3, height: 4 });
    bus.emit('password:strength', { score: 3 });
    bus.emit('scene:status', { status: 'ready' });
    for (const type of APP_STATE_EVENTS) expect(bus.latest(type)).toBeDefined();
  });
});
