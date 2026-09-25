import { DEMO_ACCOUNT } from '../lib/authService';
import { NEVER, wait, type MediaPreference } from './dom';
import type { FormController } from './form';

export interface DemoAutofillOptions {
  readonly button: HTMLButtonElement;
  readonly form: FormController;
  readonly submit: HTMLElement;
  /** Delay between characters; 0 fills each field at once. */
  readonly typingDelayMs: number;
  readonly reducedMotion: MediaPreference;
  /** On touch screens the fields are not focused, so the keyboard does not flash open. */
  readonly coarsePointer?: MediaPreference;
  readonly signal: AbortSignal;
}

export interface DemoAutofill {
  /** Stops a run that is still typing, e.g. because the card is flipping away. */
  cancel(): void;
}

/**
 * The "Demo" pill: types the demo credentials into the sign-in form character by character,
 * which also shows off the scene's reaction to focus and input. Each click starts a new run
 * and cancels the previous one.
 */
export function initDemoAutofill({
  button,
  form,
  submit,
  typingDelayMs,
  reducedMotion,
  coarsePointer = NEVER,
  signal,
}: DemoAutofillOptions): DemoAutofill {
  let run = 0;
  signal.addEventListener('abort', () => {
    run += 1;
  });

  const typeInto = async (input: HTMLInputElement, text: string, current: number) => {
    if (!coarsePointer.matches) input.focus();
    if (reducedMotion.matches || typingDelayMs === 0) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    input.value = '';
    for (const char of text) {
      if (current !== run) return;
      input.value += char;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(typingDelayMs);
    }
  };

  button.addEventListener(
    'click',
    () => {
      if (form.pending) return;
      const current = ++run;
      void (async () => {
        await typeInto(form.input('email'), DEMO_ACCOUNT.email, current);
        if (current !== run) return;
        await typeInto(form.input('password'), DEMO_ACCOUNT.password, current);
        if (current === run) submit.focus();
      })();
    },
    { signal },
  );

  return {
    cancel: () => {
      run += 1;
    },
  };
}
