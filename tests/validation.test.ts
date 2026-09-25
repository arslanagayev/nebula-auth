import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  normalizeName,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  validateRegistration,
  validateSignInPassword,
  validateTermsAccepted,
} from '../src/lib/validation';

describe('validateEmail', () => {
  it.each([
    'demo@nebula.dev',
    'first.last@example.co.uk',
    'user+tag@sub.domain.io',
    "o'neil@example.com",
    '  padded@example.com  ',
    'x@xn--bcher-kva.example',
    'user@example.xn--p1ai',
  ])('accepts %s', (email) => {
    expect(validateEmail(email)).toBeNull();
  });

  it('asks for an email when empty or whitespace', () => {
    expect(validateEmail('')).toBe('Enter your email address.');
    expect(validateEmail('   ')).toBe('Enter your email address.');
  });

  it.each([
    'plainaddress',
    '@example.com',
    'user@',
    'user@example',
    'user@example.c',
    'user@@example.com',
    '.user@example.com',
    'user.@example.com',
    'us..er@example.com',
    'user@-example.com',
    'user@example-.com',
    'user@exa_mple.com',
    'user@example..com',
    'us er@example.com',
    'user@example.123',
  ])('rejects %s', (email) => {
    expect(validateEmail(email)).toMatch(/valid email/);
  });

  it('enforces the RFC length limits', () => {
    const longLocal = `${'a'.repeat(65)}@example.com`;
    const longTotal = `${'a'.repeat(60)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`;
    expect(validateEmail(longLocal)).toMatch(/valid email/);
    expect(validateEmail(longTotal)).toBe('This email address is too long.');
  });
});

describe('normalizers', () => {
  it('trims and lower-cases emails', () => {
    expect(normalizeEmail('  Demo@Nebula.DEV ')).toBe('demo@nebula.dev');
  });

  it('trims names and collapses inner whitespace', () => {
    expect(normalizeName('  Ada    Lovelace ')).toBe('Ada Lovelace');
  });
});

describe('validateName', () => {
  it.each([
    'Ada Lovelace',
    'Zoë O’Neil',
    "D'Angelo",
    'Jean-Luc Picard',
    'J. R. R. Tolkien',
    'Ли Мин',
  ])('accepts %s', (name) => {
    expect(validateName(name)).toBeNull();
  });

  it('requires a name', () => {
    expect(validateName('  ')).toBe('Enter your name.');
  });

  it('enforces length limits', () => {
    expect(validateName('A')).toBe('Use at least 2 characters.');
    expect(validateName('A'.repeat(61))).toBe('Use 60 characters or fewer.');
  });

  it.each(['R2-D2', '<script>', '-Ada', 'Ada_Lovelace'])('rejects %s', (name) => {
    expect(validateName(name)).toBe('Use letters, spaces, hyphens or apostrophes only.');
  });
});

describe('validateSignInPassword', () => {
  it('only checks presence', () => {
    expect(validateSignInPassword('')).toBe('Enter your password.');
    expect(validateSignInPassword('x')).toBeNull();
  });
});

describe('validateNewPassword', () => {
  it('requires a password that is not only whitespace', () => {
    expect(validateNewPassword('')).toBe('Create a password.');
    expect(validateNewPassword('          ')).toBe('Your password can’t be only spaces.');
  });

  it('enforces the length limits', () => {
    expect(validateNewPassword('Ab1#xyz')).toBe('Use at least 8 characters.');
    expect(validateNewPassword(`Aa1#${'x9Q!'.repeat(32)}`)).toBe('Use 128 characters or fewer.');
  });

  it('rejects passwords below the minimum strength and explains why', () => {
    expect(validateNewPassword('password')).toBe(
      'Too easy to guess. This is one of the most commonly used passwords.',
    );
    expect(validateNewPassword('abcdefghij')).toMatch(/^Too easy to guess\. /);
  });

  it('takes the user’s personal details into account', () => {
    const context = { name: 'Arslan Agayev', email: 'arslan@example.com' };
    expect(validateNewPassword('arslan2026', context)).toMatch(/^Too easy to guess/);
  });

  it('accepts reasonably strong passwords', () => {
    expect(validateNewPassword('Nebula#2026')).toBeNull();
    expect(validateNewPassword('correct horse battery staple')).toBeNull();
  });
});

describe('validatePasswordConfirmation', () => {
  it('requires a matching confirmation', () => {
    expect(validatePasswordConfirmation('Nebula#2026', '')).toBe('Confirm your password.');
    expect(validatePasswordConfirmation('Nebula#2026', 'nebula#2026')).toBe(
      'Passwords don’t match.',
    );
    expect(validatePasswordConfirmation('Nebula#2026', 'Nebula#2026')).toBeNull();
  });
});

describe('validateTermsAccepted', () => {
  it('requires the checkbox to be ticked', () => {
    expect(validateTermsAccepted(false)).toBe('Please accept the terms to continue.');
    expect(validateTermsAccepted(true)).toBeNull();
  });
});

describe('validateRegistration', () => {
  it('returns no errors for a valid payload', () => {
    expect(
      validateRegistration({ name: 'Ada', email: 'ada@example.com', password: 'Nebula#2026' }),
    ).toEqual({});
  });

  it('collects every field error', () => {
    const errors = validateRegistration({ name: '', email: 'nope', password: 'short' });
    expect(Object.keys(errors).sort()).toEqual(['email', 'name', 'password']);
  });
});
