// Self-hosted variable fonts: no third-party font requests, no layout shift from late swaps.
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/index.css';

import { createAppBus } from './core/appEvents';
import { createAuthService } from './lib/authService';
import { loadScene, type SceneHandle } from './scene/loadScene';
import { initAuthUI } from './ui/authForms';
import { initFlip } from './ui/flip';
import { observeCardLayout } from './ui/layout';
import { initTilt } from './ui/tilt';
import { createToaster } from './ui/toast';

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
const tilt = requireElement('[data-tilt]', HTMLElement);
const card = requireElement('[data-card]', HTMLElement);
const faces = {
  'sign-in': requireElement('[data-face="sign-in"]', HTMLElement),
  register: requireElement('[data-face="register"]', HTMLElement),
};

// 1. The UI is plain DOM and becomes interactive as soon as this module runs.
const toaster = createToaster(requireElement('[data-toasts]', HTMLElement));
const flip = initFlip({ card, faces, bus, reducedMotion });
initTilt(tilt, { signal });
initAuthUI({
  card,
  faces,
  bus,
  auth: createAuthService(),
  toaster,
  flip,
  reducedMotion,
  signal,
});
observeCardLayout(stage, bus, signal);

bus.on(
  'scene:status',
  ({ status }) => {
    root.classList.toggle('scene-ready', status === 'ready');
  },
  { signal },
);

// 2. three.js (~150 kB gzipped) loads after the first paint, in its own chunk.
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
