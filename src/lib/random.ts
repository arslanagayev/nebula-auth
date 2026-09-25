/**
 * Mulberry32: a tiny, fast, seedable PRNG. Used wherever the output must be reproducible
 * (the galaxy looks identical on every load, which keeps screenshots and tests stable).
 * Not suitable for anything security related — use `crypto.getRandomValues` for that.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
