import { describe, expect, it } from 'vitest';
import { clamp, damp, lerp, smoothstep, toNdc } from '../src/lib/math';

describe('clamp / lerp', () => {
  it('clamps into the range', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(2, 0, 1)).toBe(1);
  });

  it('interpolates linearly', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 1)).toBe(20);
  });
});

describe('damp', () => {
  it('does not move without elapsed time', () => {
    expect(damp(0, 10, 5, 0)).toBe(0);
    expect(damp(0, 10, 5, -1)).toBe(0);
  });

  it('converges towards the target', () => {
    let value = 0;
    for (let frame = 0; frame < 600; frame += 1) value = damp(value, 1, 4, 1 / 60);
    expect(value).toBeCloseTo(1, 6);
  });

  it('is independent of the frame rate', () => {
    let at60 = 0;
    let at144 = 0;
    for (let frame = 0; frame < 60; frame += 1) at60 = damp(at60, 1, 3, 1 / 60);
    for (let frame = 0; frame < 144; frame += 1) at144 = damp(at144, 1, 3, 1 / 144);
    expect(at60).toBeCloseTo(at144, 10);
    expect(at60).toBeCloseTo(1 - Math.exp(-3), 10);
  });
});

describe('smoothstep', () => {
  it('eases between the edges and clamps outside them', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625);
  });
});

describe('toNdc', () => {
  it('maps the viewport corners and centre', () => {
    expect(toNdc(0, 0, 200, 100)).toEqual([-1, 1]);
    expect(toNdc(100, 50, 200, 100)).toEqual([0, 0]);
    expect(toNdc(200, 100, 200, 100)).toEqual([1, -1]);
  });
});
