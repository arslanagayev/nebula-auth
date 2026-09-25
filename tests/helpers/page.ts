import { vi } from 'vitest';
import html from '../../index.html?raw';
import { createAppBus, type AppBus, type AppEvents } from '../../src/core/appEvents';
import {
  createAuthService,
  type AuthService,
  type AuthServiceOptions,
} from '../../src/lib/authService';
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
  readonly announcer: HTMLElement;
  readonly events: { type: keyof AppEvents; payload: unknown }[];
  readonly controller: AbortController;
}

export interface PageOptions {
  readonly auth?: AuthServiceOptions;
  /** Replaces the mock service entirely, e.g. with one that rejects. */
  readonly service?: AuthService;
  /** Reduced motion for the flip (instant by default so tests stay synchronous). */
  readonly instantFlip?: boolean;
  /** Reduced motion for card feedback (shake). */
  readonly reducedMotion?: boolean;
  /** Emulate a touch screen (`pointer: coarse`). */
  readonly coarsePointer?: boolean;
  /** Delay between demo characters; 0 fills fields at once. */
  readonly typingDelayMs?: number;
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
  service,
  instantFlip = true,
  reducedMotion = false,
  coarsePointer = false,
  typingDelayMs = 0,
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
  const announcer = $('[data-announcer]');
  const controller = new AbortController();
  const faces = { 'sign-in': signInFace, register: registerFace };

  const touch = { matches: coarsePointer };
  const flip = initFlip({
    card,
    faces,
    bus,
    reducedMotion: { matches: instantFlip },
    coarsePointer: touch,
  });
  const ui = initAuthUI({
    card,
    faces,
    bus,
    auth: service ?? createAuthService({ latencyMs: [LATENCY, LATENCY], ...auth }),
    toaster: createToaster(toasts, announcer),
    flip,
    reducedMotion: { matches: reducedMotion },
    coarsePointer: touch,
    signal: controller.signal,
    typingDelayMs,
  });

  return { bus, ui, flip, card, signInFace, registerFace, toasts, announcer, events, controller };
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

/** The text of the field's own error message (`[data-error]` in its `aria-describedby`). */
export function errorOf(input: HTMLInputElement): string {
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
  const error = ids
    .map((id) => document.getElementById(id))
    .find((element) => element?.hasAttribute('data-error'));
  return error?.textContent ?? '';
}

/** The accessible description: the text of every element in `aria-describedby`, in order. */
export function descriptionOf(input: HTMLInputElement): string {
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids
    .map((id) => visibleText(document.getElementById(id)))
    .filter((text) => text !== '')
    .join(' ');
}

/** Text content without `hidden` descendants, as assistive technology computes it. */
function visibleText(node: Node | null): string {
  if (node === null) return '';
  if (node instanceof HTMLElement && node.hidden) return '';
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/gu, ' ');
  return [...node.childNodes].map(visibleText).join('').replace(/\s+/gu, ' ').trim();
}

export async function settle(ms = LATENCY): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

export function eventsOf<K extends keyof AppEvents>(page: Page, type: K): AppEvents[K][] {
  return page.events
    .filter((event) => event.type === type)
    .map((event) => event.payload as AppEvents[K]);
}
