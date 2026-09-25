import { describe, expect, it } from 'vitest';
import {
  BASE_ANGULAR_SPEED,
  IDLE_PULSE_RATE,
  ORBIT,
  orbitAngle,
  PULSE_RATES,
  SceneDirector,
  SPEED,
  STATIC_PHASE,
} from '../src/lib/sceneMotion';
import { DEFAULT_GALAXY } from '../src/scene/galaxyData';

/** Runs the director for `seconds` at 60 fps with the pointer at rest. */
function run(director: SceneDirector, seconds: number): void {
  for (let frame = 0; frame < seconds * 60; frame += 1) director.step(1 / 60, 0, 0);
}

describe('SceneDirector', () => {
  it('idles at the base speed with a violet core', () => {
    const director = new SceneDirector();
    run(director, 1);
    expect(director.motion.speed).toBeCloseTo(SPEED.idle, 5);
    expect(director.motion.phase).toBeCloseTo(BASE_ANGULAR_SPEED, 5);
    expect(director.coreTone).toBe('idle');
    expect(director.pulseRate).toBe(IDLE_PULSE_RATE);
  });

  it('spins the galaxy faster while a field is focused and eases back after blur', () => {
    const director = new SceneDirector();
    director.cue('focus');
    run(director, 6);
    expect(director.motion.speed).toBeCloseTo(SPEED.focused, 2);

    director.cue('blur');
    run(director, 6);
    expect(director.motion.speed).toBeCloseTo(SPEED.idle, 2);
  });

  it('swirls strongly while a request is pending', () => {
    const director = new SceneDirector();
    director.cue('focus');
    director.cue('pending');
    run(director, 5);
    expect(director.motion.speed).toBeCloseTo(SPEED.pending, 1);
    expect(director.motion.swirl).toBeGreaterThan(0.99);
    expect(director.motion.energy).toBeGreaterThan(0.99);
  });

  it('bursts to the success colour and calms down again', () => {
    const director = new SceneDirector();
    director.cue('pending');
    run(director, 1);
    director.cue('success');

    expect(director.motion.burst).toBe(1);
    expect(director.coreTone).toBe('success');
    run(director, 5);
    expect(director.motion.burst).toBeLessThan(0.01);
    expect(director.motion.swirl).toBeLessThan(0.01);
  });

  it('flashes red on errors and ends the pending swirl', () => {
    const director = new SceneDirector();
    director.cue('pending');
    run(director, 1);
    director.cue('error');

    expect(director.motion.flash).toBe(1);
    run(director, 3);
    expect(director.motion.flash).toBeLessThan(0.01);
    expect(director.motion.energy).toBeLessThan(0.01);
  });

  it('follows the password strength and returns to it after a success screen', () => {
    const director = new SceneDirector();
    director.strength(1);
    expect(director.coreTone).toBe(1);
    expect(director.pulseRate).toBe(PULSE_RATES[1]);

    director.cue('success');
    expect(director.coreTone).toBe('success');
    director.cue('reset');
    expect(director.coreTone).toBe(1);

    director.strength(null);
    expect(director.coreTone).toBe('idle');
  });

  it('pulses calmer for stronger passwords', () => {
    const rates = ([0, 1, 2, 3, 4] as const).map((score) => PULSE_RATES[score]);
    expect([...rates].sort((a, b) => b - a)).toEqual(rates);
  });

  it('gives the galaxy a decaying kick when the card flips', () => {
    const director = new SceneDirector();
    const idle = new SceneDirector();
    director.cue('flip');
    run(director, 3);
    run(idle, 3);
    expect(director.motion.kick).toBeLessThan(0.01);
    expect(director.motion.phase).toBeGreaterThan(idle.motion.phase * 2);
  });

  it('eases the camera parallax towards the pointer', () => {
    const director = new SceneDirector();
    for (let frame = 0; frame < 240; frame += 1) director.step(1 / 60, 0.5, -0.25);
    expect(director.motion.parallaxX).toBeCloseTo(0.5, 2);
    expect(director.motion.parallaxY).toBeCloseTo(-0.25, 2);
  });

  it('settles into a fixed pose for reduced motion', () => {
    const director = new SceneDirector();
    director.cue('flip');
    director.cue('error');
    for (let frame = 0; frame < 30; frame += 1) director.step(1 / 60, 1, 1);

    director.settle();
    expect(director.motion).toMatchObject({
      phase: STATIC_PHASE,
      kick: 0,
      swirl: 0,
      burst: 0,
      flash: 0,
      parallaxX: 0,
      parallaxY: 0,
    });
  });
});

describe('orbitAngle', () => {
  const { radius: maxRadius } = DEFAULT_GALAXY;
  /** Relative twist between an inner and an outer star on the same arm. */
  const twist = (phase: number) =>
    orbitAngle(0, 1, maxRadius, phase) - orbitAngle(0, 3, maxRadius, phase);

  it('turns the whole arm pattern at the same rate', () => {
    expect(orbitAngle(0, maxRadius, maxRadius, 10)).toBeCloseTo(10 * ORBIT.rigid, 10);
  });

  it('keeps the arms from winding up, however long the page stays open', () => {
    // One hour at the pending speed is far more phase than any real visit accumulates.
    const hour = 3600 * BASE_ANGULAR_SPEED * SPEED.pending;
    let largest = 0;
    for (let phase = 0; phase <= hour; phase += 0.37) {
      largest = Math.max(largest, Math.abs(twist(phase) - twist(0)));
    }
    expect(largest).toBeLessThanOrEqual(ORBIT.shear);

    // For comparison: the previous purely differential rotation, phase / (0.35 + 0.55 r) at
    // 0.11 rad/s, wound the same two stars 2 rad apart after only 30 idle seconds (almost
    // an arm's entire twist) and kept going.
    const differential = (phase: number) => phase / (0.35 + 0.55) - phase / (0.35 + 0.55 * 3);
    expect(differential(30 * 0.11)).toBeCloseTo(2, 1);
  });

  it('adds the pending vortex mostly near the centre', () => {
    const centre = orbitAngle(0, 0.2, maxRadius, 0, 1);
    const rim = orbitAngle(0, maxRadius, maxRadius, 0, 1);
    expect(centre).toBeGreaterThan(ORBIT.swirlTwist * 0.9);
    expect(rim).toBe(0);
  });
});
