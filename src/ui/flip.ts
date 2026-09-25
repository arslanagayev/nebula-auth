import type { AppBus, AuthView } from '../core/appEvents';
import { NEVER, wait, type MediaPreference } from './dom';

export interface FlipOptions {
  /** The layout box that holds both faces (`[data-card]`). */
  readonly card: HTMLElement;
  readonly faces: Readonly<Record<AuthView, HTMLElement>>;
  readonly bus: AppBus;
  readonly reducedMotion: MediaPreference;
  /**
   * `(pointer: coarse)`. On touch screens focus lands on the new face's heading instead of
   * its first field, so the on-screen keyboard does not pop up in the middle of the flip.
   */
  readonly coarsePointer?: MediaPreference;
  readonly duration?: number;
}

export interface FlipController {
  readonly view: AuthView;
  /** True while the card is turning. */
  readonly flipping: boolean;
  /**
   * Turns the card to `view`. Resolves once the new face is settled and focused.
   * Requests made while a flip is running are ignored.
   */
  flipTo(view: AuthView, options?: { readonly focus?: HTMLElement | null }): Promise<void>;
}

export const FLIP_DURATION_MS = 900;
const FOCUS_AT = 0.55;

const FIRST_FIELD = 'input:not([type="hidden"]):not([disabled])';
const HEADING = '[data-face-title]';

/**
 * Flips between the sign-in and create-account faces.
 *
 * - The hidden face is `inert`, so it is unreachable by keyboard and screen readers.
 * - The layout height animates between the two faces' natural heights (FLIP-style: measure,
 *   pin the old height, then transition to the new one).
 * - Focus stays on the old face until the half-way point, then moves straight into the new
 *   one as it becomes visible, so it never falls back to `<body>`.
 * - With reduced motion the swap is instant.
 *
 * `data-settled` drives the layout (see card.css): `leaving` takes the outgoing face out of
 * the flow while it turns away, `hidden` also clips it once it is settled out of view, so it
 * cannot stretch the page's scrollable area.
 */
export function initFlip({
  card,
  faces,
  bus,
  reducedMotion,
  coarsePointer = NEVER,
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

    get flipping() {
      return flipping;
    },

    async flipTo(next, { focus } = {}) {
      if (next === view || flipping) return;
      flipping = true;

      const from = faces[view];
      const to = faces[next];
      const instant = reducedMotion.matches;
      const startHeight = card.offsetHeight;

      to.toggleAttribute('inert', false);
      from.dataset.settled = instant ? 'hidden' : 'leaving';
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
      from.toggleAttribute('inert', true);
      const target =
        focus ??
        (coarsePointer.matches
          ? to.querySelector<HTMLElement>(HEADING)
          : to.querySelector<HTMLElement>(FIRST_FIELD));
      target?.focus({ preventScroll: true });

      if (!instant) await wait(duration * (1 - FOCUS_AT));
      from.dataset.settled = 'hidden';
      card.style.removeProperty('height');
      // Someone who scrolled down to reach the switch link should see where focus went.
      target?.scrollIntoView({ block: 'nearest' });
      flipping = false;
    },
  };
}
