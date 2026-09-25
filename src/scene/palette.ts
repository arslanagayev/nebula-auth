import type { StrengthScore } from '../core/types';
import type { CoreTone } from '../lib/sceneMotion';

/**
 * Scene colours. Each one is also a token in `styles/tokens.css`, so the WebGL layer and
 * the UI share one palette; `tests/palette.test.ts` fails if the two drift apart.
 */
export const PALETTE = {
  space: '#05060f', // --color-space
  violet: '#7b5cff', // --color-violet
  cyan: '#00e5ff', // --color-cyan
  pink: '#ff5ecb', // --color-pink
  danger: '#ff4d6d', // --color-red
  success: '#2ef2c4', // --color-success
} as const;

/** Colours that exist only in the scene: the galaxy's warm core. */
export const GALAXY_CORE = {
  inner: '#ffc98a',
  hot: '#fff1dc',
} as const;

/** Password strength scale: red → amber → green → cyan (the `--strength-*` tokens). */
export const STRENGTH_COLORS: Readonly<Record<StrengthScore, string>> = {
  0: '#ff4d6d',
  1: '#ff7a45',
  2: '#ffb020',
  3: '#34d399',
  4: '#00e5ff',
};

export const coreColor = (tone: CoreTone): string => {
  if (tone === 'idle') return PALETTE.violet;
  if (tone === 'success') return PALETTE.success;
  return STRENGTH_COLORS[tone];
};
