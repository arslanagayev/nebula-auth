import { requireElement } from './dom';

export type Panel = 'form' | 'success';

/** Shows either the form or the success panel of a card face. */
export function showPanel(face: HTMLElement, panel: Panel): void {
  requireElement(face, '[data-panel="form"]', HTMLElement).hidden = panel !== 'form';
  requireElement(face, '[data-panel="success"]', HTMLElement).hidden = panel !== 'success';
}

/**
 * Swaps a face to its success panel and moves focus to the heading, so screen readers
 * announce the outcome. `text` may mix strings and elements such as `<time>`.
 */
export function showSuccess(
  face: HTMLElement,
  title: string,
  text: readonly (string | Node)[],
): void {
  requireElement(face, '[data-success-text]', HTMLElement).replaceChildren(...text);
  const heading = requireElement(face, '[data-success-title]', HTMLElement);
  heading.textContent = title;
  showPanel(face, 'success');
  heading.focus();
}

/** A `<time>` element with a machine-readable timestamp that never wraps mid-date. */
export function timeElement(epochMs: number): HTMLTimeElement {
  const time = document.createElement('time');
  time.dateTime = new Date(epochMs).toISOString();
  time.textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(epochMs);
  return time;
}

export const firstName = (name: string): string => name.trim().split(/\s+/u)[0] ?? name;
