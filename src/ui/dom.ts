/** Small DOM helpers shared by the UI modules. */

/** A media query result, or anything shaped like one (tests pass plain objects). */
export interface MediaPreference {
  readonly matches: boolean;
}

/** A media preference that also reports changes, like `MediaQueryList`. */
export interface LivePreference extends MediaPreference {
  addEventListener(type: 'change', listener: () => void, options?: AddEventListenerOptions): void;
}

/** A preference that never matches, for optional features such as coarse-pointer tweaks. */
export const NEVER: MediaPreference = { matches: false };

/**
 * `querySelector` that fails loudly: the markup is part of the program, so a missing
 * element is a bug to report at start-up rather than a `null` to check on every use.
 */
export function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
  type: new () => T,
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Nebula: missing element ${selector}`);
  return element;
}

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
