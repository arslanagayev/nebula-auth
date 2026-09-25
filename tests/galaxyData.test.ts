import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/lib/random';
import { DEFAULT_GALAXY, generateGalaxy } from '../src/scene/galaxyData';

const params = { ...DEFAULT_GALAXY, count: 2_000 };

describe('generateGalaxy', () => {
  it('allocates one entry per star in every buffer', () => {
    const data = generateGalaxy(params, mulberry32(1));
    expect(data.positions).toHaveLength(params.count * 3);
    expect(data.offsets).toHaveLength(params.count * 3);
    expect(data.colors).toHaveLength(params.count * 3);
    expect(data.scales).toHaveLength(params.count);
  });

  it('is deterministic for a given seed', () => {
    const a = generateGalaxy(params, mulberry32(42));
    const b = generateGalaxy(params, mulberry32(42));
    expect(a.positions).toEqual(b.positions);
    expect(a.colors).toEqual(b.colors);
  });

  it('places base positions on the disc within the configured radius', () => {
    const { positions } = generateGalaxy(params, mulberry32(3));
    for (let i = 0; i < params.count; i += 1) {
      const x = positions[i * 3] ?? Number.NaN;
      const y = positions[i * 3 + 1] ?? Number.NaN;
      const z = positions[i * 3 + 2] ?? Number.NaN;
      expect(y).toBe(0);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(params.radius + 0.05 + 1e-6);
    }
  });

  it('concentrates stars towards the core', () => {
    const { positions } = generateGalaxy(params, mulberry32(9));
    let inner = 0;
    for (let i = 0; i < params.count; i += 1) {
      const radius = Math.hypot(positions[i * 3] ?? 0, positions[i * 3 + 2] ?? 0);
      if (radius < params.radius / 2) inner += 1;
    }
    // With pow(x, 1.5) about 63% of stars fall inside half the radius.
    expect(inner / params.count).toBeGreaterThan(0.55);
  });

  it('produces valid colours and point scales', () => {
    const { colors, scales } = generateGalaxy(params, mulberry32(5));
    expect(colors.every((channel) => channel >= 0 && channel <= 1.0001)).toBe(true);
    expect(scales.every((scale) => scale > 0 && scale < 3)).toBe(true);
  });
});
