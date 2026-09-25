import type { AppBus } from '../core/appEvents';
import {
  QUALITY_TIERS,
  resolveQuality,
  type DeviceSignals,
  type QualityTier,
} from '../lib/quality';
import type { NebulaScene } from './NebulaScene';
import { isWebGL2Available } from './support';

interface NavigatorHints {
  readonly deviceMemory?: number;
  readonly connection?: { readonly saveData?: boolean };
}

export interface SceneHandle {
  dispose(): void;
}

export interface LoadSceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly bus: AppBus;
  readonly reducedMotion: MediaQueryList;
  /** Overrides the query string, which is read by default (`?quality=high`). */
  readonly search?: string;
}

function readDeviceSignals(reducedMotion: boolean): DeviceSignals {
  const hints = navigator as Navigator & NavigatorHints;
  return {
    viewportWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: hints.deviceMemory,
    saveData: hints.connection?.saveData,
    reducedMotion,
  };
}

/**
 * `?quality=high|medium|low` pins a tier and turns adaptive quality off, e.g. so that a
 * screen recording never loses its bloom to the recorder's own load.
 */
export function readQualityOverride(search: string): QualityTier | undefined {
  const value = new URLSearchParams(search).get('quality');
  return QUALITY_TIERS.find((tier) => tier === value);
}

/** Lets the browser handle input between two long pieces of set-up work. */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Loads the three.js scene as a separate chunk once the page is idle. The form never waits
 * for it: without WebGL, or if anything fails, the CSS nebula stays and the UI keeps working.
 */
export async function loadScene({
  canvas,
  bus,
  reducedMotion,
  search = window.location.search,
}: LoadSceneOptions): Promise<SceneHandle | null> {
  if (!isWebGL2Available()) {
    bus.emit('scene:status', { status: 'unavailable' });
    return null;
  }

  let scene: NebulaScene | null = null;
  try {
    const module = await import('./NebulaScene');
    await nextTask();
    const quality = resolveQuality(readDeviceSignals(reducedMotion.matches), {
      tier: readQualityOverride(search),
    });
    // Generates the stars and the environment map in one task…
    const created = new module.NebulaScene({
      canvas,
      bus,
      quality,
      reducedMotion: reducedMotion.matches,
    });
    scene = created;
    await nextTask();
    // …then compiles the shaders, in parallel where the browser supports it.
    await created.warmUp();

    const onMotionChange = (event: MediaQueryListEvent): void => {
      created.setReducedMotion(event.matches);
    };
    reducedMotion.addEventListener('change', onMotionChange);
    created.start();

    return {
      dispose: () => {
        reducedMotion.removeEventListener('change', onMotionChange);
        created.dispose();
      },
    };
  } catch (error) {
    // Deliberately non-fatal: the page is fully usable without the 3D layer. A scene that
    // was already created still holds a WebGL context and window listeners: release them.
    scene?.dispose();
    console.warn('Nebula: the 3D scene could not start, using the CSS background.', error);
    bus.emit('scene:status', { status: 'unavailable' });
    return null;
  }
}
