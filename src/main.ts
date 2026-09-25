// Self-hosted variable fonts: no third-party font requests, no layout shift from late swaps.
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/index.css';

import { createAppBus } from './core/appEvents';
import { loadScene, type SceneHandle } from './scene/loadScene';
import { observeCardLayout } from './ui/layout';

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Nebula: missing element ${selector}`);
  return element;
}

const root = document.documentElement;
const bus = createAppBus();
const lifetime = new AbortController();
const { signal } = lifetime;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const canvas = requireElement('[data-scene]', HTMLCanvasElement);
const stage = requireElement('main', HTMLElement);

// The scene anchors the glass core to the card, so it needs to know where the card is.
observeCardLayout(stage, bus, signal);

bus.on(
  'scene:status',
  ({ status }) => {
    root.classList.toggle('scene-ready', status === 'ready');
  },
  { signal },
);

// three.js (~150 kB gzipped) loads after the first paint, in its own chunk.
let scene: SceneHandle | null = null;
requestAnimationFrame(() => {
  setTimeout(() => {
    void loadScene({ canvas, bus, reducedMotion }).then((handle) => {
      if (signal.aborted) handle?.dispose();
      else scene = handle;
    });
  }, 0);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    lifetime.abort();
    scene?.dispose();
    bus.clear();
  });
}
