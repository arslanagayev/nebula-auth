import type { AppBus } from '../core/appEvents';

/**
 * Publishes the card's viewport rectangle whenever it can change (resize, scroll, content
 * height), at most once per animation frame. The scene uses it to anchor the glass core.
 *
 * `anchor` must be an untransformed box around the card (`.auth`): the tilting card's own
 * bounding box changes with every degree of tilt, which would make the core wobble.
 */
export function observeCardLayout(anchor: HTMLElement, bus: AppBus, signal: AbortSignal): void {
  let frame = 0;

  const publish = (): void => {
    frame = 0;
    const { left, top, width, height } = anchor.getBoundingClientRect();
    bus.emit('layout:card', { left, top, width, height });
  };

  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(publish);
  };

  const observer = new ResizeObserver(schedule);
  observer.observe(anchor);
  window.addEventListener('resize', schedule, { passive: true, signal });
  window.addEventListener('scroll', schedule, { passive: true, signal });

  signal.addEventListener(
    'abort',
    () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
    { once: true },
  );

  publish();
}
