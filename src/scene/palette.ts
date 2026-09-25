import type { StrengthScore } from '../lib/passwordStrength';

/** Scene colours. They mirror the CSS tokens in `styles/tokens.css`. */
export const PALETTE = {
  space: '#05060f',
  core: '#ffc98a',
  coreHot: '#fff1dc',
  violet: '#7b5cff',
  cyan: '#00e5ff',
  pink: '#ff5ecb',
  danger: '#ff3b5c',
  success: '#2ef2c4',
} as const;

/** Password strength scale: red → amber → green → cyan (matches `--strength-*`). */
export const STRENGTH_COLORS: Readonly<Record<StrengthScore, string>> = {
  0: '#ff4d6d',
  1: '#ff7a45',
  2: '#ffb020',
  3: '#34d399',
  4: '#00e5ff',
};

export const IDLE_CORE_COLOR = PALETTE.violet;
