export type QualityTier = 'high' | 'medium' | 'low';

/** Everything needed to pick a rendering budget, gathered from browser APIs by the caller. */
export interface DeviceSignals {
  readonly viewportWidth: number;
  readonly devicePixelRatio: number;
  /** `(pointer: coarse)` — phones and tablets. */
  readonly coarsePointer: boolean;
  readonly hardwareConcurrency?: number | undefined;
  /** `navigator.deviceMemory` in GiB (Chromium only). */
  readonly deviceMemory?: number | undefined;
  /** The user enabled a data saver mode. */
  readonly saveData?: boolean | undefined;
  readonly reducedMotion: boolean;
}

export interface QualityProfile {
  readonly tier: QualityTier;
  readonly particleCount: number;
  readonly pixelRatio: number;
  readonly bloom: boolean;
  readonly antialias: boolean;
}

export const PARTICLE_COUNTS: Readonly<Record<QualityTier, number>> = {
  high: 30_000,
  medium: 16_000,
  low: 8_000,
};

export const MAX_PIXEL_RATIO = { desktop: 2, mobile: 1.5, low: 1 } as const;

const MOBILE_BREAKPOINT = 768;

const isMobile = (signals: DeviceSignals): boolean =>
  signals.coarsePointer || signals.viewportWidth < MOBILE_BREAKPOINT;

export function detectTier(signals: DeviceSignals): QualityTier {
  const cores = signals.hardwareConcurrency ?? 4;
  const memory = signals.deviceMemory ?? 8;
  if (signals.saveData === true || cores <= 2 || memory <= 2) return 'low';
  if (isMobile(signals) || cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}

/**
 * Picks particle count, resolution and post-processing for the device. Pixel ratio is the
 * single biggest cost driver for fill-rate bound scenes like this one, so it is capped
 * (2 on desktop, 1.5 on mobile, 1 on low-end hardware).
 */
export function resolveQuality(signals: DeviceSignals): QualityProfile {
  const tier = detectTier(signals);
  let maxPixelRatio: number = isMobile(signals) ? MAX_PIXEL_RATIO.mobile : MAX_PIXEL_RATIO.desktop;
  if (tier === 'low') maxPixelRatio = MAX_PIXEL_RATIO.low;

  return {
    tier,
    particleCount: PARTICLE_COUNTS[tier],
    pixelRatio: Math.max(1, Math.min(signals.devicePixelRatio, maxPixelRatio)),
    bloom: tier === 'high' && !signals.reducedMotion,
    // MSAA is wasted on high-density screens and too expensive on weak GPUs.
    antialias: tier !== 'low' && signals.devicePixelRatio < 2,
  };
}

/**
 * One step down the quality ladder for adaptive performance: drop bloom first, then
 * resolution. Returns `null` when there is nothing left to give up.
 */
export function degradeQuality(profile: QualityProfile): QualityProfile | null {
  if (profile.bloom) return { ...profile, bloom: false };
  if (profile.pixelRatio > 1) {
    return { ...profile, pixelRatio: Math.max(1, Math.round((profile.pixelRatio - 0.5) * 2) / 2) };
  }
  return null;
}
