import { describe, expect, it } from 'vitest';
import { evaluatePasswordStrength, HINTS, STRENGTH_LABELS } from '../src/lib/passwordStrength';

describe('evaluatePasswordStrength', () => {
  it('rates an empty password as very weak and asks for more characters', () => {
    const result = evaluatePasswordStrength('');
    expect(result.score).toBe(0);
    expect(result.label).toBe('Very weak');
    expect(result.hints[0]).toBe(HINTS.tooShort);
    expect(result.entropyBits).toBe(0);
  });

  it.each(['password', 'Password', 'QWERTY', '123456789', 'iloveyou', 'trustno1'])(
    'rejects the common password %s outright',
    (password) => {
      const result = evaluatePasswordStrength(password);
      expect(result.score).toBe(0);
      expect(result.hints).toEqual([HINTS.common]);
    },
  );

  it.each(['P@ssw0rd', 'p4ssw0rd', 'Summer2026!', 'Dragon#99', 'Football_1'])(
    'caps predictable variations of common passwords (%s) at weak',
    (password) => {
      const result = evaluatePasswordStrength(password);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.hints).toContain(HINTS.variation);
    },
  );

  it('penalises repeated characters', () => {
    const repeated = evaluatePasswordStrength('aaaaaaaaaaaa');
    expect(repeated.score).toBe(0);
    expect(repeated.hints).toContain(HINTS.repeats);
  });

  it('penalises whole-password repetition', () => {
    const once = evaluatePasswordStrength('K7#vQ9');
    const twice = evaluatePasswordStrength('K7#vQ9K7#vQ9');
    expect(twice.hints).toContain(HINTS.repeats);
    expect(twice.entropyBits).toBeLessThan(once.entropyBits * 1.5);
  });

  it.each(['abcdefghij', 'zyxwvutsrq', '0123456789', 'qwertyuiop[', 'asdfghjkl;'])(
    'penalises sequences such as %s',
    (password) => {
      const result = evaluatePasswordStrength(password);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.hints).toContain(HINTS.sequences);
    },
  );

  it('does not treat keys from different keyboard rows as a sequence', () => {
    expect(evaluatePasswordStrength('qaz').hints).not.toContain(HINTS.sequences);
  });

  it('discounts years', () => {
    const withYear = evaluatePasswordStrength('Orbit#1999x');
    const withoutYear = evaluatePasswordStrength('Orbit#7394x');
    expect(withYear.hints).toContain(HINTS.years);
    expect(withYear.entropyBits).toBeLessThan(withoutYear.entropyBits);
  });

  it('penalises passwords that contain the user’s name or email', () => {
    const inputs = ['Arslan Agayev', 'arslan.agayev@example.com'];
    const personal = evaluatePasswordStrength('Agayev!Blue42', inputs);
    const neutral = evaluatePasswordStrength('Agayev!Blue42');
    expect(personal.hints).toContain(HINTS.personal);
    expect(personal.entropyBits).toBeLessThan(neutral.entropyBits);
  });

  it('ignores email domains and very short tokens when looking for personal details', () => {
    const result = evaluatePasswordStrength('Gmail-Rocket-72', ['Al', 'someone@gmail.com']);
    expect(result.hints).not.toContain(HINTS.personal);
  });

  it('caps short passwords even when they use every character class', () => {
    expect(evaluatePasswordStrength('aB3$').score).toBeLessThanOrEqual(1);
    expect(evaluatePasswordStrength('Xk9#mQ2!vL').score).toBeLessThanOrEqual(3);
  });

  it('caps single-class passwords below 16 characters at fair', () => {
    expect(evaluatePasswordStrength('monkeybanana').score).toBe(2);
  });

  it('rates the demo password as strong', () => {
    const result = evaluatePasswordStrength('Nebula#2026');
    expect(result.score).toBe(3);
    expect(result.label).toBe('Strong');
  });

  it('rates long, varied passphrases as excellent without further hints', () => {
    const result = evaluatePasswordStrength('correct horse battery staple');
    expect(result.score).toBe(4);
    expect(result.label).toBe('Excellent');
    expect(result.hints).toEqual([]);
  });

  it('rates random 16+ character passwords as excellent', () => {
    expect(evaluatePasswordStrength('t7$Kq!9vZ#m2Lp@x').score).toBe(4);
  });

  it('suggests the missing character classes', () => {
    const upperOnly = evaluatePasswordStrength('GALAXYORBIT');
    expect(upperOnly.hints).toEqual(
      expect.arrayContaining([HINTS.lowercase, HINTS.digit, HINTS.symbol]),
    );
    expect(upperOnly.hints).not.toContain(HINTS.uppercase);

    const lowerOnly = evaluatePasswordStrength('galaxyorbit');
    expect(lowerOnly.hints).toEqual(
      expect.arrayContaining([HINTS.uppercase, HINTS.digit, HINTS.symbol]),
    );
    expect(lowerOnly.hints).not.toContain(HINTS.lowercase);
  });

  it('gives non-ASCII characters a larger search space', () => {
    const ascii = evaluatePasswordStrength('stella-orbit');
    const unicode = evaluatePasswordStrength('stellä-orbít');
    expect(unicode.entropyBits).toBeGreaterThan(ascii.entropyBits);
  });

  it('never decreases when a random character is appended', () => {
    let password = 'N';
    let previous = evaluatePasswordStrength(password).score;
    for (const char of 'v7#Qx!2mK9$zLp') {
      password += char;
      const { score } = evaluatePasswordStrength(password);
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  it('always returns the label that matches the score', () => {
    for (const password of ['', 'abc', 'hello123', 'Kitten!9', 'Nebula#2026', 'Zz9!Zz9!Qq']) {
      const { score, label } = evaluatePasswordStrength(password);
      expect(label).toBe(STRENGTH_LABELS[score]);
    }
  });
});
