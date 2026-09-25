import type { AppBus, AuthView } from '../core/appEvents';
import { DEMO_ACCOUNT, type AuthError, type AuthService, type Session } from '../lib/authService';
import { evaluatePasswordStrength, type StrengthScore } from '../lib/passwordStrength';
import {
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  validateSignInPassword,
  validateTermsAccepted,
} from '../lib/validation';
import type { FlipController, MotionPreference } from './flip';
import { concealPasswords, FormController, initCapsLockHints, initPasswordToggles } from './form';
import type { Toaster } from './toast';

export interface AuthUIOptions {
  readonly card: HTMLElement;
  readonly faces: Readonly<Record<AuthView, HTMLElement>>;
  readonly bus: AppBus;
  readonly auth: AuthService;
  readonly toaster: Toaster;
  readonly flip: FlipController;
  readonly reducedMotion: MotionPreference;
  readonly signal: AbortSignal;
  /** Delay between characters when the demo credentials are typed in. */
  readonly typingDelayMs?: number;
}

export interface AuthUI {
  readonly signIn: FormController;
  readonly register: FormController;
}

type Feedback = 'success' | 'error';

const FEEDBACK_MS: Readonly<Record<Feedback, number>> = { success: 2400, error: 1200 };

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const firstName = (name: string): string => name.trim().split(/\s+/u)[0] ?? name;

