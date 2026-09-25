// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ACCOUNT } from '../src/lib/authService';
import {
  $,
  blur,
  errorOf,
  eventsOf,
  field,
  mountPage,
  settle,
  submit,
  type,
  type Page,
} from './helpers/page';

let page: Page;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  page.controller.abort();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('sign-in form', () => {
  const signInForm = () => $<HTMLFormElement>('form', page.signInFace);

  it('reveals every error on an empty submit and focuses the first invalid field', () => {
    page = mountPage();
    const email = field(page.signInFace, 'email');
    const password = field(page.signInFace, 'password');

    submit(signInForm());

    expect(errorOf(email)).toBe('Enter your email address.');
    expect(errorOf(password)).toBe('Enter your password.');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email);
    expect(eventsOf(page, 'auth:error')).toEqual([{ view: 'sign-in', code: 'invalid-form' }]);
    expect(eventsOf(page, 'auth:pending')).toEqual([]);
  });

  it('does not nag while typing, validates after blur and clears the error on the fixing keystroke', () => {
    page = mountPage();
    const email = field(page.signInFace, 'email');

    type(email, 'demo@');
    expect(errorOf(email)).toBe('');
    expect(email.hasAttribute('aria-invalid')).toBe(false);

    blur(email);
    expect(errorOf(email)).toMatch(/valid email/);
    expect(email.getAttribute('aria-invalid')).toBe('true');

    type(email, 'demo@nebula.dev');
    expect(errorOf(email)).toBe('');
    expect(email.getAttribute('aria-invalid')).toBe('false');
  });

  it('ignores tabbing through an untouched empty field', () => {
    page = mountPage();
    const email = field(page.signInFace, 'email');
    blur(email);
    expect(errorOf(email)).toBe('');
    expect(email.hasAttribute('aria-invalid')).toBe(false);
  });

  it('emits focus and blur events for text fields only', () => {
    page = mountPage();
    const email = field(page.signInFace, 'email');
    email.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    blur(email);
    field(page.signInFace, 'remember').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(eventsOf(page, 'field:focus')).toEqual([{ view: 'sign-in', field: 'email' }]);
    expect(eventsOf(page, 'field:blur')).toEqual([{ view: 'sign-in', field: 'email' }]);
  });

  it('signs in the demo account with a loading state and a success screen', async () => {
    page = mountPage();
    const submitButton = $<HTMLButtonElement>('[data-submit]', page.signInFace);
    type(field(page.signInFace, 'email'), DEMO_ACCOUNT.email);
    type(field(page.signInFace, 'password'), DEMO_ACCOUNT.password);

    submit(signInForm());

    expect(submitButton.getAttribute('aria-busy')).toBe('true');
    expect(submitButton.getAttribute('aria-disabled')).toBe('true');
    expect($('[data-submit-label]', page.signInFace).textContent).toBe('Signing in…');
    expect(signInForm().getAttribute('aria-busy')).toBe('true');
    expect(eventsOf(page, 'auth:pending')).toEqual([{ view: 'sign-in' }]);

    // A second submit while pending is ignored.
    submit(signInForm());
    expect(eventsOf(page, 'auth:pending')).toHaveLength(1);

    await settle();

    const title = $('[data-success-title]', page.signInFace);
    expect(title.textContent).toBe('Welcome back, Demo');
    expect($('[data-panel="success"]', page.signInFace).hidden).toBe(false);
    expect($('[data-panel="form"]', page.signInFace).hidden).toBe(true);
    expect(document.activeElement).toBe(title);
    expect($('[data-success-text]', page.signInFace).textContent).toContain(DEMO_ACCOUNT.email);
    expect(page.card.dataset.feedback).toBe('success');
    expect(eventsOf(page, 'auth:success')).toEqual([{ view: 'sign-in', name: 'Demo' }]);
    expect(page.toasts.textContent).toContain(`Signed in as ${DEMO_ACCOUNT.email}`);
    expect(submitButton.getAttribute('aria-busy')).toBe('false');
    expect($('[data-submit-label]', page.signInFace).textContent).toBe('Sign in');

    await settle(2400);
    expect(page.card.dataset.feedback).toBeUndefined();
  });

  it('signs out back to an empty form', async () => {
    page = mountPage();
    type(field(page.signInFace, 'email'), DEMO_ACCOUNT.email);
    type(field(page.signInFace, 'password'), DEMO_ACCOUNT.password);
    submit(signInForm());
    await settle();

    $<HTMLButtonElement>('[data-success-action]', page.signInFace).click();

    expect($('[data-panel="form"]', page.signInFace).hidden).toBe(false);
    expect(field(page.signInFace, 'email').value).toBe('');
    expect(document.activeElement).toBe(field(page.signInFace, 'email'));
    expect(eventsOf(page, 'auth:reset')).toEqual([{ view: 'sign-in' }]);
  });

  it('shows an inline alert, shakes the card and clears the password on bad credentials', async () => {
    page = mountPage();
    const password = field(page.signInFace, 'password');
    type(field(page.signInFace, 'email'), DEMO_ACCOUNT.email);
    type(password, 'wrong-password');

    submit(signInForm());
    await settle();

    expect($('[data-form-status]', page.signInFace).textContent).toBe(
      'Incorrect email or password.',
    );
    expect(password.value).toBe('');
    expect(password.hasAttribute('aria-invalid')).toBe(false);
    expect(document.activeElement).toBe(password);
    expect(page.card.dataset.feedback).toBe('error');
    expect(page.card.classList.contains('is-shaking')).toBe(true);
    expect(eventsOf(page, 'auth:error')).toEqual([
      { view: 'sign-in', code: 'invalid-credentials' },
    ]);

    page.card.dispatchEvent(new Event('animationend'));
    expect(page.card.classList.contains('is-shaking')).toBe(false);
  });

  it('does not shake the card for users who prefer reduced motion', async () => {
    page = mountPage({ reducedMotion: true });
    type(field(page.signInFace, 'email'), DEMO_ACCOUNT.email);
    type(field(page.signInFace, 'password'), 'nope');
    submit(signInForm());
    await settle();

    expect(page.card.dataset.feedback).toBe('error');
    expect(page.card.classList.contains('is-shaking')).toBe(false);
  });

  it('blocks the form with a countdown while the account is locked', async () => {
    page = mountPage({ auth: { maxFailedAttempts: 1, lockoutMs: 3_000 } });
    const label = $('[data-submit-label]', page.signInFace);
    const button = $<HTMLButtonElement>('[data-submit]', page.signInFace);
    type(field(page.signInFace, 'email'), DEMO_ACCOUNT.email);
    type(field(page.signInFace, 'password'), 'wrong');

    submit(signInForm());
    await settle();

    expect($('[data-form-status]', page.signInFace).textContent).toBe(
      'Too many failed attempts. Try again in 3 seconds.',
    );
    expect(label.textContent).toBe('Try again in 3s');
    expect(button.getAttribute('aria-disabled')).toBe('true');

    // Submitting while blocked does nothing.
    type(field(page.signInFace, 'password'), DEMO_ACCOUNT.password);
    submit(signInForm());
    expect(eventsOf(page, 'auth:pending')).toHaveLength(1);

    await settle(1000);
    expect(label.textContent).toBe('Try again in 2s');

    await settle(2000);
    expect(label.textContent).toBe('Sign in');
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect($('[data-form-status]', page.signInFace).textContent).toBe('');
  });

  it('types the demo credentials when the demo pill is used', async () => {
    page = mountPage();
    $<HTMLButtonElement>('[data-fill-demo]', page.signInFace).click();
    await settle(0);

    expect(field(page.signInFace, 'email').value).toBe(DEMO_ACCOUNT.email);
    expect(field(page.signInFace, 'password').value).toBe(DEMO_ACCOUNT.password);
    expect(document.activeElement).toBe($('[data-submit]', page.signInFace));
  });

  it('explains that password reset and social sign-in are simulated', () => {
    page = mountPage();
    $<HTMLButtonElement>('[data-forgot]', page.signInFace).click();
    $<HTMLButtonElement>('[data-provider="GitHub"]', page.signInFace).click();

    expect(page.toasts.textContent).toContain('Password reset is not part of this demo');
    expect(page.toasts.textContent).toContain('GitHub sign-in is simulated');
  });
});

