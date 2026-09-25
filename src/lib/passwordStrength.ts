import { COMMON_PASSWORDS } from './commonPasswords';

export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'] as const;

export type StrengthLabel = (typeof STRENGTH_LABELS)[StrengthScore];

export interface PasswordStrength {
  readonly score: StrengthScore;
  readonly label: StrengthLabel;
  /** Actionable suggestions, most important first. */
  readonly hints: readonly string[];
  /** Rough entropy estimate after penalties, in bits. */
  readonly entropyBits: number;
}

export const HINTS = {
  common: 'This is one of the most commonly used passwords.',
  variation: 'Avoid predictable variations of common passwords.',
  personal: 'Avoid using your name or email address.',
  tooShort: 'Use at least 8 characters.',
  short: 'Use 12 or more characters.',
  repeats: 'Avoid repeated characters or patterns.',
  sequences: 'Avoid sequences like "abc", "123" or "qwerty".',
  years: 'Avoid years and dates.',
  lowercase: 'Add a lowercase letter.',
  uppercase: 'Add an uppercase letter.',
  digit: 'Add a number.',
  symbol: 'Add a symbol such as # or !',
} as const;

const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'] as const;

const LEET: Readonly<Record<string, string>> = {
  '@': 'a',
  '4': 'a',
  '3': 'e',
  '1': 'i',
  '!': 'i',
  '0': 'o',
  $: 's',
  '5': 's',
  '7': 't',
};

/**
 * Entropy thresholds (bits) for scores 1–4. They are deliberately conservative because the
 * estimate below only models brute force plus a handful of well-known human patterns.
 */
const SCORE_THRESHOLDS = [28, 40, 56, 72] as const;

const YEAR_PATTERN = /(?:19|20)\d{2}/g;

/** Weight of a character that continues a pattern; a fully random character weighs 1. */
const WEIGHT_REPEAT_FIRST = 0.5;
const WEIGHT_REPEAT_RUN = 0.2;
const WEIGHT_SEQUENCE = 0.25;

interface CharClasses {
  readonly lower: boolean;
  readonly upper: boolean;
  readonly digit: boolean;
  readonly symbol: boolean;
  readonly nonAscii: boolean;
}

function classify(password: string): CharClasses {
  return {
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^a-zA-Z\d]/.test(password),
    nonAscii: /[^ -~]/.test(password),
  };
}

/** Size of the alphabet an attacker has to brute force for these character classes. */
function poolSize(classes: CharClasses): number {
  let pool = 0;
  if (classes.lower) pool += 26;
  if (classes.upper) pool += 26;
  if (classes.digit) pool += 10;
  if (classes.symbol) pool += 33;
  // Accents, other scripts and emoji widen the search space considerably.
  if (classes.nonAscii) pool += 100;
  return pool;
}

function keyboardIndex(char: string): readonly [row: number, column: number] | null {
  for (const [row, keys] of KEYBOARD_ROWS.entries()) {
    const column = keys.indexOf(char);
    if (column !== -1) return [row, column];
  }
  return null;
}

/** True for "abc", "cba", "123", "qwe", "lkj" and similar runs of three. */
function isSequence(a: string, b: string, c: string): boolean {
  const [x, y, z] = [a, b, c].map((char) => char.toLowerCase().codePointAt(0) ?? 0) as [
    number,
    number,
    number,
  ];
  if (y - x === z - y && Math.abs(y - x) === 1) return true;

  const [ka, kb, kc] = [a, b, c].map((char) => keyboardIndex(char.toLowerCase()));
  if (!ka || !kb || !kc) return false;
  if (ka[0] !== kb[0] || kb[0] !== kc[0]) return false;
  const step = kb[1] - ka[1];
  return Math.abs(step) === 1 && kc[1] - kb[1] === step;
}

interface PatternAnalysis {
  readonly effectiveLength: number;
  readonly repeats: boolean;
  readonly sequences: boolean;
}

/**
 * Walks the password once and weighs every character by how guessable it is in context:
 * characters that repeat the previous one or continue a sequence add very little entropy.
 */
