export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * Frame-rate independent exponential smoothing towards `target`.
 *
 * `lerp(a, b, 0.1)` per frame converges twice as fast at 120 Hz as at 60 Hz. Using
 * `1 - e^(-λ·dt)` as the interpolation factor makes the motion identical at any refresh rate:
 * after `dt` seconds the remaining distance has shrunk by exactly `e^(-λ·dt)`.
 *
 * @param lambda Responsiveness; roughly "how many e-foldings per second".
 * @param dt Elapsed time in seconds.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (dt <= 0) return current;
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Hermite interpolation between 0 and 1 once `value` passes from `edge0` to `edge1`. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Converts a viewport pixel coordinate to normalised device coordinates (-1…1, y up). */
export function toNdc(x: number, y: number, width: number, height: number): [number, number] {
  return [(x / width) * 2 - 1, 1 - (y / height) * 2];
}
