// Self-hosted variable fonts: no third-party font requests. index.html preloads the two
// latin subsets that the first paint needs.
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/index.css';

import { createAppBus } from './core/appEvents';
import { createAuthService } from './lib/authService';
import { loadScene, type SceneHandle } from './scene/loadScene';
import { initAuthUI } from './ui/authForms';
import { requireElement } from './ui/dom';
import { bindDocumentState } from './ui/documentState';
import { initFlip } from './ui/flip';
import { observeCardLayout } from './ui/layout';
import { initTilt } from './ui/tilt';
import { createToaster } from './ui/toast';

const bus = createAppBus();
const lifetime = new AbortController();
const { signal } = lifetime;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointer = window.matchMedia('(pointer: coarse)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

const canvas = requireElement(document, '[data-scene]', HTMLCanvasElement);
const stage = requireElement(document, '.auth', HTMLElement);
const tilt = requireElement(document, '[data-tilt]', HTMLElement);
const card = requireElement(document, '[data-card]', HTMLElement);
const faces = {
  'sign-in': requireElement(card, '[data-face="sign-in"]', HTMLElement),
  register: requireElement(card, '[data-face="register"]', HTMLElement),
};

// 1. The UI is plain DOM and becomes interactive as soon as this module runs.
const toaster = createToaster(
  requireElement(document, '[data-toasts]', HTMLElement),
  requireElement(document, '[data-announcer]', HTMLElement),
);
bindDocumentState({ root: document.documentElement, bus, signal });
const flip = initFlip({ card, faces, bus, reducedMotion, coarsePointer });
initTilt(tilt, { reducedMotion, finePointer, signal });
initAuthUI({
  card,
  faces,
  bus,
  auth: createAuthService(),
  toaster,
  flip,
  reducedMotion,
  coarsePointer,
  signal,
});
// `.auth` is the untransformed box around the tilting card, so the core does not wobble.
observeCardLayout(stage, bus, signal);

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

// Hot module replacement: this module accepts its own updates (and those of every module it
// imports), so an edit re-runs it without a full reload. Everything above is bound to
// `lifetime`, which makes teardown one abort() plus releasing the GPU.
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    lifetime.abort();
    scene?.dispose();
    toaster.clear();
    bus.clear();
    // A disposed renderer forces its context to be lost, and a canvas never hands out a new
    // one; the next module instance gets a fresh canvas instead.
    canvas.replaceWith(canvas.cloneNode());
  });
}
