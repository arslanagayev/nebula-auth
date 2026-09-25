import type { AppBus, AuthView } from '../core/appEvents';
import { DEMO_ACCOUNT, type AuthService } from '../lib/authService';
import { initCardFeedback } from './cardFeedback';
import { initDemoAutofill } from './demoAutofill';
import { NEVER, requireElement, type MediaPreference } from './dom';
import type { FlipController } from './flip';
import { initCapsLockHints, initPasswordToggles, type FormController } from './form';
import { createRegisterFlow } from './registerFlow';
import { createSignInFlow } from './signInFlow';
import type { Toaster } from './toast';

export interface AuthUIOptions {
  readonly card: HTMLElement;
  readonly faces: Readonly<Record<AuthView, HTMLElement>>;
  readonly bus: AppBus;
  readonly auth: AuthService;
  readonly toaster: Toaster;
  readonly flip: FlipController;
  readonly reducedMotion: MediaPreference;
  readonly coarsePointer?: MediaPreference;
  readonly signal: AbortSignal;
  /** Delay between characters when the demo credentials are typed in. */
  readonly typingDelayMs?: number;
}

export interface AuthUI {
  readonly signIn: FormController;
  readonly register: FormController;
}

/**
 * Composes the card: both form flows, card feedback, the flip links, the demo autofill and
 * the auxiliary buttons. Each piece lives in its own module; this function only wires them.
 */
export function initAuthUI({
  card,
  faces,
  bus,
  auth,
  toaster,
  flip,
  reducedMotion,
  coarsePointer = NEVER,
  signal,
  typingDelayMs = 28,
}: AuthUIOptions): AuthUI {
  initPasswordToggles(card, signal);
  initCapsLockHints(card, signal);
  initCardFeedback({ card, bus, reducedMotion, signal });

  // While a request is in flight the card must not flip: the result (success panel, focus,
  // burst) belongs to the face that sent it.
  const flipLinks = [...card.querySelectorAll<HTMLButtonElement>('[data-flip]')];
  const pendingViews = new Set<AuthView>();
  const onPendingChange = (form: FormController): void => {
    if (form.pending) pendingViews.add(form.view);
    else pendingViews.delete(form.view);
    for (const link of flipLinks) {
      link.setAttribute('aria-disabled', String(pendingViews.size > 0));
    }
  };

  const signIn = createSignInFlow({
    face: faces['sign-in'],
    bus,
    auth,
    toaster,
    onPendingChange,
    signal,
  });
  const register = createRegisterFlow({
    face: faces.register,
    bus,
    auth,
    toaster,
    flip,
    signIn,
    onPendingChange,
    signal,
  });

  const demo = initDemoAutofill({
    button: requireElement(faces['sign-in'], '[data-fill-demo]', HTMLButtonElement),
    form: signIn,
    submit: requireElement(faces['sign-in'], '[data-submit]', HTMLButtonElement),
    typingDelayMs,
    reducedMotion,
    coarsePointer,
    signal,
  });

  for (const link of flipLinks) {
    link.addEventListener(
      'click',
      () => {
        const target = link.dataset.flip;
        if (pendingViews.size > 0 || (target !== 'sign-in' && target !== 'register')) return;
        demo.cancel();
        void flip.flipTo(target);
      },
      { signal },
    );
  }

  requireElement(faces['sign-in'], '[data-forgot]', HTMLButtonElement).addEventListener(
    'click',
    () => {
      toaster.show(
        `Password reset is not part of this demo. Try ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}.`,
      );
    },
    { signal },
  );

  for (const button of card.querySelectorAll<HTMLButtonElement>('[data-provider]')) {
    button.addEventListener(
      'click',
      () => {
        const provider = button.dataset.provider ?? 'Social';
        toaster.show(`${provider} sign-in is simulated here. No data leaves your browser.`);
      },
      { signal },
    );
  }

  return { signIn, register };
}
