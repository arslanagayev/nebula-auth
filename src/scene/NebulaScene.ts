import {
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AppBus, CardRect } from '../core/appEvents';
import { FrameBudget } from '../lib/frameBudget';
import { clamp, damp, toNdc } from '../lib/math';
import type { StrengthScore } from '../lib/passwordStrength';
import { degradeQuality, type QualityProfile } from '../lib/quality';
import { GlassCore } from './core';
import { Galaxy } from './galaxy';
import { IDLE_CORE_COLOR, PALETTE, STRENGTH_COLORS } from './palette';
import { createPostProcessing, type PostProcessing } from './postprocessing';
import { Starfield } from './starfield';
import { createGlowTexture } from './textures';

export interface NebulaSceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly bus: AppBus;
  readonly quality: QualityProfile;
  readonly reducedMotion: boolean;
}

const FOV = 50;
const CAMERA_DISTANCE = 8;
/** Depth of the plane the glass core floats on (between the galaxy and the camera). */
const CORE_PLANE_Z = 1.6;
const RESIZE_DEBOUNCE_MS = 150;
/** Longest frame the simulation will integrate, so a hitch never teleports the galaxy. */
const MAX_DELTA = 1 / 20;

/** Rotation speed multipliers for the galaxy in each UI state. */
const SPEED = { idle: 1, focused: 1.9, pending: 5.2 } as const;
/** Base angular speed; multiplied by SPEED and integrated into the orbit phase. */
const BASE_ANGULAR_SPEED = 0.11;
/** Heart pulse rate in Hz per strength score: weak passwords beat nervously, strong ones calmly. */
const PULSE_RATES: Readonly<Record<StrengthScore, number>> = {
  0: 2.4,
  1: 2,
  2: 1.5,
  3: 1.1,
  4: 0.8,
};
const IDLE_PULSE_RATE = 0.9;

interface SceneState {
  focused: boolean;
  pending: boolean;
}

interface Motion {
  speed: number;
  kick: number;
  phase: number;
  swirl: number;
  burst: number;
  flash: number;
  energy: number;
  parallaxX: number;
  parallaxY: number;
}

/**
 * Owns the renderer, camera and render loop, and translates UI events from the bus into
 * animation targets. It never touches the DOM besides its canvas and window-level listeners,
 * all of which are removed again in {@link dispose}.
 */
export class NebulaScene {
  readonly #canvas: HTMLCanvasElement;
  readonly #bus: AppBus;
  readonly #renderer: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(FOV, 1, 0.1, 120);
  /** Camera without parallax: the reference for anchoring the core to the card. */
  readonly #anchorCamera = new PerspectiveCamera(FOV, 1, 0.1, 120);
  readonly #galaxy: Galaxy;
  readonly #starfield: Starfield;
  readonly #core: GlassCore;
  readonly #glow: Texture;
  readonly #budget = new FrameBudget();
  readonly #listeners = new AbortController();

  /** PMREM-filtered RoomEnvironment: the reflections and refraction source of the core. */
  #environment: WebGLRenderTarget;
  #quality: QualityProfile;
  #post: PostProcessing | null = null;
  #reducedMotion: boolean;
  #running = false;
  #lastTime: number | null = null;
  #hasRendered = false;
  #resizeTimer: ReturnType<typeof setTimeout> | undefined;
  #pendingFrame = 0;
  #cardRect: CardRect | null = null;

