import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthService,
  DEFAULT_LOCKOUT_MS,
  DEMO_ACCOUNT,
  RATE_LIMITED_MESSAGE,
  type AuthResult,
  type AuthServiceOptions,
} from '../src/lib/authService';

const LATENCY = 800;

/** A service with fixed latency and deterministic time so assertions are exact. */
function setup(options: AuthServiceOptions = {}) {
  return createAuthService({
    latencyMs: [LATENCY, LATENCY],
    now: () => Date.now(),
    createToken: () => 'token-0123456789abcdef',
    ...options,
  });
}

/** Starts a request and advances fake time past the simulated latency. */
async function settle(request: Promise<AuthResult>): Promise<AuthResult> {
  await vi.advanceTimersByTimeAsync(LATENCY);
  return request;
}

const wrongPassword = { email: DEMO_ACCOUNT.email, password: 'not-the-password' };

describe('createAuthService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('signIn', () => {
    it('signs in the demo account after the simulated latency', async () => {
      const auth = setup();
      const start = Date.now();
      let settled = false;
      const request = auth.signIn(DEMO_ACCOUNT).then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(LATENCY - 1);
      expect(settled).toBe(false);

      const result = await settle(request);
      expect(result).toEqual({
        ok: true,
        value: {
          user: { id: 'usr_demo', name: 'Demo', email: 'demo@nebula.dev' },
          token: 'token-0123456789abcdef',
          expiresAt: start + LATENCY + 12 * 60 * 60 * 1000,
        },
      });
    });

    it('normalises the email and extends remembered sessions to 30 days', async () => {
      const auth = setup();
      const result = await settle(
        auth.signIn({
          email: '  DEMO@nebula.dev ',
          password: DEMO_ACCOUNT.password,
          remember: true,
        }),
      );
      expect(result.ok && result.value.expiresAt).toBe(Date.now() + 30 * 24 * 60 * 60 * 1000);
    });

    it('uses randomised latency within the configured range', async () => {
      const auth = createAuthService({ latencyMs: [500, 1500], random: () => 0.5 });
      let settled = false;
      void auth.signIn(DEMO_ACCOUNT).then(() => (settled = true));

      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    });

    it('rejects a wrong password with a generic message', async () => {
      const result = await settle(setup().signIn(wrongPassword));
      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid-credentials', message: 'Incorrect email or password.' },
      });
    });

    it('rejects unknown accounts with the same message as a wrong password', async () => {
      const auth = setup();
      const unknown = await settle(auth.signIn({ email: 'ghost@nebula.dev', password: 'x' }));
      const wrong = await settle(auth.signIn(wrongPassword));
      expect(unknown).toEqual(wrong);
    });

    it('warns when only a couple of attempts are left', async () => {
      const auth = setup();
      const messages: string[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const result = await settle(auth.signIn(wrongPassword));
        if (!result.ok) messages.push(result.error.message);
      }
      expect(messages).toEqual([
        'Incorrect email or password.',
        'Incorrect email or password.',
        'Incorrect email or password. 2 attempts left.',
        'Incorrect email or password. 1 attempt left.',
      ]);
    });

    it('locks the account for 30 seconds after 5 failed attempts', async () => {
      const auth = setup();
      for (let attempt = 0; attempt < 4; attempt += 1) await settle(auth.signIn(wrongPassword));

      const fifth = await settle(auth.signIn(wrongPassword));
      expect(fifth).toEqual({
        ok: false,
        error: {
          code: 'rate-limited',
          message: RATE_LIMITED_MESSAGE,
          retryAfterMs: DEFAULT_LOCKOUT_MS,
        },
      });

      // Even the correct password is refused while locked.
      const locked = await settle(auth.signIn(DEMO_ACCOUNT));
      expect(locked.ok).toBe(false);
      expect(!locked.ok && locked.error.code).toBe('rate-limited');
      expect(!locked.ok && locked.error.retryAfterMs).toBe(DEFAULT_LOCKOUT_MS - LATENCY);
      expect(auth.lockoutRemaining(DEMO_ACCOUNT.email)).toBe(DEFAULT_LOCKOUT_MS - LATENCY);
    });

    it('unlocks after the lockout and resets the failure counter', async () => {
      const auth = setup();
      for (let attempt = 0; attempt < 5; attempt += 1) await settle(auth.signIn(wrongPassword));
      expect(auth.lockoutRemaining(DEMO_ACCOUNT.email)).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(DEFAULT_LOCKOUT_MS);
      expect(auth.lockoutRemaining('Demo@Nebula.dev')).toBe(0);

      const retry = await settle(auth.signIn(wrongPassword));
      expect(!retry.ok && retry.error.message).toBe('Incorrect email or password.');

      const success = await settle(auth.signIn(DEMO_ACCOUNT));
      expect(success.ok).toBe(true);
    });

    it('clears previous failures after a successful sign-in', async () => {
      const auth = setup();
      for (let attempt = 0; attempt < 4; attempt += 1) await settle(auth.signIn(wrongPassword));
      await settle(auth.signIn(DEMO_ACCOUNT));

      const next = await settle(auth.signIn(wrongPassword));
      expect(!next.ok && next.error.code).toBe('invalid-credentials');
      expect(!next.ok && next.error.message).toBe('Incorrect email or password.');
    });

    it('tracks lockouts per email address', async () => {
      const auth = setup({ maxFailedAttempts: 2, lockoutMs: 5_000 });
      await settle(auth.signIn(wrongPassword));
      await settle(auth.signIn(wrongPassword));

      expect(auth.lockoutRemaining(DEMO_ACCOUNT.email)).toBe(5_000);
      expect(auth.lockoutRemaining('someone@else.dev')).toBe(0);
    });

    it('generates random hex tokens by default', async () => {
      const auth = createAuthService({ latencyMs: [0, 0] });
      const request = auth.signIn(DEMO_ACCOUNT);
      await vi.advanceTimersByTimeAsync(0);
      const result = await request;
      expect(result.ok && result.value.token).toMatch(/^[\da-f]{32}$/);
    });
  });

  describe('register', () => {
    const newUser = {
      name: '  Ada   Lovelace ',
      email: 'Ada@Example.com',
      password: 'Analytical#Engine1843',
    };

    it('creates an account that can sign in afterwards', async () => {
      const auth = setup();
      const start = Date.now();
      const registered = await settle(auth.register(newUser));
      expect(registered).toEqual({
        ok: true,
        value: {
          user: { id: 'usr_token-012345', name: 'Ada Lovelace', email: 'ada@example.com' },
          token: 'token-0123456789abcdef',
          expiresAt: start + LATENCY + 12 * 60 * 60 * 1000,
        },
      });

      const signedIn = await settle(
        auth.signIn({ email: 'ada@example.com', password: newUser.password }),
      );
      expect(signedIn.ok && signedIn.value.user.name).toBe('Ada Lovelace');
    });

    it('refuses an email that is already registered', async () => {
      const result = await settle(setup().register({ ...newUser, email: 'DEMO@nebula.dev' }));
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'email-taken',
          message: 'An account with this email already exists.',
          fields: { email: 'This email is already registered. Try signing in instead.' },
        },
      });
    });

    it('validates the payload on the "server" as well', async () => {
      const result = await settle(setup().register({ name: 'A', email: 'bad', password: 'weak' }));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe('invalid-input');
      expect(!result.ok && result.error.message).toBe('Please fix the fields marked below.');
      expect(!result.ok && Object.keys(result.error.fields ?? {}).sort()).toEqual([
        'email',
        'name',
        'password',
      ]);
    });
  });
});
