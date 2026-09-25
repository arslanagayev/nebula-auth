import type { AppBus, AuthView } from '../core/appEvents';
import { isTextFieldName } from '../core/types';
import type { FieldError } from '../lib/validation';

export type FieldValidator = (input: HTMLInputElement, controller: FormController) => FieldError;

export interface FormControllerOptions {
  readonly form: HTMLFormElement;
  readonly view: AuthView;
  readonly bus: AppBus;
  readonly validators: Readonly<Record<string, FieldValidator>>;
  /** Fields to re-validate when a field changes, e.g. `password → confirm`. */
  readonly dependents?: Readonly<Record<string, readonly string[]>>;
  /** Runs after client-side validation passed. The controller shows the pending state. */
  readonly onSubmit: (controller: FormController) => Promise<void>;
  /** Called after every input event, for side effects like the strength meter. */
  readonly onInput?: (name: string, controller: FormController) => void;
  readonly signal: AbortSignal;
}

interface FieldState {
  readonly input: HTMLInputElement;
  readonly error: HTMLElement | null;
  readonly validate: FieldValidator;
  /** Errors are only revealed after the first blur (or a submit attempt), never mid-typing. */
  touched: boolean;
}

const isTextInput = (input: HTMLInputElement): boolean =>
  input.type !== 'checkbox' && input.type !== 'radio';

/**
 * A small, framework-free form controller.
 *
 * Validation strategy ("reward early, punish late"): a field is validated live once the user
 * has left it, so errors never appear while someone is still typing their first attempt,
 * but a fixed error disappears on the very keystroke that fixes it. Errors are exposed with
 * `aria-invalid` and linked through `aria-describedby` in the markup.
 */
export class FormController {
  readonly form: HTMLFormElement;
  readonly view: AuthView;

  readonly #fields = new Map<string, FieldState>();
  readonly #bus: AppBus;
  readonly #dependents: Readonly<Record<string, readonly string[]>>;
  readonly #status: HTMLElement | null;
  readonly #submit: HTMLButtonElement | null;
  readonly #submitLabel: HTMLElement | null;
  readonly #idleLabel: string;
  #pending = false;
  #blocked = false;

