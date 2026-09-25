import type { AppBus, AuthView } from '../core/appEvents';

export interface MotionPreference {
  readonly matches: boolean;
}

export interface FlipOptions {
  /** The layout box that holds both faces (`[data-card]`). */
  readonly card: HTMLElement;
  readonly faces: Readonly<Record<AuthView, HTMLElement>>;
  readonly bus: AppBus;
  readonly reducedMotion: MotionPreference;
  readonly duration?: number;
}

export interface FlipController {
  readonly view: AuthView;
  /**
   * Turns the card to `view`. Resolves once the new face is settled and focused.
   * Requests made while a flip is running are ignored.
   */
  flipTo(view: AuthView, options?: { readonly focus?: HTMLElement | null }): Promise<void>;
}

export const FLIP_DURATION_MS = 900;
const FOCUS_AT = 0.55;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const FIRST_FIELD = 'input:not([type="hidden"]):not([disabled])';

/**
 * Flips between the sign-in and create-account faces.
 *
 * - The hidden face is `inert`, so it is unreachable by keyboard and screen readers.
 * - The layout height animates between the two faces' natural heights (FLIP-style: measure,
 *   pin the old height, then transition to the new one).
 * - Focus moves into the new face half-way through, as soon as it becomes visible.
 * - With reduced motion the swap is instant.
 */
export function initFlip({
  card,
  faces,
  bus,
  reducedMotion,
  duration = FLIP_DURATION_MS,
}: FlipOptions): FlipController {
  let view: AuthView = card.dataset.view === 'register' ? 'register' : 'sign-in';
  let flipping = false;

  card.style.setProperty('--flip-duration', `${duration}ms`);
  for (const [name, face] of Object.entries(faces) as [AuthView, HTMLElement][]) {
    const hidden = name !== view;
    face.toggleAttribute('inert', hidden);
    if (hidden) face.dataset.settled = 'hidden';
    else delete face.dataset.settled;
  }

  return {
    get view() {
      return view;
    },

    async flipTo(next, { focus } = {}) {
      if (next === view || flipping) return;
      flipping = true;

      const from = faces[view];
      const to = faces[next];
      const instant = reducedMotion.matches;
      const startHeight = card.offsetHeight;

      from.toggleAttribute('inert', true);
      to.toggleAttribute('inert', false);
      from.dataset.settled = 'hidden';
      delete to.dataset.settled;
      const endHeight = card.offsetHeight;

      card.dataset.view = next;
      view = next;
      bus.emit('view:flip', { view: next });

      if (!instant && startHeight !== endHeight) {
        card.style.height = `${startHeight}px`;
        // Force a style flush so the browser sees the start height before the change.
        card.getBoundingClientRect();
        card.style.height = `${endHeight}px`;
      }

      // The incoming face turns visible at the half-way point (see card.css); focusing it
      // any earlier would fail because hidden elements cannot take focus.
      if (!instant) await wait(duration * FOCUS_AT);
      const target = focus ?? to.querySelector<HTMLElement>(FIRST_FIELD);
      target?.focus({ preventScroll: true });

      if (!instant) await wait(duration * (1 - FOCUS_AT));
      card.style.removeProperty('height');
      flipping = false;
    },
  };
}
