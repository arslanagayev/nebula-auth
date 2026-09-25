import type { AuthErrorCode } from '../core/types';
import { err, ok, type Result } from './result';
import {
  normalizeEmail,
  normalizeName,
  validateRegistration,
  type RegistrationErrors,
  type RegistrationInput,
} from './validation';

export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface Session {
  readonly user: User;
  readonly token: string;
  /** Unix epoch in milliseconds. */
  readonly expiresAt: number;
}

export interface SignInInput {
  readonly email: string;
  readonly password: string;
  /** Keep the session for 30 days instead of 12 hours. */
  readonly remember?: boolean;
}

export type { AuthErrorCode } from '../core/types';

export interface AuthError {
  readonly code: AuthErrorCode;
  readonly message: string;
  /** Present for `rate-limited`: milliseconds until the account accepts attempts again. */
  readonly retryAfterMs?: number;
  /** Present for `invalid-input`: per-field messages. */
  readonly fields?: RegistrationErrors;
}

export type AuthResult = Result<Session, AuthError>;

export interface AuthService {
  signIn(input: SignInInput): Promise<AuthResult>;
  register(input: RegistrationInput): Promise<AuthResult>;
  /** Milliseconds until `email` may try to sign in again, or 0 when it is not locked. */
  lockoutRemaining(email: string): number;
}

export interface AuthServiceOptions {
  /** Simulated network latency range in milliseconds. */
  readonly latencyMs?: readonly [min: number, max: number];
  /** Failed sign-in attempts allowed before the account is temporarily locked. */
  readonly maxFailedAttempts?: number;
  readonly lockoutMs?: number;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly createToken?: () => string;
}

export const DEMO_ACCOUNT = {
  name: 'Demo',
  email: 'demo@nebula.dev',
  password: 'Nebula#2026',
} as const;

const HOUR = 60 * 60 * 1000;
const SESSION_TTL = 12 * HOUR;
const REMEMBERED_SESSION_TTL = 30 * 24 * HOUR;

export const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
export const DEFAULT_LOCKOUT_MS = 30_000;
const DEFAULT_LATENCY: readonly [number, number] = [650, 1200];

interface Account {
  readonly user: User;
  /**
   * Plain text is acceptable only because this "database" is an in-memory map that lives
   * and dies with the tab. A real backend stores a slow, salted hash (Argon2id or bcrypt).
   */
  readonly password: string;
}

interface AttemptRecord {
  failures: number;
  lockedUntil: number;
}

/** 128 random bits as hex. `getRandomValues` also works outside secure contexts. */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const seconds = (ms: number): number => Math.ceil(ms / 1000);

/**
 * A mock authentication API with realistic behaviour: latency, a seeded demo account,
 * registration, typed errors and per-account rate limiting. Swapping it for a real client
 * only requires implementing {@link AuthService}.
 */
export function createAuthService(options: AuthServiceOptions = {}): AuthService {
  const {
    latencyMs = DEFAULT_LATENCY,
    maxFailedAttempts = DEFAULT_MAX_FAILED_ATTEMPTS,
    lockoutMs = DEFAULT_LOCKOUT_MS,
    now = Date.now,
    random = Math.random,
    createToken = randomToken,
  } = options;

  const accounts = new Map<string, Account>();
  // Keyed by email rather than by account so unknown emails behave exactly like known ones,
  // which prevents account enumeration through the lockout behaviour.
  const attempts = new Map<string, AttemptRecord>();

  accounts.set(DEMO_ACCOUNT.email, {
    user: { id: 'usr_demo', name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email },
    password: DEMO_ACCOUNT.password,
  });

  const simulateLatency = (): Promise<void> => {
    const [min, max] = latencyMs;
    const delay = min + (max - min) * random();
    return new Promise((resolve) => setTimeout(resolve, delay));
  };

  const createSession = (user: User, remember: boolean): Session => ({
    user,
    token: createToken(),
    expiresAt: now() + (remember ? REMEMBERED_SESSION_TTL : SESSION_TTL),
  });

  const lockoutRemaining = (email: string): number => {
    const key = normalizeEmail(email);
    const record = attempts.get(key);
    if (!record || record.lockedUntil === 0) return 0;
    const remaining = record.lockedUntil - now();
    if (remaining > 0) return remaining;
    // The lockout has expired: start counting failures from scratch.
    attempts.delete(key);
    return 0;
  };

  const rateLimited = (retryAfterMs: number): AuthError => ({
    code: 'rate-limited',
    message: `Too many failed attempts. Try again in ${seconds(retryAfterMs)} seconds.`,
    retryAfterMs,
  });

  const recordFailure = (key: string): AuthError => {
    const record = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
    record.failures += 1;
    attempts.set(key, record);

    if (record.failures >= maxFailedAttempts) {
      record.lockedUntil = now() + lockoutMs;
      return rateLimited(lockoutMs);
    }

    const left = maxFailedAttempts - record.failures;
    const warning = left <= 2 ? ` ${left} ${left === 1 ? 'attempt' : 'attempts'} left.` : '';
    return { code: 'invalid-credentials', message: `Incorrect email or password.${warning}` };
  };

  return {
    lockoutRemaining,

    async signIn({ email, password, remember = false }) {
      await simulateLatency();
      const key = normalizeEmail(email);

      const remaining = lockoutRemaining(key);
      if (remaining > 0) return err(rateLimited(remaining));

      const account = accounts.get(key);
      if (account?.password !== password) return err(recordFailure(key));

      attempts.delete(key);
      return ok(createSession(account.user, remember));
    },

    async register(input) {
      await simulateLatency();

      const fields = validateRegistration(input);
      if (Object.keys(fields).length > 0) {
        return err({
          code: 'invalid-input',
          message: 'Please correct the highlighted fields.',
          fields,
        });
      }

      const email = normalizeEmail(input.email);
      if (accounts.has(email)) {
        return err({
          code: 'email-taken',
          message: 'An account with this email already exists.',
          fields: { email: 'This email is already registered. Try signing in instead.' },
        });
      }

      const user: User = {
        id: `usr_${createToken().slice(0, 12)}`,
        name: normalizeName(input.name),
        email,
      };
      accounts.set(email, { user, password: input.password });
      return ok(createSession(user, false));
    },
  };
}
