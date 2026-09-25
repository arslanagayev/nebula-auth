// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppBus } from '../src/core/appEvents';
import type { NebulaSceneOptions } from '../src/scene/NebulaScene';
import { loadScene, readQualityOverride } from '../src/scene/loadScene';
import type * as support from '../src/scene/support';
import { isWebGL2Available } from '../src/scene/support';

/**
 * A stand-in for the three.js scene: the loader's job is orchestration (feature detection,
 * quality, warm-up, start, teardown), which does not need a GPU to be verified.
 */
const fake = vi.hoisted(() => {
  class FakeScene {
    static instances: FakeScene[] = [];
    static failOn: 'construct' | 'warmUp' | null = null;

    readonly options: NebulaSceneOptions;
    readonly calls: string[] = [];
    reducedMotion: boolean;

    constructor(options: NebulaSceneOptions) {
      if (FakeScene.failOn === 'construct') throw new Error('no context');
      this.options = options;
      this.reducedMotion = options.reducedMotion;
      FakeScene.instances.push(this);
    }

    warmUp(): Promise<void> {
      this.calls.push('warmUp');
      return FakeScene.failOn === 'warmUp'
        ? Promise.reject(new Error('link failed'))
        : Promise.resolve();
    }

    start(): void {
      this.calls.push('start');
    }

    setReducedMotion(reducedMotion: boolean): void {
      this.reducedMotion = reducedMotion;
    }

    dispose(): void {
      this.calls.push('dispose');
    }
  }
  return { FakeScene };
});

vi.mock('../src/scene/NebulaScene', () => ({ NebulaScene: fake.FakeScene }));
vi.mock('../src/scene/support', async (importOriginal) => {
  const actual = await importOriginal<typeof support>();
  return { isWebGL2Available: vi.fn(actual.isWebGL2Available) };
});

function setUp() {
  const bus = createAppBus();
  const status = vi.fn();
  bus.on('scene:status', status);
  const canvas = document.createElement('canvas');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  return { bus, status, canvas, reducedMotion };
}

describe('loadScene', () => {
  beforeEach(() => {
    fake.FakeScene.instances = [];
    fake.FakeScene.failOn = null;
  });

  it('keeps the CSS background and skips three.js entirely without WebGL 2', async () => {
    // happy-dom has no WebGL, like old browsers or GPU-blocklisted machines.
    const { bus, status, canvas, reducedMotion } = setUp();

    const handle = await loadScene({ canvas, bus, reducedMotion, search: '' });

    expect(handle).toBeNull();
    expect(status).toHaveBeenCalledExactlyOnceWith({ status: 'unavailable' });
    expect(fake.FakeScene.instances).toHaveLength(0);
  });

  it('compiles the shaders before the first frame, then starts the scene', async () => {
    vi.mocked(isWebGL2Available).mockReturnValue(true);
    const { bus, canvas, reducedMotion } = setUp();

    const handle = await loadScene({ canvas, bus, reducedMotion, search: '' });

    const [scene] = fake.FakeScene.instances;
    expect(handle).not.toBeNull();
    expect(scene?.calls).toEqual(['warmUp', 'start']);
    expect(scene?.options).toMatchObject({ canvas, bus, reducedMotion: false });
    expect(scene?.options.quality.adaptive).toBe(true);
  });

  it('pins the quality tier from the query string, e.g. for screen recordings', async () => {
    vi.mocked(isWebGL2Available).mockReturnValue(true);
    const { bus, canvas, reducedMotion } = setUp();

    await loadScene({ canvas, bus, reducedMotion, search: '?quality=high' });

    expect(fake.FakeScene.instances[0]?.options.quality).toMatchObject({
      tier: 'high',
      bloom: true,
      adaptive: false,
    });
  });

  it('follows reduced-motion changes until it is disposed', async () => {
    vi.mocked(isWebGL2Available).mockReturnValue(true);
    const { bus, canvas, reducedMotion } = setUp();

    const handle = await loadScene({ canvas, bus, reducedMotion, search: '' });
    const [scene] = fake.FakeScene.instances;

    reducedMotion.dispatchEvent(new MediaQueryListEvent('change', { matches: true }));
    expect(scene?.reducedMotion).toBe(true);

    handle?.dispose();
    expect(scene?.calls.at(-1)).toBe('dispose');
    reducedMotion.dispatchEvent(new MediaQueryListEvent('change', { matches: false }));
    expect(scene?.reducedMotion).toBe(true);
  });

  it('releases a half-started scene and falls back to CSS when warm-up fails', async () => {
    vi.mocked(isWebGL2Available).mockReturnValue(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fake.FakeScene.failOn = 'warmUp';
    const { bus, status, canvas, reducedMotion } = setUp();

    const handle = await loadScene({ canvas, bus, reducedMotion, search: '' });

    expect(handle).toBeNull();
    expect(fake.FakeScene.instances[0]?.calls).toEqual(['warmUp', 'dispose']);
    expect(status).toHaveBeenCalledExactlyOnceWith({ status: 'unavailable' });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('falls back to CSS when the renderer cannot be created', async () => {
    vi.mocked(isWebGL2Available).mockReturnValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fake.FakeScene.failOn = 'construct';
    const { bus, status, canvas, reducedMotion } = setUp();

    expect(await loadScene({ canvas, bus, reducedMotion, search: '' })).toBeNull();
    expect(status).toHaveBeenCalledExactlyOnceWith({ status: 'unavailable' });
  });
});

describe('readQualityOverride', () => {
  it('accepts a known tier from the query string', () => {
    expect(readQualityOverride('?quality=high')).toBe('high');
    expect(readQualityOverride('?utm=ig&quality=low')).toBe('low');
  });

  it('ignores anything else', () => {
    expect(readQualityOverride('')).toBeUndefined();
    expect(readQualityOverride('?quality=ultra')).toBeUndefined();
  });
});