  constructor({
    form,
    view,
    bus,
    validators,
    dependents = {},
    onSubmit,
    onInput,
    signal,
  }: FormControllerOptions) {
    this.form = form;
    this.view = view;
    this.#bus = bus;
    this.#dependents = dependents;
    this.#status = form.querySelector('[data-form-status]');
    this.#submit = form.querySelector('[data-submit]');
    this.#submitLabel = form.querySelector('[data-submit-label]');
    this.#idleLabel = this.#submitLabel?.textContent.trim() ?? '';

    for (const [name, validate] of Object.entries(validators)) {
      const input = form.elements.namedItem(name);
      if (!(input instanceof HTMLInputElement)) throw new Error(`Missing form field "${name}"`);
      const error =
        input.closest('[data-field]')?.querySelector<HTMLElement>('[data-error]') ?? null;
      this.#fields.set(name, { input, error, validate, touched: false });
    }

    form.addEventListener(
      'input',
      (event) => {
        const name = this.#nameOf(event.target);
        if (name === null) return;
        this.#revalidate(name);
        onInput?.(name, this);
      },
      { signal },
    );

    form.addEventListener(
      'focusout',
      (event) => {
        const name = this.#nameOf(event.target);
        const field = name === null ? undefined : this.#fields.get(name);
        if (!field || name === null) return;
        if (isTextFieldName(name)) this.#bus.emit('field:blur', { view, field: name });
        // Leaving an untouched, empty field is not an error yet: the user may be tabbing past.
        if (field.input.value !== '' || field.touched) {
          field.touched = true;
          this.validate(name);
        }
      },
      { signal },
    );

    form.addEventListener(
      'focusin',
      (event) => {
        const name = this.#nameOf(event.target);
        if (name !== null && isTextFieldName(name)) {
          this.#bus.emit('field:focus', { view, field: name });
        }
      },
      { signal },
    );

    form.addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        void this.#handleSubmit(onSubmit);
      },
      { signal },
    );
  }

  get pending(): boolean {
    return this.#pending;
  }

  input(name: string): HTMLInputElement {
    const field = this.#fields.get(name);
    if (!field) throw new Error(`Unknown field "${name}"`);
    return field.input;
  }

  value(name: string): string {
    return this.input(name).value;
  }

  checked(name: string): boolean {
    return this.input(name).checked;
  }

  /** Validates one field, shows or clears its message, and returns whether it is valid. */
  validate(name: string): boolean {
    const field = this.#fields.get(name);
    if (!field) return true;
    const message = field.validate(field.input, this);
    this.#render(field, field.touched ? message : null);
    return message === null;
  }

  /** Validates everything, reveals all errors and focuses the first invalid field. */
  validateAll(): boolean {
    let firstInvalid: HTMLInputElement | null = null;
    for (const [name, field] of this.#fields) {
      field.touched = true;
      if (!this.validate(name)) firstInvalid ??= field.input;
    }
    firstInvalid?.focus();
    return firstInvalid === null;
  }

  /** Shows an error that came from the server rather than from a validator. */
  setError(name: string, message: string): void {
    const field = this.#fields.get(name);
    if (!field) return;
    field.touched = true;
    this.#render(field, message);
  }

  setStatus(message: string): void {
    if (this.#status) this.#status.textContent = message;
  }

  setPending(pending: boolean, busyLabel?: string): void {
    this.#pending = pending;
    this.form.setAttribute('aria-busy', String(pending));
    for (const field of this.#fields.values()) field.input.readOnly = pending;

    if (this.#submit) {
      // aria-disabled instead of disabled keeps the button focusable while it is busy.
      this.#submit.setAttribute('aria-busy', String(pending));
      this.#submit.setAttribute('aria-disabled', String(pending));
    }
    if (this.#submitLabel) {
      this.#submitLabel.textContent = pending && busyLabel ? busyLabel : this.#idleLabel;
    }
  }

  /** Temporarily refuses submission (e.g. during a lockout) and shows `label` on the button. */
  block(label: string): void {
    this.#blocked = true;
    this.#submit?.setAttribute('aria-disabled', 'true');
    if (this.#submitLabel) this.#submitLabel.textContent = label;
  }

  unblock(): void {
    this.#blocked = false;
    this.#submit?.setAttribute('aria-disabled', 'false');
    if (this.#submitLabel) this.#submitLabel.textContent = this.#idleLabel;
  }

  get blocked(): boolean {
    return this.#blocked;
  }

  /** Empties one field and forgets that it was touched, e.g. a rejected password. */
  clear(name: string): void {
    const field = this.#fields.get(name);
    if (!field) return;
    field.input.value = '';
    field.touched = false;
    this.#render(field, null);
  }

  /** Clears values, messages and touched state. */
  reset(): void {
    this.form.reset();
    for (const field of this.#fields.values()) {
      field.touched = false;
      this.#render(field, null);
      field.input.removeAttribute('aria-invalid');
    }
    this.setStatus('');
  }

  #nameOf(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLInputElement)) return null;
    return this.#fields.has(target.name) ? target.name : null;
  }

  #revalidate(name: string): void {
    const field = this.#fields.get(name);
    if (!field) return;
    // Checkboxes have no "typing" phase: validate on every change once submitted or toggled.
    if (!isTextInput(field.input)) field.touched = true;
    if (field.touched) this.validate(name);
    for (const dependent of this.#dependents[name] ?? []) {
      if (this.#fields.get(dependent)?.touched) this.validate(dependent);
    }
  }

  #render(field: FieldState, message: FieldError): void {
    if (field.error) field.error.textContent = message ?? '';
    if (message !== null) {
      field.input.setAttribute('aria-invalid', 'true');
    } else if (field.touched && (field.input.value !== '' || !isTextInput(field.input))) {
      field.input.setAttribute('aria-invalid', 'false');
    } else {
      field.input.removeAttribute('aria-invalid');
    }
  }

  async #handleSubmit(onSubmit: (controller: FormController) => Promise<void>): Promise<void> {
    if (this.#pending || this.#blocked) return;
    this.setStatus('');
    if (!this.validateAll()) {
      this.#bus.emit('auth:error', { view: this.view, code: 'invalid-form' });
      return;
    }
    await onSubmit(this);
  }
}

/**
 * Show / hide password buttons. `aria-pressed` carries the state, so the accessible name
 * ("Show password") stays constant, as recommended for toggle buttons.
 */
export function initPasswordToggles(root: ParentNode, signal: AbortSignal): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-toggle-password]')) {
    const id = button.getAttribute('aria-controls');
    const input = id === null ? null : document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) continue;

    button.addEventListener(
      'click',
      () => {
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(reveal));
      },
      { signal },
    );
  }
}

/** Hides every revealed password again, e.g. before submitting so managers can save it. */
export function concealPasswords(root: ParentNode): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-toggle-password]')) {
    const id = button.getAttribute('aria-controls');
    const input = id === null ? null : document.getElementById(id);
    if (input instanceof HTMLInputElement) input.type = 'password';
    button.setAttribute('aria-pressed', 'false');
  }
}

/** "Caps Lock is on" hint for password fields, announced politely once when it appears. */
export function initCapsLockHints(root: ParentNode, signal: AbortSignal): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
    const hint = input.closest('[data-field]')?.querySelector<HTMLElement>('[data-caps]');
    if (!hint) continue;

    const update = (event: KeyboardEvent): void => {
      // Some virtual keyboards dispatch synthetic events without modifier support.
      if (typeof event.getModifierState !== 'function') return;
      const on = event.getModifierState('CapsLock');
      const text = on ? 'Caps Lock is on' : '';
      if (hint.textContent !== text) hint.textContent = text;
    };

    input.addEventListener('keydown', update, { signal });
    input.addEventListener('keyup', update, { signal });
    input.addEventListener(
      'blur',
      () => {
        hint.textContent = '';
      },
      { signal },
    );
  }
}
