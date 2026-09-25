import type { AppBus } from '../core/appEvents';
import { resolveQuality, type DeviceSignals } from '../lib/quality';
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
 * Loads the three.js scene as a separate chunk once the page is idle. The form never waits
 * for it: without WebGL, or if anything fails, the CSS nebula stays and the UI keeps working.
 */
export async function loadScene({
  canvas,
  bus,
  reducedMotion,
}: LoadSceneOptions): Promise<SceneHandle | null> {
  if (!isWebGL2Available()) {
    bus.emit('scene:status', { status: 'unavailable' });
    return null;
  }

  try {
    const { NebulaScene } = await import('./NebulaScene');
    const quality = resolveQuality(readDeviceSignals(reducedMotion.matches));
    const scene = new NebulaScene({ canvas, bus, quality, reducedMotion: reducedMotion.matches });

    const onMotionChange = (event: MediaQueryListEvent): void => {
      scene.setReducedMotion(event.matches);
    };
    reducedMotion.addEventListener('change', onMotionChange);
    scene.start();

    return {
      dispose: () => {
        reducedMotion.removeEventListener('change', onMotionChange);
        scene.dispose();
      },
    };
  } catch (error) {
    // Deliberately non-fatal: the page is fully usable without the 3D layer.
    console.warn('Nebula: the 3D scene could not start, using the CSS background.', error);
    bus.emit('scene:status', { status: 'unavailable' });
    return null;
  }
}
