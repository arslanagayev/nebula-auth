import { Color } from 'three';
import { smoothstep } from '../lib/math';
import { GALAXY_CORE, PALETTE } from './palette';

export interface GalaxyParameters {
  readonly count: number;
  /** Outer radius in world units. */
  readonly radius: number;
  /** Number of spiral arms. */
  readonly branches: number;
  /** How far an arm winds per unit of radius, in radians. */
  readonly spin: number;
  /** Maximum scatter away from the arm, relative to the radius. */
  readonly randomness: number;
  /** Higher values pull scattered stars closer to the arm's spine. */
  readonly randomnessPower: number;
}

export const DEFAULT_GALAXY: Omit<GalaxyParameters, 'count'> = {
  radius: 5.6,
  branches: 3,
  spin: 1.15,
  randomness: 0.42,
  randomnessPower: 2.8,
};

export interface GalaxyAttributes {
  /** Base position on the disc (y = 0). The shader derives radius and angle from it. */
  readonly positions: Float32Array;
  /** Per-star scatter away from the arm, applied after the orbit rotation. */
  readonly offsets: Float32Array;
  /**
   * Linear-space RGB. The hot centre goes above 1.0 on purpose: with bloom on, only the
   * core of the galaxy (and the glass core's heart) crosses the bloom threshold.
   */
  readonly colors: Float32Array;
  readonly scales: Float32Array;
}

/** Brightness boost of the innermost stars, so the centre is what blooms, not the arms. */
export const CENTRE_BOOST = 1.6;
const CENTRE_EXTENT = 0.08;

const PINK_SHARE = 0.1;
const CYAN_SHARE = 0.05;
/** Share of larger foreground stars. Few enough to read as depth, not as confetti. */
const BIG_STAR_SHARE = 0.004;

/** Where a point on an arm's spine sits, for placing extra detail such as dust clouds. */
export function armSpine(
  params: Pick<GalaxyParameters, 'branches' | 'spin'>,
  branch: number,
  distance: number,
): { readonly x: number; readonly z: number } {
  const angle = (branch / params.branches) * Math.PI * 2 + distance * params.spin;
  return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
}

/**
 * Generates the star distribution on the CPU once. Everything that moves afterwards
 * (orbit, swirl, twinkle) happens in the vertex shader, so the buffers are never re-uploaded.
 */
export function generateGalaxy(params: GalaxyParameters, random: () => number): GalaxyAttributes {
  const { count, radius: maxRadius, branches, randomness, randomnessPower } = params;
  const positions = new Float32Array(count * 3);
  const offsets = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);

  const inner = new Color(GALAXY_CORE.inner);
  const hot = new Color(GALAXY_CORE.hot);
  const middle = new Color(PALETTE.violet);
  const outer = new Color(PALETTE.cyan);
  const pink = new Color(PALETTE.pink);
  const color = new Color();

  // Signed, power-biased scatter: most stars hug the arm, a few stray far away.
  const scatter = (distance: number): number =>
    Math.pow(random(), randomnessPower) *
    (random() < 0.5 ? 1 : -1) *
    randomness *
    (0.35 + distance * 0.55);

  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    // pow(x, 1.5) concentrates stars towards the bright core.
    const distance = Math.pow(random(), 1.5) * maxRadius + 0.05;
    const spine = armSpine(params, i % branches, distance);

    positions[i3] = spine.x;
    positions[i3 + 1] = 0;
    positions[i3 + 2] = spine.z;

    offsets[i3] = scatter(distance);
    // The disc is thin at the rim and bulges at the centre.
    offsets[i3 + 1] = scatter(distance) * (0.25 + 0.55 * (1 - distance / maxRadius));
    offsets[i3 + 2] = scatter(distance);

    // Warm core → violet arms → cyan only at the rim, so violet dominates the disc.
    const t = distance / maxRadius;
    color.copy(hot).lerp(inner, smoothstep(0, CENTRE_EXTENT, t));
    color.lerp(middle, smoothstep(0.06, 0.6, t));
    color.lerp(outer, smoothstep(0.7, 1, t));

    const accent = random();
    if (accent < PINK_SHARE) color.lerp(pink, 0.85);
    else if (accent < PINK_SHARE + CYAN_SHARE) color.lerp(outer, 0.7);

    // Dim some stars so the arms have texture instead of a uniform glow. Stars near the
    // centre are dimmer individually because thousands of them overlap additively there,
    // but the very centre is lifted above 1.0 so it is what the bloom pass picks up.
    const brightness =
      (0.55 + random() * 0.45) *
      (0.4 + 0.6 * smoothstep(0, 0.35, t)) *
      (1 + (CENTRE_BOOST - 1) * (1 - smoothstep(0, CENTRE_EXTENT, t)));
    colors[i3] = color.r * brightness;
    colors[i3 + 1] = color.g * brightness;
    colors[i3 + 2] = color.b * brightness;

    // A few larger stars read as foreground depth.
    scales[i] = random() < BIG_STAR_SHARE ? 1.2 + random() * 0.6 : 0.35 + random() * 0.85;
  }

  return { positions, offsets, colors, scales };
}
