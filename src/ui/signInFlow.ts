import type { AppBus } from '../core/appEvents';
import type { AuthError, AuthService } from '../lib/authService';
import { validateEmail, validateSignInPassword } from '../lib/validation';
import { requireElement } from './dom';
import { concealPasswords, FormController } from './form';
import { firstName, showPanel, showSuccess, timeElement } from './panels';
import type { Toaster } from './toast';

export interface SignInFlowOptions {
  readonly face: HTMLElement;
  readonly bus: AppBus;
  readonly auth: AuthService;
  readonly toaster: Toaster;
  readonly onPendingChange: (form: FormController) => void;
  readonly signal: AbortSignal;
}

/** The sign-in form: request, lockout countdown, success screen and sign-out. */
export function createSignInFlow({
  face,
  bus,
  auth,
  toaster,
  onPendingChange,
  signal,
}: SignInFlowOptions): FormController {
  let lockoutTimer: ReturnType<typeof setInterval> | undefined;
  signal.addEventListener('abort', () => {
    clearInterval(lockoutTimer);
  });

  const startLockout = (form: FormController, retryAfterMs: number): void => {
    clearInterval(lockoutTimer);
    const until = Date.now() + retryAfterMs;
    const tick = (): void => {
      const seconds = Math.ceil((until - Date.now()) / 1000);
      if (seconds <= 0) {
        clearInterval(lockoutTimer);
        form.unblock();
        form.setStatus('');
        // The alert above was announced once; the end of the pause deserves one too.
        toaster.show('You can try signing in again.');
        return;
      }
      // Only the button label counts down, so screen readers are not interrupted every second.
      form.block(`Try again in ${seconds}s`);
    };
    tick();
    lockoutTimer = setInterval(tick, 1000);
  };

  const handleError = (form: FormController, error: AuthError): void => {
    bus.emit('auth:error', { view: 'sign-in', code: error.code });
    // The password field lists the status in its aria-describedby, so the message is read
    // again together with the field that receives focus.
    form.setStatus(error.message);
    if (error.code === 'rate-limited' && error.retryAfterMs !== undefined) {
      startLockout(form, error.retryAfterMs);
    }
    form.clear('password');
    form.input('password').focus();
  };

  const signIn = new FormController({
    form: requireElement(face, 'form', HTMLFormElement),
    view: 'sign-in',
    bus,
    signal,
    onPendingChange,
    validators: {
      email: (input) => validateEmail(input.value),
      password: (input) => validateSignInPassword(input.value),
    },
    onSubmit: async (form) => {
      concealPasswords(form.form);
      form.setPending(true, 'Signing in…');
      bus.emit('auth:pending', { view: 'sign-in' });

      const result = await auth.signIn({
        email: form.value('email'),
        password: form.value('password'),
        remember: form.checked('remember'),
      });
      form.setPending(false);

      if (!result.ok) {
        handleError(form, result.error);
        return;
      }

      const { user, expiresAt } = result.value;
      bus.emit('auth:success', { view: 'sign-in', name: user.name });
      showSuccess(face, `Welcome back, ${firstName(user.name)}`, [
        `You are signed in as ${user.email}. Session valid until `,
        timeElement(expiresAt),
        '.',
      ]);
      toaster.show(`Signed in as ${user.email}`, { tone: 'success' });
    },
  });

  requireElement(face, '[data-success-action]', HTMLButtonElement).addEventListener(
    'click',
    () => {
      signIn.reset();
      showPanel(face, 'form');
      bus.emit('auth:reset', { view: 'sign-in' });
      signIn.input('email').focus();
      toaster.show('You have been signed out.');
    },
    { signal },
  );

  return signIn;
}
