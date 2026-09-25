import { vi } from 'vitest';
import html from '../../index.html?raw';
import { createAppBus, type AppBus, type AppEvents } from '../../src/core/appEvents';
import { createAuthService, type AuthServiceOptions } from '../../src/lib/authService';
import { initAuthUI, type AuthUI } from '../../src/ui/authForms';
import { initFlip, type FlipController } from '../../src/ui/flip';
import { createToaster } from '../../src/ui/toast';

export const LATENCY = 500;

export interface Page {
  readonly bus: AppBus;
  readonly ui: AuthUI;
  readonly flip: FlipController;
  readonly card: HTMLElement;
  readonly signInFace: HTMLElement;
  readonly registerFace: HTMLElement;
  readonly toasts: HTMLElement;
  readonly events: { type: keyof AppEvents; payload: unknown }[];
  readonly controller: AbortController;
}

export interface PageOptions {
  readonly auth?: AuthServiceOptions;
  /** Reduced motion for the flip (instant by default so tests stay synchronous). */
  readonly instantFlip?: boolean;
  /** Reduced motion for card feedback (shake). */
  readonly reducedMotion?: boolean;
}

const RECORDED: (keyof AppEvents)[] = [
  'field:focus',
  'field:blur',
  'password:strength',
  'auth:pending',
  'auth:success',
  'auth:error',
  'auth:reset',
  'view:flip',
];

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document) {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Test fixture is missing ${selector}`);
  return element;
}

/** Renders the real index.html body and initialises the UI exactly like main.ts does. */
export function mountPage({
  auth = {},
  instantFlip = true,
  reducedMotion = false,
}: PageOptions = {}): Page {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  // The module script would try to boot the real app (and three.js) inside the test DOM.
  for (const script of parsed.querySelectorAll('script')) script.remove();
  document.body.innerHTML = parsed.body.innerHTML;

  const bus = createAppBus();
  const events: Page['events'] = [];
  for (const type of RECORDED) {
    bus.on(type, (payload) => events.push({ type, payload }));
  }

  const card = $('[data-card]');
  const signInFace = $('[data-face="sign-in"]');
  const registerFace = $('[data-face="register"]');
  const toasts = $('[data-toasts]');
  const controller = new AbortController();
  const faces = { 'sign-in': signInFace, register: registerFace };

  const flip = initFlip({ card, faces, bus, reducedMotion: { matches: instantFlip } });
  const ui = initAuthUI({
    card,
    faces,
    bus,
    auth: createAuthService({ latencyMs: [LATENCY, LATENCY], ...auth }),
    toaster: createToaster(toasts),
    flip,
    reducedMotion: { matches: reducedMotion },
    signal: controller.signal,
    typingDelayMs: 0,
  });

  return { bus, ui, flip, card, signInFace, registerFace, toasts, events, controller };
}

/** Sets a value the way typing does: the value changes, then an `input` event bubbles. */
export function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function blur(input: HTMLInputElement): void {
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

export function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

export function field(root: ParentNode, name: string): HTMLInputElement {
  return $<HTMLInputElement>(`input[name="${name}"]`, root);
}

export function errorOf(input: HTMLInputElement): string {
  const id = input.getAttribute('aria-describedby')?.split(' ')[0] ?? '';
  return document.getElementById(id)?.textContent ?? '';
}

export async function settle(ms = LATENCY): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

export function eventsOf<K extends keyof AppEvents>(page: Page, type: K): AppEvents[K][] {
  return page.events
    .filter((event) => event.type === type)
    .map((event) => event.payload as AppEvents[K]);
}
