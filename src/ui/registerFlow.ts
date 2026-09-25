import type { AppBus } from '../core/appEvents';
import type { AuthService } from '../lib/authService';
import {
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  validateTermsAccepted,
} from '../lib/validation';
import { requireElement } from './dom';
import type { FlipController } from './flip';
import { concealPasswords, FormController } from './form';
import { firstName, showPanel, showSuccess } from './panels';
import { createStrengthMeter } from './strengthMeter';
import type { Toaster } from './toast';

export interface RegisterFlowOptions {
  readonly face: HTMLElement;
  readonly bus: AppBus;
  readonly auth: AuthService;
  readonly toaster: Toaster;
  readonly flip: FlipController;
  /** The sign-in form, prefilled with the new email after an account is created. */
  readonly signIn: FormController;
  readonly onPendingChange: (form: FormController) => void;
  readonly signal: AbortSignal;
}

/** The create-account form: live strength meter, server-side errors and the success screen. */
export function createRegisterFlow({
  face,
  bus,
  auth,
  toaster,
  flip,
  signIn,
  onPendingChange,
  signal,
}: RegisterFlowOptions): FormController {
  const meter = createStrengthMeter(face);

  const updateStrength = (form: FormController): void => {
    const score = meter.update(form.value('password'), [form.value('name'), form.value('email')]);
    // Only the register face shows a strength meter, so the scene follows it only there.
    const visibleScore = flip.view === 'register' ? score : null;
    if (bus.latest('password:strength')?.score !== visibleScore) {
      bus.emit('password:strength', { score: visibleScore });
    }
  };

  const register = new FormController({
    form: requireElement(face, 'form', HTMLFormElement),
    view: 'register',
    bus,
    signal,
    onPendingChange,
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
    onInput: (name, form) => {
      if (name === 'password' || name === 'name' || name === 'email') updateStrength(form);
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
        form.setStatus(result.error.message);
        const fields = Object.entries(result.error.fields ?? {});
        for (const [name, message] of fields) form.setError(name, message);
        const [first] = fields;
        if (first) form.input(first[0]).focus();
        return;
      }

      const { user } = result.value;
      bus.emit('auth:success', { view: 'register', name: user.name });
      showSuccess(face, `Welcome aboard, ${firstName(user.name)}`, [
        `Your account is ready. Sign in as ${user.email} to continue.`,
      ]);
      toaster.show('Account created. Welcome to Nebula!', { tone: 'success' });
    },
  });

  bus.on(
    'view:flip',
    () => {
      updateStrength(register);
    },
    { signal },
  );

  requireElement(face, '[data-success-action]', HTMLButtonElement).addEventListener(
    'click',
    () => {
      const email = register.value('email').trim();
      register.reset();
      updateStrength(register);
      showPanel(face, 'form');
      bus.emit('auth:reset', { view: 'register' });

      signIn.reset();
      signIn.input('email').value = email;
      void flip.flipTo('sign-in', { focus: signIn.input('password') });
    },
    { signal },
  );

  return register;
}
