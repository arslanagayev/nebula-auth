import { describe, expect, it } from 'vitest';
import { FrameBudget } from '../src/lib/frameBudget';
import {
  degradeQuality,
  detectTier,
  effectivePixelRatio,
  PARTICLE_COUNTS,
  resolveQuality,
  TRANSMISSION_SCALE,
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
      maxPixelRatio: 2,
      bloom: true,
      antialias: false,
      transmission: TRANSMISSION_SCALE.high,
      adaptive: true,
    });
  });

  it('renders the transmission pass at reduced resolution, and not at all on low-end devices', () => {
    expect(resolveQuality(desktop).transmission).toBe(0.5);
    expect(resolveQuality(phone).transmission).toBe(0.35);
    expect(resolveQuality({ ...phone, hardwareConcurrency: 2 }).transmission).toBe(0);
  });

  it('can pin a tier, which also turns adaptive quality off', () => {
    const pinned = resolveQuality(phone, { tier: 'high' });
    expect(pinned).toMatchObject({ tier: 'high', particleCount: PARTICLE_COUNTS.high });
    expect(pinned.adaptive).toBe(false);
    // The pixel-ratio cap still follows the device.
    expect(pinned.maxPixelRatio).toBe(1.5);
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

  it('enables MSAA on the canvas only for standard density screens without bloom', () => {
    // With bloom the scene renders into the composer's multisampled target instead.
    expect(resolveQuality({ ...desktop, devicePixelRatio: 1 })).toMatchObject({
      pixelRatio: 1,
      bloom: true,
      antialias: false,
    });
    expect(resolveQuality({ ...phone, devicePixelRatio: 1 })).toMatchObject({
      bloom: false,
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

describe('effectivePixelRatio', () => {
  it('follows the device within the cap, e.g. after zooming or moving to another monitor', () => {
    expect(effectivePixelRatio(1.25, 2)).toBe(1.25);
    expect(effectivePixelRatio(3, 2)).toBe(2);
    expect(effectivePixelRatio(0.8, 2)).toBe(1);
  });
});

describe('degradeQuality', () => {
  it('drops bloom, then refraction resolution, then pixel ratio in half steps, then gives up', () => {
    const steps = [];
    let profile = resolveQuality(desktop);
    for (let next = degradeQuality(profile); next; next = degradeQuality(profile)) {
      steps.push({
        bloom: next.bloom,
        transmission: next.transmission,
        pixelRatio: next.pixelRatio,
        maxPixelRatio: next.maxPixelRatio,
      });
      profile = next;
    }
    expect(steps).toEqual([
      { bloom: false, transmission: 0.5, pixelRatio: 2, maxPixelRatio: 2 },
      { bloom: false, transmission: 0.25, pixelRatio: 2, maxPixelRatio: 2 },
      { bloom: false, transmission: 0.25, pixelRatio: 1.5, maxPixelRatio: 1.5 },
      { bloom: false, transmission: 0.25, pixelRatio: 1, maxPixelRatio: 1 },
    ]);
  });

  it('never turns refraction back on for devices that render without it', () => {
    const low = resolveQuality({ ...phone, hardwareConcurrency: 2 });
    expect(degradeQuality(low)).toBeNull();
  });
});

describe('FrameBudget', () => {
  /** Feeds `windows` full windows of identical frames and collects the verdicts. */
  function feed(budget: FrameBudget, frameMs: number, windows: number, windowSize: number) {
    const verdicts = [];
    for (let frame = 0; frame < windows * windowSize; frame += 1) {
      const verdict = budget.sample(frameMs);
      if (verdict !== null) verdicts.push(verdict);
    }
    return verdicts;
  }

  it('stays quiet until the budget is missed for several full windows', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 3, patience: 2 });
    expect([40, 40, 40, 40, 40].map((ms) => budget.sample(ms))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(budget.sample(40)).toBe('degrade');
  });

  it('ignores a single slow window', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 4, patience: 2 });
    expect(feed(budget, 40, 1, 4)).toEqual([]);
    expect(feed(budget, 10, 1, 4)).toEqual([]);
    expect(feed(budget, 40, 1, 4)).toEqual([]);
  });

  it('does not report windows that average within budget', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 4, patience: 1 });
    const verdicts = [10, 30, 16, 18].map((ms) => budget.sample(ms));
    expect(verdicts).toEqual([null, null, null, null]);
  });

  it('keeps a degrade step that made frames faster and keeps adapting', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 10, patience: 1 });
    expect(feed(budget, 45, 1, 10)).toEqual(['degrade']);
    // Faster, but still over budget: the step is kept and the next one is requested.
    expect(feed(budget, 30, 1, 10)).toEqual(['degrade']);
    expect(feed(budget, 15, 3, 10)).toEqual([]);
  });

  it('undoes a step that did not help, e.g. on a display capped at 30 Hz, then stops', () => {
    const budget = new FrameBudget({ windowSize: 30 });
    const verdicts = feed(budget, 1000 / 30, 20, 30);
    expect(verdicts).toEqual(['degrade', 'restore']);
  });

  it('ignores outliers and invalid samples', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 2, outlierMs: 100, patience: 1 });
    for (const ms of [500, Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      expect(budget.sample(ms)).toBeNull();
    }
    expect(budget.sample(16)).toBeNull();
    expect(budget.sample(16)).toBeNull();
  });

  it('can start a fresh window explicitly', () => {
    const budget = new FrameBudget({ budgetMs: 20, windowSize: 2, patience: 1 });
    budget.sample(90);
    budget.reset();
    budget.sample(10);
    expect(budget.sample(10)).toBeNull();
  });

  it('uses sensible defaults: two slow 120-frame windows', () => {
    const budget = new FrameBudget();
    expect(feed(budget, 30, 1, 120)).toEqual([]);
    expect(feed(budget, 30, 1, 120)).toEqual(['degrade']);
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