describe('password helpers', () => {
  it('toggles password visibility with aria-pressed', () => {
    page = mountPage();
    const password = field(page.signInFace, 'password');
    const toggle = $<HTMLButtonElement>('[data-toggle-password]', page.signInFace);

    toggle.click();
    expect(password.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Show password');

    toggle.click();
    expect(password.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('conceals revealed passwords before submitting', () => {
    page = mountPage();
    const password = field(page.signInFace, 'password');
    $<HTMLButtonElement>('[data-toggle-password]', page.signInFace).click();
    type(field(page.signInFace, 'email'), DEMO_ACCOUNT.email);
    type(password, DEMO_ACCOUNT.password);

    submit($<HTMLFormElement>('form', page.signInFace));
    expect(password.type).toBe('password');
  });

  it('warns when Caps Lock is on and clears the hint on blur', () => {
    page = mountPage();
    const password = field(page.signInFace, 'password');
    const hint = $('[data-caps]', page.signInFace);

    const keydown = new KeyboardEvent('keydown', { key: 'A' });
    Object.defineProperty(keydown, 'getModifierState', {
      value: (key: string) => key === 'CapsLock',
    });
    password.dispatchEvent(keydown);
    expect(hint.textContent).toBe('Caps Lock is on');

    const keyup = new KeyboardEvent('keyup', { key: 'a' });
    Object.defineProperty(keyup, 'getModifierState', { value: () => false });
    password.dispatchEvent(keyup);
    expect(hint.textContent).toBe('');

    password.dispatchEvent(keydown);
    password.dispatchEvent(new FocusEvent('blur'));
    expect(hint.textContent).toBe('');
  });
});

describe('create account form', () => {
  const registerForm = () => $<HTMLFormElement>('form', page.registerFace);

  async function openRegister(): Promise<void> {
    $<HTMLButtonElement>('[data-flip="register"]', page.signInFace).click();
    await settle(0);
  }

  function fillValidRegistration(overrides: Partial<Record<string, string>> = {}): void {
    const values = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Analytical#Engine1843',
      confirm: 'Analytical#Engine1843',
      ...overrides,
    };
    for (const [name, value] of Object.entries(values)) type(field(page.registerFace, name), value);
    const terms = field(page.registerFace, 'terms');
    terms.checked = true;
    terms.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('flips to the register face, makes the other face inert and moves focus', async () => {
    page = mountPage();
    await openRegister();

    expect(page.card.dataset.view).toBe('register');
    expect(page.signInFace.hasAttribute('inert')).toBe(true);
    expect(page.registerFace.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(field(page.registerFace, 'name'));
    expect(eventsOf(page, 'view:flip')).toEqual([{ view: 'register' }]);
  });

  it('updates the strength meter and publishes the score for the 3D core', async () => {
    page = mountPage();
    await openRegister();
    const meter = $('[data-strength]', page.registerFace);
    const password = field(page.registerFace, 'password');
    expect(meter.hidden).toBe(true);

    type(password, 'password');
    expect(meter.hidden).toBe(false);
    expect(meter.dataset.score).toBe('0');
    expect($('[data-strength-label]', page.registerFace).textContent).toBe('Very weak');

    type(password, 'correct horse battery staple');
    expect(meter.dataset.score).toBe('4');
    expect($('[data-strength-label]', page.registerFace).textContent).toBe('Excellent');
    expect($('[data-strength-hint]', page.registerFace).textContent).toBe('Great password.');

    type(password, '');
    expect(meter.hidden).toBe(true);
    expect(eventsOf(page, 'password:strength')).toEqual([
      { score: null },
      { score: 0 },
      { score: 4 },
      { score: null },
    ]);
  });

  it('stops publishing strength colours while the sign-in face is shown', async () => {
    page = mountPage();
    await openRegister();
    type(field(page.registerFace, 'password'), 'Nebula#2026');

    $<HTMLButtonElement>('[data-flip="sign-in"]', page.registerFace).click();
    await settle(0);

    expect(page.bus.latest('password:strength')).toEqual({ score: null });
    expect(document.activeElement).toBe(field(page.signInFace, 'email'));
  });

  it('re-checks the confirmation when the password changes', async () => {
    page = mountPage();
    await openRegister();
    const confirm = field(page.registerFace, 'confirm');
    type(field(page.registerFace, 'password'), 'Nebula#2026');
    type(confirm, 'Nebula#2026');
    blur(confirm);
    expect(errorOf(confirm)).toBe('');

    type(field(page.registerFace, 'password'), 'Nebula#2027');
    expect(errorOf(confirm)).toBe('Passwords don’t match.');
  });

  it('requires the terms to be accepted', async () => {
    page = mountPage();
    await openRegister();
    fillValidRegistration();
    const terms = field(page.registerFace, 'terms');
    terms.checked = false;
    terms.dispatchEvent(new Event('input', { bubbles: true }));

    submit(registerForm());
    expect(errorOf(terms)).toBe('Please accept the terms to continue.');
    expect(document.activeElement).toBe(terms);
  });

  it('creates an account and continues to sign in with the email prefilled', async () => {
    page = mountPage();
    await openRegister();
    fillValidRegistration();

    submit(registerForm());
    expect($('[data-submit-label]', page.registerFace).textContent).toBe('Creating account…');
    await settle();

    expect($('[data-success-title]', page.registerFace).textContent).toBe('Welcome aboard, Ada');
    expect(eventsOf(page, 'auth:success')).toEqual([{ view: 'register', name: 'Ada Lovelace' }]);

    $<HTMLButtonElement>('[data-success-action]', page.registerFace).click();
    await settle(0);

    expect(page.card.dataset.view).toBe('sign-in');
    expect(field(page.signInFace, 'email').value).toBe('ada@example.com');
    expect(document.activeElement).toBe(field(page.signInFace, 'password'));
    expect(field(page.registerFace, 'name').value).toBe('');
    expect(eventsOf(page, 'auth:reset')).toEqual([{ view: 'register' }]);

    // The new account really exists.
    type(field(page.signInFace, 'password'), 'Analytical#Engine1843');
    submit($<HTMLFormElement>('form', page.signInFace));
    await settle();
    expect($('[data-success-title]', page.signInFace).textContent).toBe('Welcome back, Ada');
  });

  it('puts server-side errors on the matching field', async () => {
    page = mountPage();
    await openRegister();
    fillValidRegistration({ email: DEMO_ACCOUNT.email });

    submit(registerForm());
    await settle();

    const email = field(page.registerFace, 'email');
    expect(errorOf(email)).toBe('This email is already registered. Try signing in instead.');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email);
    expect($('[data-form-status]', page.registerFace).textContent).toBe(
      'An account with this email already exists.',
    );
    expect(eventsOf(page, 'auth:error')).toEqual([{ view: 'register', code: 'email-taken' }]);
  });
});
