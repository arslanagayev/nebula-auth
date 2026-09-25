import { describe, expect, it } from 'vitest';
import { FrameBudget } from '../src/lib/frameBudget';
import {
  degradeQuality,
  detectTier,
  PARTICLE_COUNTS,
  resolveQuality,
  type DeviceSignals,
} from '../src/lib/quality';
import { mulberry32 } from '../src/lib/random';

const desktop: DeviceSignals = {
  viewportWidth: 1440,
  devicePixelRatio: 2,
  coarsePointer: false,
  hardwareConcurrency: 10,
  deviceMemory: 16,
  reducedMotion: false,
};

const phone: DeviceSignals = {
  viewportWidth: 390,
  devicePixelRatio: 3,
  coarsePointer: true,
  hardwareConcurrency: 6,
  deviceMemory: undefined,
  reducedMotion: false,
};

describe('detectTier', () => {
  it('classifies capable desktops as high', () => {
    expect(detectTier(desktop)).toBe('high');
  });

  it('classifies phones and small viewports as medium', () => {
    expect(detectTier(phone)).toBe('medium');
    expect(detectTier({ ...desktop, viewportWidth: 700 })).toBe('medium');
  });

  it('classifies modest desktops as medium', () => {
    expect(detectTier({ ...desktop, hardwareConcurrency: 4 })).toBe('medium');
    expect(detectTier({ ...desktop, deviceMemory: 4 })).toBe('medium');
  });

  it('classifies weak devices and data saver users as low', () => {
    expect(detectTier({ ...phone, hardwareConcurrency: 2 })).toBe('low');
    expect(detectTier({ ...desktop, deviceMemory: 2 })).toBe('low');
    expect(detectTier({ ...desktop, saveData: true })).toBe('low');
  });

  it('assumes an average device when capabilities are unknown', () => {
    expect(
      detectTier({ ...desktop, hardwareConcurrency: undefined, deviceMemory: undefined }),
    ).toBe('medium');
  });
});

describe('resolveQuality', () => {
  it('uses the full budget on high-end desktops', () => {
    expect(resolveQuality(desktop)).toEqual({
      tier: 'high',
      particleCount: PARTICLE_COUNTS.high,
      pixelRatio: 2,
      bloom: true,
      antialias: false,
    });
  });

  it('caps the pixel ratio at 1.5 on mobile and skips bloom', () => {
    expect(resolveQuality(phone)).toMatchObject({ pixelRatio: 1.5, bloom: false, tier: 'medium' });
  });

  it('renders low-end devices at 1x without antialiasing', () => {
    expect(resolveQuality({ ...phone, hardwareConcurrency: 2 })).toMatchObject({
      tier: 'low',
      particleCount: PARTICLE_COUNTS.low,
      pixelRatio: 1,
      antialias: false,
    });
  });

  it('enables MSAA on standard density screens', () => {
    expect(resolveQuality({ ...desktop, devicePixelRatio: 1 })).toMatchObject({
      pixelRatio: 1,
      antialias: true,
    });
  });

  it('disables bloom for users who prefer reduced motion', () => {
    expect(resolveQuality({ ...desktop, reducedMotion: true }).bloom).toBe(false);
  });

  it('never renders below 1x', () => {
    expect(resolveQuality({ ...desktop, devicePixelRatio: 0.5 }).pixelRatio).toBe(1);
  });
});

describe('degradeQuality', () => {
  it('drops bloom first, then resolution in half steps, then gives up', () => {
    const steps = [];
    let profile = resolveQuality(desktop);
    for (let next = degradeQuality(profile); next; next = degradeQuality(profile)) {
      steps.push({ bloom: next.bloom, pixelRatio: next.pixelRatio });
      profile = next;
    }
    expect(steps).toEqual([
      { bloom: false, pixelRatio: 2 },
      { bloom: false, pixelRatio: 1.5 },
      { bloom: false, pixelRatio: 1 },
    ]);
  });
});

describe('FrameBudget', () => {
  it('stays quiet until a full window has been sampled', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 3 });
    expect(budget.sample(40)).toBe(false);
    expect(budget.sample(40)).toBe(false);
    expect(budget.sample(40)).toBe(true);
  });

  it('does not report windows that average within budget', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 4 });
    const verdicts = [10, 30, 16, 18].map((ms) => budget.sample(ms));
    expect(verdicts).toEqual([false, false, false, false]);
  });

  it('starts a fresh window after every verdict', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 2 });
    budget.sample(50);
    expect(budget.sample(50)).toBe(true);
    expect(budget.sample(5)).toBe(false);
    expect(budget.sample(5)).toBe(false);
  });

  it('ignores outliers and invalid samples', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 2, outlierMs: 100 });
    for (const ms of [500, Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      expect(budget.sample(ms)).toBe(false);
    }
    expect(budget.sample(16)).toBe(false);
    expect(budget.sample(16)).toBe(false);
  });

  it('can be reset explicitly', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 2 });
    budget.sample(90);
    budget.reset();
    budget.sample(10);
    expect(budget.sample(10)).toBe(false);
  });

  it('uses sensible defaults', () => {
    const budget = new FrameBudget();
    const verdicts = Array.from({ length: 120 }, () => budget.sample(30));
    expect(verdicts.filter(Boolean)).toHaveLength(1);
    expect(verdicts.at(-1)).toBe(true);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(Array.from({ length: 5 }, mulberry32(7))).not.toEqual(first);
  });

  it('produces values in [0, 1) with a roughly uniform mean', () => {
    const random = mulberry32(2026);
    const values = Array.from({ length: 10_000 }, () => random());
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});