function query<T extends Element>(root: ParentNode, selector: string, type: new () => T): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing element ${selector}`);
  return element;
}

/** Wires both forms, the success screens and every auxiliary button to the auth service. */
export function initAuthUI({
  card,
  faces,
  bus,
  auth,
  toaster,
  flip,
  reducedMotion,
  signal,
  typingDelayMs = 28,
}: AuthUIOptions): AuthUI {
  const root = card;
  initPasswordToggles(root, signal);
  initCapsLockHints(root, signal);

  // ---------------------------------------------------------------------------------------
  // Card-level feedback: coloured rim, shake on error.

  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const feedback = (kind: Feedback): void => {
    clearTimeout(feedbackTimer);
    card.dataset.feedback = kind;
    feedbackTimer = setTimeout(() => {
      delete card.dataset.feedback;
    }, FEEDBACK_MS[kind]);

    if (kind === 'error' && !reducedMotion.matches) {
      card.classList.remove('is-shaking');
      // Restart the animation even if the previous shake has not finished yet.
      card.getBoundingClientRect();
      card.classList.add('is-shaking');
    }
  };
  card.addEventListener(
    'animationend',
    (event) => {
      if (event.target === card) card.classList.remove('is-shaking');
    },
    { signal },
  );

  // ---------------------------------------------------------------------------------------
  // Success panels

  const showPanel = (face: HTMLElement, panel: 'form' | 'success'): void => {
    query(face, '[data-panel="form"]', HTMLElement).hidden = panel !== 'form';
    query(face, '[data-panel="success"]', HTMLElement).hidden = panel !== 'success';
  };

  const showSuccess = (face: HTMLElement, title: string, text: string): void => {
    query(face, '[data-success-text]', HTMLElement).textContent = text;
    const heading = query(face, '[data-success-title]', HTMLElement);
    heading.textContent = title;
    showPanel(face, 'success');
    heading.focus();
  };

  const formatExpiry = (session: Session): string =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      session.expiresAt,
    );

  // ---------------------------------------------------------------------------------------
  // Sign in

  const signInFace = faces['sign-in'];
  let lockoutTimer: ReturnType<typeof setInterval> | undefined;

  const startLockout = (form: FormController, retryAfterMs: number): void => {
    clearInterval(lockoutTimer);
    const until = Date.now() + retryAfterMs;
    const tick = (): void => {
      const seconds = Math.ceil((until - Date.now()) / 1000);
      if (seconds <= 0) {
        clearInterval(lockoutTimer);
        form.unblock();
        form.setStatus('');
        return;
      }
      // Only the button label counts down; the alert above is announced once.
      form.block(`Try again in ${seconds}s`);
    };
    tick();
    lockoutTimer = setInterval(tick, 1000);
  };
  signal.addEventListener('abort', () => {
    clearInterval(lockoutTimer);
    clearTimeout(feedbackTimer);
  });

  const handleSignInError = (form: FormController, error: AuthError): void => {
    bus.emit('auth:error', { view: 'sign-in', code: error.code });
    feedback('error');
    form.setStatus(error.message);
    if (error.code === 'rate-limited' && error.retryAfterMs !== undefined) {
      startLockout(form, error.retryAfterMs);
    }
    form.clear('password');
    form.input('password').focus();
  };

  const signIn = new FormController({
    form: query(signInFace, 'form', HTMLFormElement),
    view: 'sign-in',
    bus,
    signal,
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
        remember: signInFace.querySelector<HTMLInputElement>('[name="remember"]')?.checked ?? false,
      });
      form.setPending(false);

      if (!result.ok) {
        handleSignInError(form, result.error);
        return;
      }

      const { user } = result.value;
      bus.emit('auth:success', { view: 'sign-in', name: user.name });
      feedback('success');
      showSuccess(
        signInFace,
        `Welcome back, ${firstName(user.name)}`,
        `You are signed in as ${user.email}. Session valid until ${formatExpiry(result.value)}.`,
      );
      toaster.show(`Signed in as ${user.email}`, { tone: 'success' });
    },
  });

  query(signInFace, '[data-success-action]', HTMLButtonElement).addEventListener(
    'click',
    () => {
      signIn.reset();
      showPanel(signInFace, 'form');
      bus.emit('auth:reset', { view: 'sign-in' });
      signIn.input('email').focus();
      toaster.show('You have been signed out.');
    },
    { signal },
  );

  // ---------------------------------------------------------------------------------------
  // Register

  const registerFace = faces.register;
  const meter = query(registerFace, '[data-strength]', HTMLElement);
  const meterLabel = query(registerFace, '[data-strength-label]', HTMLElement);
  const meterHint = query(registerFace, '[data-strength-hint]', HTMLElement);

  const register: FormController = new FormController({
    form: query(registerFace, 'form', HTMLFormElement),
    view: 'register',
    bus,
    signal,
    validators: {
      name: (input) => validateName(input.value),
      email: (input) => validateEmail(input.value),
      password: (input, form) =>
        validateNewPassword(input.value, { name: form.value('name'), email: form.value('email') }),
      confirm: (input, form) => validatePasswordConfirmation(form.value('password'), input.value),
      terms: (input) => validateTermsAccepted(input.checked),
    },
    dependents: {
      name: ['password'],
      email: ['password'],
      password: ['confirm'],
    },
    onInput: (name) => {
      if (name === 'password' || name === 'name' || name === 'email') updateStrength();
    },
    onSubmit: async (form) => {
      concealPasswords(form.form);
      form.setPending(true, 'Creating account…');
      bus.emit('auth:pending', { view: 'register' });

      const result = await auth.register({
        name: form.value('name'),
        email: form.value('email'),
        password: form.value('password'),
      });
      form.setPending(false);

      if (!result.ok) {
        bus.emit('auth:error', { view: 'register', code: result.error.code });
        feedback('error');
        form.setStatus(result.error.message);
        const fields = Object.entries(result.error.fields ?? {});
        for (const [name, message] of fields) form.setError(name, message);
        const [first] = fields;
        if (first) form.input(first[0]).focus();
        return;
      }

      const { user } = result.value;
      bus.emit('auth:success', { view: 'register', name: user.name });
      feedback('success');
      showSuccess(
        registerFace,
        `Welcome aboard, ${firstName(user.name)}`,
        `Your account is ready. Sign in as ${user.email} to continue.`,
      );
      toaster.show('Account created. Welcome to Nebula!', { tone: 'success' });
    },
  });

  function updateStrength(): void {
    const password = register.value('password');
    let score: StrengthScore | null = null;
    if (password === '') {
      meter.hidden = true;
      meter.dataset.score = '';
    } else {
      const strength = evaluatePasswordStrength(password, [
        register.value('name'),
        register.value('email'),
      ]);
      score = strength.score;
      meter.hidden = false;
      meter.dataset.score = String(score);
      meterLabel.textContent = strength.label;
      meterHint.textContent = strength.hints[0] ?? 'Great password.';
    }
    // Only the register face shows a strength meter, so the scene follows it only there.
    const visibleScore = flip.view === 'register' ? score : null;
    if (bus.latest('password:strength')?.score !== visibleScore) {
      bus.emit('password:strength', { score: visibleScore });
    }
  }
  bus.on('view:flip', updateStrength, { signal });

  query(registerFace, '[data-success-action]', HTMLButtonElement).addEventListener(
    'click',
    () => {
      const email = register.value('email').trim();
      register.reset();
      updateStrength();
      showPanel(registerFace, 'form');
      bus.emit('auth:reset', { view: 'register' });

      signIn.reset();
      signIn.input('email').value = email;
      void flip.flipTo('sign-in', { focus: signIn.input('password') });
    },
    { signal },
  );

  // ---------------------------------------------------------------------------------------
  // Auxiliary buttons

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-flip]')) {
    button.addEventListener(
      'click',
      () => {
        const target = button.dataset.flip;
        if (target === 'sign-in' || target === 'register') void flip.flipTo(target);
      },
      { signal },
    );
  }

  let typingRun = 0;
  const typeInto = async (input: HTMLInputElement, text: string, run: number): Promise<void> => {
    input.focus();
    if (reducedMotion.matches || typingDelayMs === 0) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    input.value = '';
    for (const char of text) {
      if (run !== typingRun) return;
      input.value += char;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(typingDelayMs);
    }
  };

  query(signInFace, '[data-fill-demo]', HTMLButtonElement).addEventListener(
    'click',
    () => {
      if (signIn.pending) return;
      const run = ++typingRun;
      void (async () => {
        await typeInto(signIn.input('email'), DEMO_ACCOUNT.email, run);
        await typeInto(signIn.input('password'), DEMO_ACCOUNT.password, run);
        if (run === typingRun)
          signInFace.querySelector<HTMLButtonElement>('[data-submit]')?.focus();
      })();
    },
    { signal },
  );

  query(signInFace, '[data-forgot]', HTMLButtonElement).addEventListener(
    'click',
    () => {
      toaster.show(
        `Password reset is not part of this demo. Try ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}.`,
      );
    },
    { signal },
  );

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-provider]')) {
    button.addEventListener(
      'click',
      () => {
        const provider = button.dataset.provider ?? 'Social';
        toaster.show(`${provider} sign-in is simulated here. No data leaves your browser.`);
      },
      { signal },
    );
  }

  return { signIn, register };
}
