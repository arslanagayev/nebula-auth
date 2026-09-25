/**
 * Domain types shared by every layer. They live in `core/` so that `lib/`, `ui/` and `scene/`
 * can agree on them without importing each other; `core/` itself depends on nothing.
 */

/** The two faces of the card. */
export type AuthView = 'sign-in' | 'register';

/** Password strength on the 0–4 scale used by the meter and the glass core. */
export type StrengthScore = 0 | 1 | 2 | 3 | 4;

/** Failures an {@link AuthService} can report as values (see `lib/authService.ts`). */
export type AuthErrorCode =
  'invalid-credentials' | 'rate-limited' | 'email-taken' | 'invalid-input';

/** Text fields whose focus the scene reacts to. */
export type TextFieldName = 'name' | 'email' | 'password' | 'confirm';

export const TEXT_FIELD_NAMES: readonly TextFieldName[] = ['name', 'email', 'password', 'confirm'];

export const isTextFieldName = (name: string): name is TextFieldName =>
  (TEXT_FIELD_NAMES as readonly string[]).includes(name);