function analysePatterns(chars: readonly string[]): PatternAnalysis {
  let effectiveLength = 0;
  let runLength = 1;
  let repeats = false;
  let sequences = false;

  for (const [index, char] of chars.entries()) {
    const previous = chars[index - 1];
    const beforePrevious = chars[index - 2];

    if (char === previous) {
      runLength += 1;
      if (runLength >= 3) repeats = true;
      effectiveLength += runLength === 2 ? WEIGHT_REPEAT_FIRST : WEIGHT_REPEAT_RUN;
      continue;
    }
    runLength = 1;

    if (
      previous !== undefined &&
      beforePrevious !== undefined &&
      isSequence(beforePrevious, previous, char)
    ) {
      sequences = true;
      effectiveLength += WEIGHT_SEQUENCE;
      continue;
    }
    effectiveLength += 1;
  }

  // Whole-password repetition such as "abcabc" or "nebulanebula".
  const unit = /^(.+?)\1+$/su.exec(chars.join(''))?.[1];
  if (unit !== undefined && unit.length < chars.length) {
    const unitAnalysis = analysePatterns(Array.from(unit));
    return {
      effectiveLength: Math.min(effectiveLength, unitAnalysis.effectiveLength + 1),
      repeats: true,
      sequences: sequences || unitAnalysis.sequences,
    };
  }

  return { effectiveLength, repeats, sequences };
}

function deLeet(value: string): string {
  return Array.from(value, (char) => LEET[char] ?? char).join('');
}

/**
 * Lower-cased tokens from the user's own details that should not appear in the password.
 * Only the local part of an email address is used: domains like "gmail" are not personal.
 */
function personalTokens(userInputs: readonly string[]): Set<string> {
  const tokens = userInputs.flatMap((input) => {
    const value = input.toLowerCase();
    const at = value.indexOf('@');
    return (at === -1 ? value : value.slice(0, at)).split(/[\s._+-]+/u);
  });
  return new Set(tokens.filter((token) => token.length >= 3));
}

const clampScore = (value: number): StrengthScore =>
  Math.max(0, Math.min(4, Math.floor(value))) as StrengthScore;

/**
 * Estimates password strength on a 0–4 scale.
 *
 * The model is intentionally small (no multi-megabyte dictionaries): brute-force entropy over
 * the character pool, discounted for repeats, sequences, years, personal details and
 * variations of the most common passwords. It is designed for real-time UI feedback;
 * a production backend should additionally check breached-password corpora.
 *
 * @param userInputs Personal details (name, email) the password should not contain.
 */
export function evaluatePasswordStrength(
  password: string,
  userInputs: readonly string[] = [],
): PasswordStrength {
  const chars = Array.from(password);
  const lower = password.toLowerCase();
  const classes = classify(password);
  const hints: string[] = [];
  let maxScore: StrengthScore = 4;

  if (COMMON_PASSWORDS.has(lower)) {
    return { score: 0, label: STRENGTH_LABELS[0], hints: [HINTS.common], entropyBits: 0 };
  }

  const withoutSuffix = lower.replace(/[\d\W_]+$/u, '');
  const isVariation = [deLeet(lower), deLeet(withoutSuffix)].some(
    (candidate) => candidate.length >= 4 && COMMON_PASSWORDS.has(candidate),
  );
  if (isVariation) {
    hints.push(HINTS.variation);
    maxScore = 1;
  }

  const patterns = analysePatterns(chars);
  let effectiveLength = patterns.effectiveLength;

  const personal = [...personalTokens(userInputs)].filter((token) => lower.includes(token));
  if (personal.length > 0) {
    hints.push(HINTS.personal);
    // Treat each personal token as a single guessable "character".
    for (const token of personal) effectiveLength -= token.length - 1;
  }

  if (chars.length < 8) {
    hints.push(HINTS.tooShort);
    maxScore = Math.min(maxScore, 1) as StrengthScore;
  } else if (chars.length < 12) {
    hints.push(HINTS.short);
    maxScore = Math.min(maxScore, 3) as StrengthScore;
  }

  if (patterns.repeats) hints.push(HINTS.repeats);
  if (patterns.sequences) hints.push(HINTS.sequences);

  const years = lower.match(YEAR_PATTERN) ?? [];
  if (years.length > 0) {
    hints.push(HINTS.years);
    // A year is one of ~150 plausible values (≈7 bits), not four random digits.
    effectiveLength -= years.length * 2;
  }

  const classCount = [classes.lower, classes.upper, classes.digit, classes.symbol].filter(
    Boolean,
  ).length;
  if (classCount === 1 && chars.length < 16) {
    maxScore = Math.min(maxScore, 2) as StrengthScore;
  }

  const entropyBits = Math.max(0, effectiveLength) * Math.log2(Math.max(poolSize(classes), 1));
  const rawScore = SCORE_THRESHOLDS.filter((threshold) => entropyBits >= threshold).length;
  const score = clampScore(Math.min(rawScore, maxScore));

  if (score < 4) {
    if (!classes.lower && classes.upper) hints.push(HINTS.lowercase);
    if (!classes.upper) hints.push(HINTS.uppercase);
    if (!classes.digit) hints.push(HINTS.digit);
    if (!classes.symbol) hints.push(HINTS.symbol);
  }

  return {
    score,
    label: STRENGTH_LABELS[score],
    hints,
    entropyBits: Math.round(entropyBits * 10) / 10,
  };
}
