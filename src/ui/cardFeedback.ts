import type { AppBus } from '../core/appEvents';
import type { MediaPreference } from './dom';

export interface CardFeedbackOptions {
  readonly card: HTMLElement;
  readonly bus: AppBus;
  readonly reducedMotion: MediaPreference;
  readonly signal: AbortSignal;
}

type Feedback = 'success' | 'error';

export const FEEDBACK_MS: Readonly<Record<Feedback, number>> = { success: 2400, error: 1200 };

/**
 * Card-level feedback: a coloured rim for success and errors, plus a shake on errors.
 *
 * It listens to the same bus events as the 3D scene, so every failure (a rejected password,
 * a lockout, or a submit with invalid fields) gets the same reaction on the card and in the
 * galaxy, and the card still reacts when WebGL is unavailable.
 */
export function initCardFeedback({ card, bus, reducedMotion, signal }: CardFeedbackOptions): void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = (kind: Feedback): void => {
    clearTimeout(timer);
    card.dataset.feedback = kind;
    timer = setTimeout(() => {
      delete card.dataset.feedback;
    }, FEEDBACK_MS[kind]);

    if (kind === 'error' && !reducedMotion.matches) {
      card.classList.remove('is-shaking');
      // Restart the animation even if the previous shake has not finished yet.
      card.getBoundingClientRect();
      card.classList.add('is-shaking');
    }
  };

  bus.on(
    'auth:error',
    () => {
      show('error');
    },
    { signal },
  );
  bus.on(
    'auth:success',
    () => {
      show('success');
    },
    { signal },
  );

  card.addEventListener(
    'animationend',
    (event) => {
      if (event.target === card) card.classList.remove('is-shaking');
    },
    { signal },
  );
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
  });
}
