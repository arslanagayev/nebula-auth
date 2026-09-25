import { damp } from '../lib/math';
import type { LivePreference } from './dom';

export interface TiltOptions {
  /** Maximum rotation in degrees at the card's edges. */
  readonly maxAngle?: number;
  /** `(prefers-reduced-motion: reduce)`: no tilt at all while it matches. */
  readonly reducedMotion: LivePreference;
  /** `(hover: hover) and (pointer: fine)`: tilt only follows a real mouse or pen. */
  readonly finePointer: LivePreference;
  readonly signal: AbortSignal;
}

interface TiltState {
  rotateX: number;
  rotateY: number;
  glareX: number;
  glareY: number;
  glare: number;
}

const KEYS = ['rotateX', 'rotateY', 'glareX', 'glareY', 'glare'] as const;
const RESPONSIVENESS = 9;
const SETTLE_EPSILON = 0.005;
/** Must match the perspective of `.card-tilt` in card.css. */
const PERSPECTIVE = '1000px';

/**
 * Pointer-driven 3D tilt with a moving glare highlight.
 *
 * Pointer events only record a target; a single rAF loop eases towards it. Each frame writes
 * the transform on the tilt element and the glare position on the glare layers themselves,
 * rather than inherited custom properties on the card, so a frame never restyles the form
 * underneath. The loop stops as soon as the card is at rest. Disabled for touch input and
 * reduced motion.
 */
export function initTilt(
  element: HTMLElement,
  { maxAngle = 8, reducedMotion, finePointer, signal }: TiltOptions,
): void {
  // Measure the untransformed parent: the tilted element's own bounding box changes as it
  // rotates, which would feed back into the angle and make it wobble.
  const frame = element.parentElement ?? element;
  const glares = [...element.querySelectorAll<HTMLElement>('[data-glare]')];

  const current: TiltState = { rotateX: 0, rotateY: 0, glareX: 50, glareY: 0, glare: 0 };
  const target: TiltState = { ...current };
  let raf = 0;
  let lastTime = 0;

  const isEnabled = (): boolean => finePointer.matches && !reducedMotion.matches;

  const write = (state: TiltState): void => {
    element.style.transform =
      state.rotateX === 0 && state.rotateY === 0
        ? ''
        : `perspective(${PERSPECTIVE}) rotateX(${state.rotateX.toFixed(3)}deg) rotateY(${state.rotateY.toFixed(3)}deg)`;
    for (const glare of glares) {
      glare.style.setProperty('--glare-x', `${state.glareX.toFixed(2)}%`);
      glare.style.setProperty('--glare-y', `${state.glareY.toFixed(2)}%`);
      glare.style.opacity = state.glare.toFixed(3);
    }
  };

  const step = (time: number): void => {
    const dt = lastTime === 0 ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    let moving = false;
    for (const key of KEYS) {
      current[key] = damp(current[key], target[key], RESPONSIVENESS, dt);
      if (Math.abs(current[key] - target[key]) > SETTLE_EPSILON) moving = true;
    }
    if (!moving) Object.assign(current, target);
    write(current);

    if (moving) {
      raf = requestAnimationFrame(step);
    } else {
      raf = 0;
      lastTime = 0;
    }
  };

  const wake = (): void => {
    if (raf === 0) raf = requestAnimationFrame(step);
  };

  const reset = (): void => {
    Object.assign(target, { rotateX: 0, rotateY: 0, glare: 0 });
    wake();
  };

  element.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (!isEnabled()) return;
      const rect = frame.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      target.rotateY = (x - 0.5) * 2 * maxAngle;
      target.rotateX = -(y - 0.5) * 2 * maxAngle;
      target.glareX = x * 100;
      target.glareY = y * 100;
      target.glare = 1;
      wake();
    },
    { passive: true, signal },
  );

  element.addEventListener('pointerleave', reset, { signal });

  const onPreferenceChange = (): void => {
    if (isEnabled()) return;
    cancelAnimationFrame(raf);
    raf = 0;
    Object.assign(current, { rotateX: 0, rotateY: 0, glare: 0 });
    Object.assign(target, current);
    write(current);
  };
  finePointer.addEventListener('change', onPreferenceChange, { signal });
  reducedMotion.addEventListener('change', onPreferenceChange, { signal });

  signal.addEventListener('abort', () => {
    cancelAnimationFrame(raf);
  });
}
