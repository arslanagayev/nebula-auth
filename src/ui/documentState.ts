import type { AppBus, AuthView } from '../core/appEvents';

const TITLES: Readonly<Record<AuthView, string>> = {
  'sign-in': 'Sign in — Nebula',
  register: 'Create account — Nebula',
};

const SUCCESS_TITLES: Readonly<Record<AuthView, string>> = {
  'sign-in': 'Signed in — Nebula',
  register: 'Account created — Nebula',
};

export interface DocumentStateOptions {
  readonly root: HTMLElement;
  readonly bus: AppBus;
  readonly signal: AbortSignal;
}

/**
 * Reflects app state on the document itself:
 * - `document.title` follows the visible face and the success screens, so the tab and
 *   assistive technology always name the current step;
 * - `.scene-ready` on `<html>` fades the WebGL canvas in over the CSS nebula, and removes it
 *   again whenever the scene becomes unavailable or loses its context.
 */
export function bindDocumentState({ root, bus, signal }: DocumentStateOptions): void {
  bus.on(
    'view:flip',
    ({ view }) => {
      document.title = TITLES[view];
    },
    { signal },
  );
  bus.on(
    'auth:success',
    ({ view }) => {
      document.title = SUCCESS_TITLES[view];
    },
    { signal },
  );
  bus.on(
    'auth:reset',
    ({ view }) => {
      document.title = TITLES[view];
    },
    { signal },
  );

  bus.on(
    'scene:status',
    ({ status }) => {
      root.classList.toggle('scene-ready', status === 'ready');
    },
    { signal, replay: true },
  );
  signal.addEventListener('abort', () => {
    root.classList.remove('scene-ready');
  });
}
