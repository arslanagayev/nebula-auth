import type { StrengthScore } from '../core/types';
import { evaluatePasswordStrength } from '../lib/passwordStrength';
import { requireElement } from './dom';

export interface StrengthMeter {
  /** Scores `password` and renders the result; returns `null` for an empty password. */
  update(password: string, personal: readonly string[]): StrengthScore | null;
}

/**
 * The 4-segment strength meter under the new-password field.
 *
 * It is always rendered, so the layout does not jump on the first keystroke. While the field
 * is empty it states the requirements up front (WCAG 3.3.2); once the user types, the same
 * line shows the rating and the most useful hint. The text is the field's description
 * (`aria-describedby`), so it never contains a stale rating or a dangling "strength:" label.
 */
export function createStrengthMeter(root: ParentNode): StrengthMeter {
  const meter = requireElement(root, '[data-strength]', HTMLElement);
  const prefix = requireElement(meter, '[data-strength-prefix]', HTMLElement);
  const label = requireElement(meter, '[data-strength-label]', HTMLElement);
  const hint = requireElement(meter, '[data-strength-hint]', HTMLElement);
  const requirements = hint.textContent.trim();

  return {
    update(password, personal) {
      if (password === '') {
        meter.dataset.score = '';
        prefix.hidden = true;
        label.textContent = '';
        hint.textContent = requirements;
        return null;
      }

      const strength = evaluatePasswordStrength(password, personal);
      meter.dataset.score = String(strength.score);
      prefix.hidden = false;
      label.textContent = strength.label;
      hint.textContent = strength.hints[0] ?? 'Great password.';
      return strength.score;
    },
  };
}
