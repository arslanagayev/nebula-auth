export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  readonly tone?: ToastTone;
  /** Auto-dismiss delay in milliseconds. Paused while hovered or focused. */
  readonly duration?: number;
}

export interface Toaster {
  /** Shows a toast and returns a function that dismisses it early. */
  show(message: string, options?: ToastOptions): () => void;
  clear(): void;
}

export const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_DURATION = 5000;
/** Upper bound for the exit animation, in case `animationend` never fires. */
const EXIT_FALLBACK_MS = 400;

/**
 * Toasts inside an `aria-live="polite"` region: screen readers announce each message once,
 * without interrupting the user. The close glyph is `aria-hidden` so only the message is read.
 */
export function createToaster(region: HTMLElement): Toaster {
  const dismissers = new Map<HTMLElement, () => void>();

  const show = (
    message: string,
    { tone = 'info', duration = DEFAULT_DURATION }: ToastOptions = {},
  ) => {
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

    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = duration;
    let startedAt = 0;
    let dismissed = false;

    const remove = (): void => {
      toast.remove();
      dismissers.delete(toast);
    };

    const dismiss = (): void => {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(timer);
      toast.dataset.leaving = '';
      toast.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, EXIT_FALLBACK_MS);
    };

    const resume = (): void => {
      if (dismissed) return;
      startedAt = Date.now();
      timer = setTimeout(dismiss, remaining);
    };

    const pause = (): void => {
      clearTimeout(timer);
      remaining = Math.max(1000, remaining - (Date.now() - startedAt));
    };

    close.addEventListener('click', dismiss);
    toast.addEventListener('pointerenter', pause);
    toast.addEventListener('pointerleave', resume);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('focusout', resume);

    region.append(toast);
    dismissers.set(toast, dismiss);

    // Keep the stack short: the oldest toasts make room immediately.
    const overflow = [...dismissers.keys()].slice(0, -MAX_VISIBLE_TOASTS);
    for (const old of overflow) {
      old.remove();
      dismissers.delete(old);
    }

    resume();
    return dismiss;
  };

  return {
    show,
    clear: () => {
      for (const dismiss of [...dismissers.values()]) dismiss();
    },
  };
}
