import { evaluatePasswordStrength, type StrengthScore } from './passwordStrength';

/** A human-readable error message, or `null` when the value is valid. */
export type FieldError = string | null;

export const EMAIL_MAX_LENGTH = 254;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 60;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
/** New passwords must reach at least "Fair" on the strength meter. */
export const PASSWORD_MIN_SCORE: StrengthScore = 2;

const EMAIL_LOCAL_MAX_LENGTH = 64;
const INVALID_EMAIL = 'Enter a valid email address, like name@example.com.';

// RFC 5322 "dot-atom" local part: no leading, trailing or consecutive dots.
const LOCAL_PART = /^[a-z\d!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z\d!#$%&'*+/=?^_`{|}~-]+)*$/i;
// RFC 1035 label: 1–63 alphanumerics or hyphens, not starting or ending with a hyphen.
const DOMAIN_LABEL = /^(?!-)[a-z\d-]{1,63}(?<!-)$/i;
const TOP_LEVEL_DOMAIN = /^(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})$/i;
// Letters from any script, combining marks, spaces, apostrophes, hyphens and periods.
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}'’. -]*$/u;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function validateEmail(value: string): FieldError {
  const email = value.trim();
  if (email === '') return 'Enter your email address.';
  if (email.length > EMAIL_MAX_LENGTH) return 'This email address is too long.';

  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return INVALID_EMAIL;

  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split('.');
  const topLevel = labels.at(-1) ?? '';

  const isValid =
    local.length <= EMAIL_LOCAL_MAX_LENGTH &&
    LOCAL_PART.test(local) &&
    labels.length >= 2 &&
    labels.every((label) => DOMAIN_LABEL.test(label)) &&
    TOP_LEVEL_DOMAIN.test(topLevel);

  return isValid ? null : INVALID_EMAIL;
}

export function validateName(value: string): FieldError {
  const name = normalizeName(value);
  if (name === '') return 'Enter your name.';
  if (name.length < NAME_MIN_LENGTH) return `Use at least ${NAME_MIN_LENGTH} characters.`;
  if (name.length > NAME_MAX_LENGTH) return `Use ${NAME_MAX_LENGTH} characters or fewer.`;
  if (!NAME_PATTERN.test(name)) return 'Use letters, spaces, hyphens or apostrophes only.';
  return null;
}

/** Sign-in only checks presence: the server is the authority on whether it is correct. */
export function validateSignInPassword(value: string): FieldError {
  return value === '' ? 'Enter your password.' : null;
}

export interface PasswordContext {
  readonly name?: string;
  readonly email?: string;
}

/**
 * Rules for a new password, following NIST SP 800-63B: a minimum length, a generous maximum,
 * and a check against common and easily guessed passwords instead of arbitrary composition
 * rules. The strength meter nudges users towards stronger choices.
 */
export function validateNewPassword(value: string, context: PasswordContext = {}): FieldError {
  if (value === '') return 'Create a password.';
  if (value.trim() === '') return 'Your password can’t be only spaces.';
  if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (value.length > PASSWORD_MAX_LENGTH) return `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;

  const personal = [context.name, context.email].filter(
    (input): input is string => input !== undefined && input !== '',
  );
  const strength = evaluatePasswordStrength(value, personal);
  if (strength.score < PASSWORD_MIN_SCORE) {
    const [hint] = strength.hints;
    return hint === undefined
      ? 'This password is too easy to guess.'
      : `Too easy to guess. ${hint}`;
  }
  return null;
}

export function validatePasswordConfirmation(password: string, confirmation: string): FieldError {
  if (confirmation === '') return 'Confirm your password.';
  if (confirmation !== password) return 'Passwords don’t match.';
  return null;
}

export function validateTermsAccepted(accepted: boolean): FieldError {
  return accepted ? null : 'Please accept the terms to continue.';
}

export interface RegistrationInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export type RegistrationErrors = Partial<Record<keyof RegistrationInput, string>>;

/** Validates a complete registration payload, e.g. on the "server" side of the mock API. */
export function validateRegistration(input: RegistrationInput): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const name = validateName(input.name);
  const email = validateEmail(input.email);
  const password = validateNewPassword(input.password, { name: input.name, email: input.email });
  if (name !== null) errors.name = name;
  if (email !== null) errors.email = email;
  if (password !== null) errors.password = password;
  return errors;
}