  readonly #state: SceneState = { focused: false, pending: false };
  readonly #motion: Motion = {
    speed: SPEED.idle,
    kick: 0,
    phase: 0,
    swirl: 0,
    burst: 0,
    flash: 0,
    energy: 0,
    parallaxX: 0,
    parallaxY: 0,
  };
  readonly #pointer = { x: 0, y: 0 };

  constructor({ canvas, bus, quality, reducedMotion }: NebulaSceneOptions) {
    this.#canvas = canvas;
    this.#bus = bus;
    this.#quality = quality;
    this.#reducedMotion = reducedMotion;

    this.#renderer = new WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.#renderer.setClearColor(PALETTE.space, 1);
    this.#renderer.toneMapping = NeutralToneMapping;
    this.#renderer.toneMappingExposure = 1.05;
    this.#renderer.setPixelRatio(quality.pixelRatio);
    this.#renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.#environment = this.#createEnvironment();
    this.#glow = createGlowTexture();

    this.#galaxy = new Galaxy({
      count: quality.particleCount,
      pixelRatio: quality.pixelRatio,
      intensity: quality.bloom ? 1 : 1.2,
    });
    // Tilt the disc towards the viewer and turn it slightly for a diagonal composition.
    this.#galaxy.points.rotation.set(0.62, 0, -0.32);
    this.#galaxy.points.position.set(0.3, -0.35, 0);

    this.#starfield = new Starfield(quality.tier === 'low' ? 600 : 1400, this.#glow);
    this.#core = new GlassCore({
      environment: this.#environment.texture,
      glow: this.#glow,
      bloom: quality.bloom,
    });

    this.#scene.add(this.#starfield.points, this.#galaxy.points, this.#core.group);
    if (quality.bloom) this.#post = createPostProcessing(this.#renderer, this.#scene, this.#camera);

    this.#applySize();
    this.#subscribe();
    this.#listen();
  }

  start(): void {
    if (this.#reducedMotion) {
      this.#requestStaticFrame();
      return;
    }
    if (this.#running || document.hidden) return;
    this.#running = true;
    this.#lastTime = null;
    this.#renderer.setAnimationLoop(this.#tick);
  }

  stop(): void {
    this.#running = false;
    this.#renderer.setAnimationLoop(null);
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (reducedMotion === this.#reducedMotion) return;
    this.#reducedMotion = reducedMotion;
    if (reducedMotion) {
      this.stop();
      this.#settleMotion();
      this.#requestStaticFrame();
    } else {
      this.start();
    }
  }

  dispose(): void {
    this.stop();
    cancelAnimationFrame(this.#pendingFrame);
    clearTimeout(this.#resizeTimer);
    this.#listeners.abort();
    this.#post?.dispose();
    this.#galaxy.dispose();
    this.#starfield.dispose();
    this.#core.dispose();
    this.#glow.dispose();
    this.#environment.dispose();
    this.#renderer.dispose();
  }

  // ---------------------------------------------------------------------------------------
  // Events

  #subscribe(): void {
    const { signal } = this.#listeners;
    const bus = this.#bus;

    const set = (patch: Partial<SceneState>) => (): void => {
      this.#setState(patch);
    };
    bus.on('field:focus', set({ focused: true }), { signal });
    bus.on('field:blur', set({ focused: false }), { signal });
    bus.on('auth:pending', set({ pending: true }), { signal });

    bus.on(
      'auth:success',
      () => {
        this.#motion.burst = 1;
        this.#core.setColor(PALETTE.success, 0.9);
        this.#setState({ pending: false });
      },
      { signal },
    );

    bus.on(
      'auth:error',
      () => {
        this.#motion.flash = 1;
        this.#setState({ pending: false });
      },
      { signal },
    );

    bus.on(
      'password:strength',
      ({ score }) => {
        this.#showStrength(score);
      },
      { signal, replay: true },
    );

    bus.on(
      'auth:reset',
      () => {
        this.#showStrength(bus.latest('password:strength')?.score ?? null);
      },
      { signal },
    );

    bus.on(
      'view:flip',
      () => {
        this.#motion.kick = 1;
        this.#invalidate();
      },
      { signal },
    );

    bus.on(
      'layout:card',
      (rect) => {
        this.#cardRect = rect;
        this.#placeCore();
        this.#invalidate();
      },
      { signal, replay: true },
    );
  }

  #showStrength(score: StrengthScore | null): void {
    if (score === null) this.#core.setColor(IDLE_CORE_COLOR, IDLE_PULSE_RATE);
    else this.#core.setColor(STRENGTH_COLORS[score], PULSE_RATES[score]);
    this.#invalidate();
  }

  #setState(patch: Partial<SceneState>): void {
    Object.assign(this.#state, patch);
    this.#invalidate();
  }

  #listen(): void {
    const { signal } = this.#listeners;

    window.addEventListener(
      'resize',
      () => {
        clearTimeout(this.#resizeTimer);
        this.#resizeTimer = setTimeout(() => {
          this.#applySize();
          this.#invalidate();
        }, RESIZE_DEBOUNCE_MS);
      },
      { signal, passive: true },
    );

    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return;
        [this.#pointer.x, this.#pointer.y] = toNdc(
          event.clientX,
          event.clientY,
          window.innerWidth,
          window.innerHeight,
        );
      },
      { signal, passive: true },
    );

    // Pausing while hidden saves battery; resetting the clock avoids a huge first delta.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.stop();
        } else {
          this.start();
        }
      },
      { signal },
    );

    this.#canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.stop();
        this.#hasRendered = false;
        this.#bus.emit('scene:status', { status: 'lost' });
      },
      { signal },
    );

    this.#canvas.addEventListener(
      'webglcontextrestored',
      () => {
        // Geometry, programs and ordinary textures are re-uploaded by three.js on demand,
        // but the PMREM environment lives in a render target and must be rebuilt.
        const previous = this.#environment;
        this.#environment = this.#createEnvironment();
        this.#core.setEnvironment(this.#environment.texture);
        previous.dispose();
        this.start();
      },
      { signal },
    );
  }

  // ---------------------------------------------------------------------------------------
  // Frame loop

  readonly #tick = (time: number): void => {
    const dt =
      this.#lastTime === null ? 1 / 60 : Math.min((time - this.#lastTime) / 1000, MAX_DELTA);
    const frameMs = this.#lastTime === null ? 0 : time - this.#lastTime;
    this.#lastTime = time;

    if (this.#budget.sample(frameMs)) this.#degrade();
    this.#update(dt, time / 1000);
    this.#render(dt);
  };

  #update(dt: number, clock: number): void {
    const motion = this.#motion;
    const { focused, pending } = this.#state;
    const targetSpeed = pending ? SPEED.pending : focused ? SPEED.focused : SPEED.idle;

    motion.speed = damp(motion.speed, targetSpeed, pending ? 1.6 : 1.1, dt);
    motion.kick = damp(motion.kick, 0, 2.2, dt);
    motion.phase += dt * BASE_ANGULAR_SPEED * (motion.speed + motion.kick * 7);
    motion.swirl = damp(motion.swirl, pending ? 1 : 0, pending ? 1.4 : 1.8, dt);
    motion.energy = damp(motion.energy, pending ? 1 : 0, 3, dt);
    motion.burst = damp(motion.burst, 0, 1.1, dt);
    motion.flash = damp(motion.flash, 0, 2.6, dt);
    motion.parallaxX = damp(motion.parallaxX, this.#pointer.x, 2.4, dt);
    motion.parallaxY = damp(motion.parallaxY, this.#pointer.y, 2.4, dt);

    this.#galaxy.update({
      phase: motion.phase,
      clock,
      swirl: motion.swirl,
      burst: motion.burst,
      flash: motion.flash,
    });
    this.#core.update({
      dt,
      clock,
      energy: motion.energy,
      burst: motion.burst,
      flash: motion.flash,
    });

    const anchor = this.#anchorCamera.position;
    this.#camera.position.set(
      anchor.x + motion.parallaxX * 0.45,
      anchor.y + motion.parallaxY * 0.3,
      anchor.z,
    );
    this.#camera.lookAt(0, 0, 0);
  }

  #render(dt: number): void {
    if (this.#post) this.#post.render(dt);
    else this.#renderer.render(this.#scene, this.#camera);

    if (!this.#hasRendered) {
      this.#hasRendered = true;
      this.#bus.emit('scene:status', { status: 'ready' });
    }
  }

  /** In reduced-motion mode nothing animates, so every state change renders one frame. */
  #invalidate(): void {
    if (this.#reducedMotion) this.#requestStaticFrame();
  }

  #requestStaticFrame(): void {
    if (this.#pendingFrame !== 0) return;
    this.#pendingFrame = requestAnimationFrame(() => {
      this.#pendingFrame = 0;
      this.#settleMotion();
      this.#core.snap();
      this.#update(0, 0);
      this.#render(0);
    });
  }

  /** Reduced motion: skip transient effects and jump to the resting state. */
  #settleMotion(): void {
    Object.assign(this.#motion, {
      swirl: 0,
      burst: 0,
      flash: 0,
      kick: 0,
      parallaxX: 0,
      parallaxY: 0,
    });
    this.#motion.phase = 0.9;
  }

  // ---------------------------------------------------------------------------------------
  // Layout & quality

  #applySize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / Math.max(height, 1);
    // Portrait screens pull the camera back so more of the galaxy stays in frame.
    const distance = CAMERA_DISTANCE + (aspect < 1 ? (1 - aspect) * 5 : 0);

    for (const camera of [this.#camera, this.#anchorCamera]) {
      camera.aspect = aspect;
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }
    this.#anchorCamera.updateMatrixWorld();

    this.#renderer.setSize(width, height, false);
    this.#post?.setSize(width, height);
    this.#placeCore();
  }

  /**
   * Floats the core just inside the card's top-left corner, so the frosted glass blurs it
   * and its colour bleeds through the card. Unprojects the corner onto the core's plane.
   */
  #placeCore(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const camera = this.#anchorCamera;

    const depth = camera.position.z - CORE_PLANE_Z;
    const worldPerPixel = (2 * depth * Math.tan((FOV * Math.PI) / 360)) / height;
    const radiusPx = clamp(Math.min(width, height) * 0.085, 48, 104);

    const rect = this.#cardRect;
    const cornerX = rect ? rect.left + radiusPx * 0.3 : width * 0.3;
    const cornerY = rect ? rect.top + radiusPx * 0.45 : height * 0.3;
    const [x, y] = toNdc(cornerX, cornerY, width, height);

    const point = new Vector3(x, y, 0.5).unproject(camera);
    const direction = point.sub(camera.position).normalize();
    const distance = (CORE_PLANE_Z - camera.position.z) / direction.z;
    const target = camera.position.clone().addScaledVector(direction, distance);

    this.#core.setTarget(target, radiusPx * worldPerPixel);
  }

  /** Called when frames consistently miss their budget: give up bloom, then resolution. */
  #degrade(): void {
    const next = degradeQuality(this.#quality);
    if (!next) return;

    if (!next.bloom && this.#post) {
      this.#post.dispose();
      this.#post = null;
      this.#galaxy.setIntensity(1.2);
      this.#core.setBloom(false);
    }
    if (next.pixelRatio !== this.#quality.pixelRatio) {
      this.#renderer.setPixelRatio(next.pixelRatio);
      // The composer keeps its own pixel ratio for its render targets.
      this.#post?.setPixelRatio(next.pixelRatio);
      this.#galaxy.setPixelRatio(next.pixelRatio);
      this.#applySize();
    }
    this.#quality = next;
  }

  #createEnvironment(): WebGLRenderTarget {
    const pmrem = new PMREMGenerator(this.#renderer);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    return target;
  }
}
