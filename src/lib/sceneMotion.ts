import type { StrengthScore } from '../core/types';
import { damp } from './math';

/**
 * The scene's choreography as pure state: how UI events turn into animation targets, and how
 * those targets are eased every frame. `NebulaScene` owns the GPU side and simply reads the
 * numbers from here, so all of the behaviour below is unit-tested without WebGL.
 */

/** Galaxy rotation speed multipliers for each UI state. */
export const SPEED = { idle: 1, focused: 1.9, pending: 5.2 } as const;
/** Base angular speed of the orbit phase, in radians per second at `SPEED.idle`. */
export const BASE_ANGULAR_SPEED = 0.16;
/** Extra speed a card flip adds for a moment, as a multiple of the base speed. */
export const FLIP_KICK = 7;
/** Heart pulse rate in Hz per strength score: weak passwords beat nervously, strong ones calmly. */
export const PULSE_RATES: Readonly<Record<StrengthScore, number>> = {
  0: 2.4,
  1: 2,
  2: 1.5,
  3: 1.1,
  4: 0.8,
};
export const IDLE_PULSE_RATE = 0.9;
/** Orbit phase of the single frame rendered for reduced motion: a pleasing, fixed pose. */
export const STATIC_PHASE = 0.9;

/**
 * Orbit parameters shared with `galaxy.vert.glsl` (passed in as the `uOrbit` uniform), so the
 * shader and {@link orbitAngle} can never disagree.
 *
 * The arm pattern turns rigidly (`rigid`), like a density wave, while the inner disc sways
 * back and forth by at most `shear` radians. Pure differential rotation (angular speed falling
 * with radius) would wind the arms up without limit and smear the spiral into a plain disc
 * within minutes: the classic winding problem.
 */
export const ORBIT = {
  rigid: 0.55,
  shear: 0.35,
  shearRate: 0.3,
  swirlTwist: 2.2,
} as const;

/** Angle of a star after `phase`: the TypeScript mirror of the shader's orbit maths. */
export function orbitAngle(
  baseAngle: number,
  radius: number,
  maxRadius: number,
  phase: number,
  swirl = 0,
): number {
  const centre = 1 - Math.min(Math.max(radius / maxRadius, 0), 1);
  return (
    baseAngle +
    phase * ORBIT.rigid +
    ORBIT.shear * centre * centre * Math.sin(phase * ORBIT.shearRate) +
    swirl * ORBIT.swirlTwist * centre * centre
  );
}

/**
 * One-off UI events the scene reacts to: a text field gained or lost focus, a request was
 * sent, succeeded or failed, the user left a success screen, or the card flipped.
 */
export type SceneCue = 'focus' | 'blur' | 'pending' | 'success' | 'error' | 'reset' | 'flip';

/** Which colour the glass core shows: idle violet, a strength score, or success. */
export type CoreTone = 'idle' | 'success' | StrengthScore;

export interface MotionState {
  /** Current speed multiplier, eased towards the state's target. */
  speed: number;
  /** Decaying rotational kick from a card flip. */
  kick: number;
  /** Integrated orbit phase (speed changes never make the galaxy jump). */
  phase: number;
  /** 0..1 vortex while a request is pending. */
  swirl: number;
  /** 0..1 decaying success shockwave. */
  burst: number;
  /** 0..1 decaying error flash. */
  flash: number;
  /** 0..1 how busy the core looks (spin, glow). */
  energy: number;
  /** Eased pointer position for camera parallax, in normalised device coordinates. */
  parallaxX: number;
  parallaxY: number;
}

export class SceneDirector {
  readonly motion: MotionState = {
    speed: SPEED.idle,
    kick: 0,
    phase: 0,
    swirl: 0,
    burst: 0,
    flash: 0,
    energy: 0,
    parallaxX: 0,
    parallaxY: 0,
  };

  #focused = false;
  #pending = false;
  #succeeded = false;
  #strength: StrengthScore | null = null;

  get coreTone(): CoreTone {
    if (this.#succeeded) return 'success';
    return this.#strength ?? 'idle';
  }

  get pulseRate(): number {
    const tone = this.coreTone;
    return tone === 'idle' || tone === 'success' ? IDLE_PULSE_RATE : PULSE_RATES[tone];
  }

  /** Reacts to a one-off UI event. */
  cue(cue: SceneCue): void {
    switch (cue) {
      case 'focus':
        this.#focused = true;
        break;
      case 'blur':
        this.#focused = false;
        break;
      case 'pending':
        this.#pending = true;
        break;
      case 'success':
        this.#pending = false;
        this.#succeeded = true;
        this.motion.burst = 1;
        break;
      case 'error':
        this.#pending = false;
        this.motion.flash = 1;
        break;
      case 'flip':
        this.motion.kick = 1;
        break;
      case 'reset':
        // The user left a success screen: back to the current strength colour.
        this.#succeeded = false;
        break;
    }
  }

  /** The password strength changed; `null` when there is no password on screen. */
  strength(score: StrengthScore | null): void {
    this.#strength = score;
    this.#succeeded = false;
  }

  /** Advances every animated value by `dt` seconds with frame-rate independent easing. */
  step(dt: number, pointerX: number, pointerY: number): void {
    const motion = this.motion;
    const pending = this.#pending;
    const targetSpeed = pending ? SPEED.pending : this.#focused ? SPEED.focused : SPEED.idle;

    motion.speed = damp(motion.speed, targetSpeed, pending ? 1.6 : 1.1, dt);
    motion.kick = damp(motion.kick, 0, 2.2, dt);
    motion.phase += dt * BASE_ANGULAR_SPEED * (motion.speed + motion.kick * FLIP_KICK);
    motion.swirl = damp(motion.swirl, pending ? 1 : 0, pending ? 1.4 : 1.8, dt);
    motion.energy = damp(motion.energy, pending ? 1 : 0, 3, dt);
    motion.burst = damp(motion.burst, 0, 1.1, dt);
    motion.flash = damp(motion.flash, 0, 2.6, dt);
    motion.parallaxX = damp(motion.parallaxX, pointerX, 2.4, dt);
    motion.parallaxY = damp(motion.parallaxY, pointerY, 2.4, dt);
  }

  /** Reduced motion: drop every transient effect and jump to a fixed, resting pose. */
  settle(): void {
    Object.assign(this.motion, {
      kick: 0,
      phase: STATIC_PHASE,
      swirl: 0,
      burst: 0,
      flash: 0,
      parallaxX: 0,
      parallaxY: 0,
    });
  }
}
