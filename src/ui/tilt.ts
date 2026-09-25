import { damp } from '../lib/math';

export interface TiltOptions {
  /** Maximum rotation in degrees at the card's edges. */
  readonly maxAngle?: number;
  readonly signal: AbortSignal;
}

interface TiltState {
  rotateX: number;
  rotateY: number;
  glareX: number;
  glareY: number;
  glare: number;
}

const RESPONSIVENESS = 9;
const SETTLE_EPSILON = 0.005;

/**
 * Pointer-driven 3D tilt with a moving glare highlight.
 *
 * Pointer events only record a target; a single rAF loop eases towards it and writes CSS
 * custom properties, so there is at most one style write per frame and the loop stops as
 * soon as the card is at rest. Disabled for touch input and reduced motion.
 */
export function initTilt(element: HTMLElement, { maxAngle = 8, signal }: TiltOptions): void {
  // Measure the untransformed parent: the tilted element's own bounding box changes as it
  // rotates, which would feed back into the angle and make it wobble.
  const frame = element.parentElement ?? element;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const current: TiltState = { rotateX: 0, rotateY: 0, glareX: 50, glareY: 0, glare: 0 };
  const target: TiltState = { ...current };
  let raf = 0;
  let lastTime = 0;

  const isEnabled = (): boolean => finePointer.matches && !reducedMotion.matches;

  const write = (state: TiltState): void => {
    const style = element.style;
    style.setProperty('--tilt-x', `${state.rotateX.toFixed(3)}deg`);
    style.setProperty('--tilt-y', `${state.rotateY.toFixed(3)}deg`);
    style.setProperty('--glare-x', `${state.glareX.toFixed(2)}%`);
    style.setProperty('--glare-y', `${state.glareY.toFixed(2)}%`);
    style.setProperty('--glare-opacity', state.glare.toFixed(3));
  };

  const step = (time: number): void => {
    const dt = lastTime === 0 ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    let moving = false;
    for (const key of Object.keys(current) as (keyof TiltState)[]) {
      current[key] = damp(current[key], target[key], RESPONSIVENESS, dt);
      if (Math.abs(current[key] - target[key]) > SETTLE_EPSILON) moving = true;
    }
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
