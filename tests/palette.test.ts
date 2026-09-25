import { describe, expect, it } from 'vitest';
import { coreColor, PALETTE, STRENGTH_COLORS } from '../src/scene/palette';
import tokens from '../src/styles/tokens.css?raw';

/** Every `--name: #hex;` declaration in tokens.css. */
const TOKENS = new Map(
  [...tokens.matchAll(/(--[\w-]+):\s*(#[\da-f]{3,8})\s*;/giu)].map(([, name = '', value = '']) => [
    name,
    value.toLowerCase(),
  ]),
);

describe('scene palette', () => {
  it('uses only colours that are also CSS design tokens', () => {
    const values = new Set(TOKENS.values());
    const missing = Object.entries(PALETTE).filter(([, hex]) => !values.has(hex));
    expect(missing).toEqual([]);
  });

  it('matches the strength scale of the meter', () => {
    for (const [score, hex] of Object.entries(STRENGTH_COLORS)) {
      expect(TOKENS.get(`--strength-${score}`)).toBe(hex);
    }
  });

  it('maps every core tone to a colour', () => {
    expect(coreColor('idle')).toBe(PALETTE.violet);
    expect(coreColor('success')).toBe(PALETTE.success);
    expect(coreColor(3)).toBe(STRENGTH_COLORS[3]);
  });
});
