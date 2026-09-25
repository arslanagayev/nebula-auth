export type QualityTier = 'high' | 'medium' | 'low';

export const QUALITY_TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

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
  /** The pixel ratio currently rendered at: the device's, capped at `maxPixelRatio`. */
  readonly pixelRatio: number;
  /** Upper bound for the pixel ratio (2 desktop, 1.5 mobile, 1 low-end); lowered by degrading. */
  readonly maxPixelRatio: number;
  readonly bloom: boolean;
  readonly antialias: boolean;
  /**
   * Resolution scale of three.js' transmission pass, which re-renders the scene behind the
   * glass core every frame. 0 turns refraction off entirely.
   */
  readonly transmission: number;
  /** Whether the frame-time monitor may change this profile at runtime. */
  readonly adaptive: boolean;
}

export const PARTICLE_COUNTS: Readonly<Record<QualityTier, number>> = {
  high: 30_000,
  medium: 16_000,
  low: 8_000,
};

export const MAX_PIXEL_RATIO = { desktop: 2, mobile: 1.5, low: 1 } as const;

/**
 * The core is at most ~200 px wide and sits behind frosted glass, so its refraction does not
 * need a full-resolution copy of the scene. Half resolution costs a quarter of the memory
 * and bandwidth with no visible difference.
 */
export const TRANSMISSION_SCALE: Readonly<Record<QualityTier, number>> = {
  high: 0.5,
  medium: 0.35,
  low: 0,
};

/** The lowest transmission scale the adaptive ladder steps down to. */
const MIN_TRANSMISSION_SCALE = 0.25;

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

/** The device pixel ratio clamped to `[1, maxPixelRatio]`. */
export const effectivePixelRatio = (devicePixelRatio: number, maxPixelRatio: number): number =>
  Math.max(1, Math.min(devicePixelRatio, maxPixelRatio));

export interface QualityOverrides {
  /** Forces a tier and turns adaptive quality off, e.g. `?quality=high` for screen recordings. */
  readonly tier?: QualityTier | undefined;
}

/**
 * Picks particle count, resolution and post-processing for the device. Pixel ratio is the
 * single biggest cost driver for fill-rate bound scenes like this one, so it is capped
 * (2 on desktop, 1.5 on mobile, 1 on low-end hardware).
 */
export function resolveQuality(
  signals: DeviceSignals,
  overrides: QualityOverrides = {},
): QualityProfile {
  const tier = overrides.tier ?? detectTier(signals);
  let maxPixelRatio: number = isMobile(signals) ? MAX_PIXEL_RATIO.mobile : MAX_PIXEL_RATIO.desktop;
  if (tier === 'low') maxPixelRatio = MAX_PIXEL_RATIO.low;
  const bloom = tier === 'high' && !signals.reducedMotion;

  return {
    tier,
    particleCount: PARTICLE_COUNTS[tier],
    pixelRatio: effectivePixelRatio(signals.devicePixelRatio, maxPixelRatio),
    maxPixelRatio,
    bloom,
    // MSAA is wasted on high-density screens, too expensive on weak GPUs, and useless on the
    // default framebuffer when bloom renders into its own (multisampled) target instead.
    antialias: tier !== 'low' && !bloom && signals.devicePixelRatio < 2,
    transmission: TRANSMISSION_SCALE[tier],
    adaptive: overrides.tier === undefined,
  };
}

/**
 * One step down the quality ladder for adaptive performance: drop bloom first, then shrink
 * the transmission pass, then lower the resolution. Returns `null` when there is nothing
 * left to give up.
 */
export function degradeQuality(profile: QualityProfile): QualityProfile | null {
  if (profile.bloom) return { ...profile, bloom: false };
  if (profile.transmission > MIN_TRANSMISSION_SCALE) {
    return { ...profile, transmission: MIN_TRANSMISSION_SCALE };
  }
  if (profile.pixelRatio > 1) {
    const maxPixelRatio = Math.max(1, Math.round((profile.pixelRatio - 0.5) * 2) / 2);
    return { ...profile, maxPixelRatio, pixelRatio: maxPixelRatio };
  }
  return null;
}
