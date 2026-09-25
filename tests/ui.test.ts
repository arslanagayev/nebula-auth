// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppBus } from '../src/core/appEvents';
import { bindDocumentState } from '../src/ui/documentState';
import { FLIP_DURATION_MS, initFlip } from '../src/ui/flip';
import { observeCardLayout } from '../src/ui/layout';
import { initTilt } from '../src/ui/tilt';
import { createToaster, MAX_VISIBLE_TOASTS, readingTime } from '../src/ui/toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('toaster', () => {
  function setup() {
    const region = document.createElement('section');
    const announcer = document.createElement('div');
    document.body.append(region, announcer);
    return { region, announcer, toaster: createToaster(region, announcer) };
  }

  it('renders a toast with an accessible close button', () => {
    const { region, toaster } = setup();
    toaster.show('Saved', { tone: 'success' });

    const toast = region.querySelector<HTMLElement>('.toast');
    expect(toast?.dataset.tone).toBe('success');
    expect(toast?.querySelector('.toast__message')?.textContent).toBe('Saved');
    expect(toast?.querySelector('.toast__close')?.getAttribute('aria-label')).toBe(
      'Dismiss notification',
    );
  });

  it('announces only the message, not the close button', () => {
    const { announcer, toaster } = setup();
    toaster.show('Account created');
    expect(announcer.textContent).toBe('Account created');
  });

  it('gives long messages more time and keeps errors until they are closed', async () => {
    const { region, toaster } = setup();
    const long = 'x'.repeat(100);
    expect(readingTime('Short')).toBe(5000);
    expect(readingTime(long)).toBeGreaterThan(5000);

    toaster.show(long);
    toaster.show('Broken', { tone: 'error' });
    await vi.advanceTimersByTimeAsync(readingTime(long) + 400);

    const messages = [...region.querySelectorAll('.toast__message')].map((m) => m.textContent);
    expect(messages).toEqual(['Broken']);
  });

  it('dismisses automatically after its duration', async () => {
    const { region, toaster } = setup();
    toaster.show('Hello', { duration: 1000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(region.querySelector('[data-leaving]')).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(region.querySelector('[data-leaving]')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(400);
    expect(region.children).toHaveLength(0);
  });

  it('pauses the timer while hovered', async () => {
    const { region, toaster } = setup();
    toaster.show('Hover me', { duration: 1000 });
    const toast = region.querySelector<HTMLElement>('.toast');

    toast?.dispatchEvent(new Event('pointerenter'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(toast?.hasAttribute('data-leaving')).toBe(false);

    toast?.dispatchEvent(new Event('pointerleave'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(toast?.hasAttribute('data-leaving')).toBe(true);
  });

  it('keeps a toast while focus is inside, even after the pointer leaves', async () => {
    const { region, toaster } = setup();
    toaster.show('Focus me', { duration: 1000 });
    const toast = region.querySelector<HTMLElement>('.toast');

    toast?.dispatchEvent(new Event('pointerenter'));
    toast?.dispatchEvent(new FocusEvent('focusin'));
    toast?.dispatchEvent(new Event('pointerleave'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast?.hasAttribute('data-leaving')).toBe(false);

    toast?.dispatchEvent(new FocusEvent('focusout'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(toast?.hasAttribute('data-leaving')).toBe(true);
  });

  it('closes on click and when dismissed programmatically', async () => {
    const { region, toaster } = setup();
    toaster.show('First');
    const dismiss = toaster.show('Second');

    region.querySelector<HTMLButtonElement>('.toast__close')?.click();
    dismiss();
    dismiss();
    region.querySelector('.toast')?.dispatchEvent(new Event('animationend'));

    await vi.advanceTimersByTimeAsync(400);
    expect(region.children).toHaveLength(0);
  });

  it(`keeps at most ${MAX_VISIBLE_TOASTS} toasts on screen`, () => {
    const { region, toaster } = setup();
    for (let i = 1; i <= 5; i += 1) toaster.show(`Toast ${i}`);

    const messages = [...region.querySelectorAll('.toast__message')].map(
      (node) => node.textContent,
    );
    expect(messages).toEqual(['Toast 3', 'Toast 4', 'Toast 5']);
  });

  it('clears everything at once', async () => {
    const { region, toaster } = setup();
    toaster.show('One');
    toaster.show('Two');
    toaster.clear();
    await vi.advanceTimersByTimeAsync(400);
    expect(region.children).toHaveLength(0);
  });
});

describe('initFlip', () => {
  function setup(reduced: boolean, coarse = false) {
    document.body.innerHTML = `
      <div data-card data-view="sign-in">
        <section data-face="sign-in"><input name="a" /></section>
        <section data-face="register">
          <h1 tabindex="-1" data-face-title>Register</h1><button>skip</button><input name="b" />
        </section>
      </div>`;
    const card = document.querySelector<HTMLElement>('[data-card]');
    const signIn = document.querySelector<HTMLElement>('[data-face="sign-in"]');
    const register = document.querySelector<HTMLElement>('[data-face="register"]');
    if (!card || !signIn || !register) throw new Error('fixture');
    const bus = createAppBus();
    const flip = initFlip({
      card,
      faces: { 'sign-in': signIn, register },
      bus,
      reducedMotion: { matches: reduced },
      coarsePointer: { matches: coarse },
    });
    return { card, signIn, register, bus, flip };
  }

  it('marks the initially hidden face inert and settled', () => {
    const { card, register, signIn, flip } = setup(true);
    expect(flip.view).toBe('sign-in');
    expect(register.hasAttribute('inert')).toBe(true);
    expect(register.dataset.settled).toBe('hidden');
    expect(signIn.hasAttribute('inert')).toBe(false);
    expect(card.style.getPropertyValue('--flip-duration')).toBe(`${FLIP_DURATION_MS}ms`);
  });

  it('focuses the first field of the new face half-way through the animation', async () => {
    const { card, register, signIn, flip } = setup(false);
    signIn.querySelector('input')?.focus();
    const done = flip.flipTo('register');

    expect(card.dataset.view).toBe('register');
    expect(flip.flipping).toBe(true);
    expect(signIn.dataset.settled).toBe('leaving');
    expect(register.dataset.settled).toBeUndefined();
    // The old face stays usable until the new one is visible, so focus never drops to <body>.
    expect(signIn.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(signIn.querySelector('input'));

    await vi.advanceTimersByTimeAsync(FLIP_DURATION_MS * 0.55);
    expect(signIn.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(register.querySelector('input'));

    await vi.advanceTimersByTimeAsync(FLIP_DURATION_MS * 0.45);
    await done;
    expect(signIn.dataset.settled).toBe('hidden');
    expect(flip.flipping).toBe(false);
    expect(card.style.height).toBe('');
  });

  it('focuses the heading instead of a field on touch screens', async () => {
    const { register, flip } = setup(true, true);
    await flip.flipTo('register');
    expect(document.activeElement).toBe(register.querySelector('h1'));
  });

  it('ignores requests while flipping and flips back afterwards', async () => {
    const { card, flip } = setup(false);
    const first = flip.flipTo('register');
    void flip.flipTo('sign-in');
    expect(card.dataset.view).toBe('register');

    await vi.advanceTimersByTimeAsync(FLIP_DURATION_MS);
    await first;

    const second = flip.flipTo('sign-in');
    await vi.advanceTimersByTimeAsync(FLIP_DURATION_MS);
    await second;
    expect(flip.view).toBe('sign-in');
  });

  it('does nothing when asked for the current view', async () => {
    const { bus, flip } = setup(true);
    const handler = vi.fn();
    bus.on('view:flip', handler);
    await flip.flipTo('sign-in');
    expect(handler).not.toHaveBeenCalled();
  });

  it('respects an explicit focus target', async () => {
    const { register, flip } = setup(true);
    const button = register.querySelector('button');
    await flip.flipTo('register', { focus: button });
    expect(document.activeElement).toBe(button);
  });
});

describe('observeCardLayout', () => {
  it('publishes the card rectangle immediately and on resize, once per frame', async () => {
    const card = document.createElement('div');
    document.body.append(card);
    const bus = createAppBus();
    const handler = vi.fn();
    bus.on('layout:card', handler);
    const controller = new AbortController();

    observeCardLayout(card, bus, controller.signal);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual({ left: 0, top: 0, width: 0, height: 0 });

    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(20);
    expect(handler).toHaveBeenCalledTimes(2);

    controller.abort();
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(20);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('initTilt', () => {
  /** A controllable stand-in for a `MediaQueryList`. */
  function preference(matches: boolean) {
    const listeners = new Set<() => void>();
    return {
      matches,
      addEventListener: (_type: 'change', listener: () => void) => {
        listeners.add(listener);
      },
      change(next: boolean) {
        this.matches = next;
        for (const listener of listeners) listener();
      },
    };
  }

  function setup({ fine = true, reduced = false } = {}) {
    const reducedMotion = preference(reduced);
    const finePointer = preference(fine);
    document.body.innerHTML =
      '<main><div data-tilt><div data-glare></div><div data-glare></div></div></main>';
    const element = document.querySelector<HTMLElement>('[data-tilt]');
    if (!element?.parentElement) throw new Error('fixture');
    vi.spyOn(element.parentElement, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 100, width: 400, height: 600 }),
    );
    const controller = new AbortController();
    initTilt(element, { maxAngle: 8, reducedMotion, finePointer, signal: controller.signal });
    const glares = [...element.querySelectorAll<HTMLElement>('[data-glare]')];
    return { element, glares, controller, reducedMotion };
  }

  const move = (element: HTMLElement, x: number, y: number, pointerType = 'mouse') => {
    element.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType }));
  };

  /** Reads `rotateX(…)` / `rotateY(…)` back from the inline transform. */
  const angle = (element: HTMLElement, axis: 'X' | 'Y') => {
    const match = new RegExp(`rotate${axis}\\((-?[\\d.]+)deg\\)`, 'u').exec(
      element.style.transform,
    );
    return match?.[1] === undefined ? 0 : Number.parseFloat(match[1]);
  };

  it('eases towards the pointer and moves the glare with it', async () => {
    const { element, glares, controller } = setup();
    // Top-right corner of the card.
    move(element, 500, 100);
    await vi.advanceTimersByTimeAsync(2000);

    expect(angle(element, 'Y')).toBeCloseTo(8, 1);
    expect(angle(element, 'X')).toBeCloseTo(8, 1);
    for (const glare of glares) {
      expect(glare.style.getPropertyValue('--glare-x')).toBe('100.00%');
      expect(Number(glare.style.opacity)).toBeCloseTo(1, 2);
    }

    element.dispatchEvent(new Event('pointerleave'));
    await vi.advanceTimersByTimeAsync(2000);
    // At rest the inline transform is removed and the stylesheet's resting value applies.
    expect(element.style.transform).toBe('');
    controller.abort();
  });

  it('ignores touch input', async () => {
    const { element, controller } = setup();
    move(element, 500, 100, 'touch');
    await vi.advanceTimersByTimeAsync(500);
    expect(element.style.transform).toBe('');
    controller.abort();
  });

  it('stays flat for users who prefer reduced motion', async () => {
    const { element, controller } = setup({ reduced: true });
    move(element, 500, 100);
    await vi.advanceTimersByTimeAsync(500);
    expect(element.style.transform).toBe('');
    controller.abort();
  });

  it('stays flat without a fine pointer', async () => {
    const { element, controller } = setup({ fine: false });
    move(element, 500, 100);
    await vi.advanceTimersByTimeAsync(500);
    expect(element.style.transform).toBe('');
    controller.abort();
  });

  it('resets immediately when the preference changes mid-tilt', async () => {
    const { element, glares, controller, reducedMotion } = setup();
    move(element, 500, 100);
    await vi.advanceTimersByTimeAsync(2000);
    expect(angle(element, 'Y')).toBeGreaterThan(7);

    reducedMotion.change(true);
    expect(element.style.transform).toBe('');
    expect(glares[0]?.style.opacity).toBe('0.000');
    controller.abort();
  });
});

describe('bindDocumentState', () => {
  it('names the current step in the document title', () => {
    const bus = createAppBus();
    const controller = new AbortController();
    bindDocumentState({ root: document.documentElement, bus, signal: controller.signal });

    bus.emit('view:flip', { view: 'register' });
    expect(document.title).toBe('Create account — Nebula');
    bus.emit('auth:success', { view: 'register', name: 'Ada' });
    expect(document.title).toBe('Account created — Nebula');
    bus.emit('auth:reset', { view: 'register' });
    expect(document.title).toBe('Create account — Nebula');
    bus.emit('view:flip', { view: 'sign-in' });
    bus.emit('auth:success', { view: 'sign-in', name: 'Demo' });
    expect(document.title).toBe('Signed in — Nebula');
    controller.abort();
  });

  it('fades the canvas in only while the scene is ready, including late subscribers', () => {
    const bus = createAppBus();
    const root = document.createElement('div');
    const controller = new AbortController();
    bus.emit('scene:status', { status: 'ready' });

    bindDocumentState({ root, bus, signal: controller.signal });
    expect(root.classList.contains('scene-ready')).toBe(true);

    bus.emit('scene:status', { status: 'lost' });
    expect(root.classList.contains('scene-ready')).toBe(false);
    bus.emit('scene:status', { status: 'ready' });
    controller.abort();
    expect(root.classList.contains('scene-ready')).toBe(false);
  });
});
