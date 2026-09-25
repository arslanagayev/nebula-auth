export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  readonly tone?: ToastTone;
  /**
   * Auto-dismiss delay in milliseconds, paused while the toast is hovered or focused.
   * Defaults to a reading-time estimate; `error` toasts stay until they are closed.
   */
  readonly duration?: number;
}

export interface Toaster {
  /** Shows a toast and returns a function that dismisses it early. */
  show(message: string, options?: ToastOptions): () => void;
  /** Dismisses every toast, e.g. when the app is torn down during hot reloads. */
  clear(): void;
}

export const MAX_VISIBLE_TOASTS = 3;
const MIN_DURATION_MS = 5000;
/** Generous reading time per character, so long messages stay long enough to read. */
const MS_PER_CHARACTER = 90;
/** Upper bound for the exit animation, in case `animationend` never fires. */
const EXIT_FALLBACK_MS = 400;

export const readingTime = (message: string): number =>
  Math.max(MIN_DURATION_MS, message.length * MS_PER_CHARACTER);

/**
 * Visual toasts plus a separate, visually hidden `role="status"` announcer.
 *
 * Only the message text goes into the live region, so screen readers announce it once and
 * politely, without the close button's name. The visible stack sits in a labelled landmark
 * where keyboard users can reach the close buttons.
 */
export function createToaster(region: HTMLElement, announcer: HTMLElement): Toaster {
  /** Every visible toast with its two ways out: animated, or immediate. */
  const toasts = new Map<HTMLElement, { dismiss: () => void; remove: () => void }>();

  const show = (message: string, { tone = 'info', duration }: ToastOptions = {}) => {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.tone = tone;

    const icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('p');
    text.className = 'toast__message';
    text.textContent = message;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.innerHTML = '<span aria-hidden="true">×</span>';

    toast.append(icon, text, close);

    const lifetime =
      duration ?? (tone === 'error' ? Number.POSITIVE_INFINITY : readingTime(message));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = lifetime;
    let startedAt = 0;
    let hovered = false;
    let focused = false;
    let running = false;
    let dismissed = false;

    const remove = (): void => {
      dismissed = true;
      clearTimeout(timer);
      toast.remove();
      toasts.delete(toast);
    };

    const dismiss = (): void => {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(timer);
      toast.dataset.leaving = '';
      toast.addEventListener('animationend', remove, { once: true });
      timer = setTimeout(remove, EXIT_FALLBACK_MS);
    };

    // The timer runs only while the toast is neither hovered nor focused. Both sources are
    // tracked separately, so leaving with the mouse does not restart it while focus is inside.
    const sync = (): void => {
      if (dismissed || !Number.isFinite(remaining)) return;
      const shouldRun = !hovered && !focused;
      if (shouldRun === running) return;
      running = shouldRun;
      if (running) {
        startedAt = Date.now();
        timer = setTimeout(dismiss, remaining);
      } else {
        clearTimeout(timer);
        remaining = Math.max(1000, remaining - (Date.now() - startedAt));
      }
    };

    close.addEventListener('click', dismiss);
    toast.addEventListener('pointerenter', () => {
      hovered = true;
      sync();
    });
    toast.addEventListener('pointerleave', () => {
      hovered = false;
      sync();
    });
    toast.addEventListener('focusin', () => {
      focused = true;
      sync();
    });
    toast.addEventListener('focusout', (event) => {
      if (event.relatedTarget instanceof Node && toast.contains(event.relatedTarget)) return;
      focused = false;
      sync();
    });

    region.append(toast);
    toasts.set(toast, { dismiss, remove });
    announcer.textContent = message;

    // Keep the stack short: the oldest toasts make room immediately.
    for (const old of [...toasts.values()].slice(0, -MAX_VISIBLE_TOASTS)) old.remove();

    sync();
    return dismiss;
  };

  return {
    show,
    clear: () => {
      for (const { dismiss } of [...toasts.values()]) dismiss();
      announcer.textContent = '';
    },
  };
}
