import {
  Color,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AppBus, AppEvents, CardRect } from '../core/appEvents';
import { FrameBudget } from '../lib/frameBudget';
import { clamp, damp, toNdc } from '../lib/math';
import { degradeQuality, effectivePixelRatio, type QualityProfile } from '../lib/quality';
import { SceneDirector, type SceneCue } from '../lib/sceneMotion';
import { GlassCore } from './core';
import { Galaxy, POINT_SIZE } from './galaxy';
import { coreColor, PALETTE } from './palette';
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
/** Depth of the galaxy's centre, slightly behind the origin the camera looks at. */
const GALAXY_PLANE_Z = -0.6;
const RESIZE_DEBOUNCE_MS = 150;
/** Longest frame the simulation will integrate, so a hitch never teleports the galaxy. */
const MAX_DELTA = 1 / 20;
/** Galaxy brightness with and without the bloom pass. */
const GALAXY_INTENSITY = { bloom: 1.1, plain: 1.35 } as const;
/** Shader compilation normally finishes well within this; never block the scene on it. */
const WARM_UP_TIMEOUT_MS = 3000;

// Scratch objects for per-frame and per-layout maths: no allocations on hot paths.
const scratchPoint = new Vector3();
const scratchDirection = new Vector3();
const scratchTarget = new Vector3();
const scratchSize = new Vector2();

/** Which bus event cues which reaction of the {@link SceneDirector}. */
const CUES = [
  ['field:focus', 'focus'],
  ['field:blur', 'blur'],
  ['auth:pending', 'pending'],
  ['auth:success', 'success'],
  ['auth:error', 'error'],
  ['auth:reset', 'reset'],
  ['view:flip', 'flip'],
] as const satisfies readonly (readonly [keyof AppEvents, SceneCue])[];

/**
 * Owns the renderer, camera and render loop. UI events from the bus go to a
 * {@link SceneDirector}, which turns them into animation targets; this class only moves
 * those numbers into uniforms and transforms. It never touches the DOM besides its canvas
 * and window-level listeners, all of which are removed again in {@link dispose}.
 */
export class NebulaScene {
  readonly #canvas: HTMLCanvasElement;
  readonly #bus: AppBus;
  readonly #renderer: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(FOV, 1, 0.1, 120);
  /** Camera without parallax or easing: the reference for anchoring things to the DOM. */
  readonly #anchorCamera = new PerspectiveCamera(FOV, 1, 0.1, 120);
  readonly #director = new SceneDirector();
  readonly #galaxy: Galaxy;
  readonly #starfield: Starfield;
  readonly #core: GlassCore;
  readonly #glow: Texture;
  readonly #budget = new FrameBudget();
  readonly #listeners = new AbortController();
  readonly #galaxyFrame = { phase: 0, clock: 0, swirl: 0, burst: 0, flash: 0 };
  readonly #coreFrame = { dt: 0, clock: 0, energy: 0, burst: 0, flash: 0 };
  readonly #pointer = { x: 0, y: 0 };

  /** PMREM-filtered RoomEnvironment: the reflections and refraction source of the core. */
  #environment: WebGLRenderTarget;
  #quality: QualityProfile;
  /** The profile before the last adaptive downgrade, while that downgrade is on trial. */
  #previousQuality: QualityProfile | null = null;
  #post: PostProcessing | null = null;
  #reducedMotion: boolean;
  #running = false;
  #lastTime: number | null = null;
  #hasRendered = false;
  #contextLost = false;
  #failed = false;
  #resizeTimer: ReturnType<typeof setTimeout> | undefined;
  #pendingFrame = 0;
  #cardRect: CardRect | null = null;
  #width = 0;
  #height = 0;
  #cameraDistance = CAMERA_DISTANCE;
  #targetDistance = CAMERA_DISTANCE;

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
      // Waking a laptop's discrete GPU for a sign-in page only pays off on the top tier.
      powerPreference: quality.tier === 'high' ? 'high-performance' : 'default',
    });

    try {
      // three.js logs shader errors and keeps rendering nothing; fall back to CSS instead.
      this.#renderer.debug.onShaderError = () => {
        this.#fail('a shader failed to compile');
      };
      // A background colour rather than a clear colour: three.js converts it for whichever
      // target is being drawn. The EffectComposer clears its linear target with the clear
      // colour last converted for the sRGB canvas, which lifted the black to a navy haze.
      this.#scene.background = new Color(PALETTE.space);
      this.#renderer.toneMapping = NeutralToneMapping;
      this.#renderer.toneMappingExposure = 1.05;
      this.#renderer.transmissionResolutionScale = quality.transmission || 1;
      this.#renderer.setPixelRatio(quality.pixelRatio);

      this.#environment = this.#createEnvironment();
      this.#glow = createGlowTexture();

      this.#galaxy = new Galaxy({
        count: quality.particleCount,
        intensity: quality.bloom ? GALAXY_INTENSITY.bloom : GALAXY_INTENSITY.plain,
        sprite: this.#glow,
        // Phones render half the stars at a lower pixel ratio: larger points keep the arms full.
        pointSize: quality.tier === 'high' ? POINT_SIZE : POINT_SIZE * 1.3,
      });
      // Tilt the disc towards the viewer and turn it slightly for a diagonal composition.
      this.#galaxy.points.rotation.set(0.62, 0, -0.32);

      this.#starfield = new Starfield(quality.tier === 'low' ? 600 : 1400, this.#glow);
      this.#core = new GlassCore({
        environment: this.#environment.texture,
        glow: this.#glow,
        bloom: quality.bloom,
        transmission: quality.transmission > 0,
      });

      this.#scene.add(this.#starfield.points, this.#galaxy.points, this.#core.group);
      if (quality.bloom) {
        this.#post = createPostProcessing(this.#renderer, this.#scene, this.#camera);
      }

      // Subscribe first: the replayed card rectangle must be known before the first layout,
      // or the core would glide in from a fallback position.
      this.#subscribe();
      this.#applySize();
      this.#listen();
    } catch (error) {
      // Free the GPU context right away rather than waiting for garbage collection.
      this.#renderer.dispose();
      this.#renderer.forceContextLoss();
      throw error;
    }
  }

  /**
   * Compiles every shader program before the first frame, in parallel where the browser
   * supports `KHR_parallel_shader_compile`, so the first frames do not stall input.
   */
  async warmUp(): Promise<void> {
    // Programs depend on the output target (tone mapping, colour space): compile the
    // variants the first frames will actually use.
    this.#renderer.setRenderTarget(this.#post?.target ?? null);
    const compiled = this.#renderer.compileAsync(this.#scene, this.#camera);
    this.#renderer.setRenderTarget(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, WARM_UP_TIMEOUT_MS);
    });
    await Promise.race([compiled, timeout]);
    clearTimeout(timer);
  }

  start(): void {
    if (this.#failed || this.#contextLost) return;
    if (this.#reducedMotion) {
      this.#requestStaticFrame();
      return;
    }
    if (this.#running || document.hidden) return;
    this.#running = true;
    this.#lastTime = null;
    this.#budget.reset();
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
    // renderer.dispose() does not free three.js' internal transmission target; losing the
    // context releases everything it still holds.
    this.#renderer.forceContextLoss();
  }

  // ---------------------------------------------------------------------------------------
  // Events

  #subscribe(): void {
    const { signal } = this.#listeners;
    const bus = this.#bus;
    const director = this.#director;

    // One-off UI events: each cues the director, then the core colour and (with reduced
    // motion) a fresh static frame follow.
    for (const [type, cue] of CUES) {
      bus.on(
        type,
        () => {
          director.cue(cue);
          this.#syncCoreColor();
          this.#invalidate();
        },
        { signal },
      );
    }

    bus.on(
      'password:strength',
      ({ score }) => {
        director.strength(score);
        this.#syncCoreColor();
        this.#invalidate();
      },
      { signal, replay: true },
    );

    bus.on(
      'layout:card',
      (rect) => {
        this.#cardRect = rect;
        // Window resizes are debounced for the GPU buffers, but the cameras follow at once
        // so the core stays pinned to the card while the window is being dragged.
        const { clientWidth, clientHeight } = this.#canvas;
        if (clientWidth !== this.#width || clientHeight !== this.#height) {
          this.#updateCameras(clientWidth, clientHeight);
        }
        this.#placeCore();
        this.#invalidate();
      },
      { signal, replay: true },
    );
  }

  #syncCoreColor(): void {
    this.#core.setColor(coreColor(this.#director.coreTone), this.#director.pulseRate);
  }

  #listen(): void {
    const { signal } = this.#listeners;

    // The canvas is sized in CSS (100lvh), so mobile toolbars collapsing on scroll never
    // resize it; only real layout changes reach the renderer.
    const resizeObserver = new ResizeObserver(() => {
      this.#scheduleResize();
    });
    resizeObserver.observe(this.#canvas);
    signal.addEventListener('abort', () => {
      resizeObserver.disconnect();
    });
    this.#watchPixelRatio();

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
        this.#contextLost = true;
        this.stop();
        cancelAnimationFrame(this.#pendingFrame);
        this.#pendingFrame = 0;
        this.#hasRendered = false;
        this.#bus.emit('scene:status', { status: 'lost' });
      },
      { signal },
    );

    this.#canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.#contextLost = false;
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

  /**
   * Zooming or moving the window to another monitor changes `devicePixelRatio`, sometimes
   * without a resize. A resolution media query that matches the current ratio fires once
   * when it changes; it is then re-armed for the new ratio.
   */
  #watchPixelRatio(): void {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      'change',
      () => {
        this.#scheduleResize();
        this.#watchPixelRatio();
      },
      { once: true, signal: this.#listeners.signal },
    );
  }

  #scheduleResize(): void {
    clearTimeout(this.#resizeTimer);
    this.#resizeTimer = setTimeout(() => {
      this.#applySize();
      this.#invalidate();
    }, RESIZE_DEBOUNCE_MS);
  }

  #fail(reason: string): void {
    if (this.#failed) return;
    this.#failed = true;
    this.stop();
    cancelAnimationFrame(this.#pendingFrame);
    console.warn(`Nebula: ${reason}; using the CSS background instead.`);
    this.#bus.emit('scene:status', { status: 'unavailable' });
  }

  // ---------------------------------------------------------------------------------------
  // Frame loop

  readonly #tick = (time: number): void => {
    const dt =
      this.#lastTime === null ? 1 / 60 : Math.min((time - this.#lastTime) / 1000, MAX_DELTA);
    const frameMs = this.#lastTime === null ? 0 : time - this.#lastTime;
    this.#lastTime = time;

    if (this.#quality.adaptive) {
      const verdict = this.#budget.sample(frameMs);
      if (verdict === 'degrade') this.#degrade();
      else if (verdict === 'restore') this.#restore();
    }
    this.#update(dt, time / 1000);
    this.#render(dt);
  };

  #update(dt: number, clock: number): void {
    const director = this.#director;
    director.step(dt, this.#pointer.x, this.#pointer.y);
    const motion = director.motion;

    const galaxy = this.#galaxyFrame;
    galaxy.phase = motion.phase;
    galaxy.clock = clock;
    galaxy.swirl = motion.swirl;
    galaxy.burst = motion.burst;
    galaxy.flash = motion.flash;
    this.#galaxy.update(galaxy);

    const core = this.#coreFrame;
    core.dt = dt;
    core.clock = clock;
    core.energy = motion.energy;
    core.burst = motion.burst;
    core.flash = motion.flash;
    this.#core.update(core);

    // Portrait screens pull the camera back; easing it hides small layout changes.
    this.#cameraDistance =
      dt === 0 ? this.#targetDistance : damp(this.#cameraDistance, this.#targetDistance, 3, dt);
    const anchor = this.#anchorCamera.position;
    this.#camera.position.set(
      anchor.x + motion.parallaxX * 0.45,
      anchor.y + motion.parallaxY * 0.3,
      this.#cameraDistance,
    );
    this.#camera.lookAt(0, 0, 0);
  }

  #render(dt: number): void {
    if (this.#failed || this.#contextLost) return;
    if (this.#post) this.#post.render(dt);
    else this.#renderer.render(this.#scene, this.#camera);
    this.#announceReady();
  }

  /** The first successful frame fades the canvas in over the CSS fallback. */
  #announceReady(): void {
    // A shader error during that very render, or a context that is gone, is not "ready".
    if (this.#hasRendered || this.#failed || this.#renderer.getContext().isContextLost()) return;
    this.#hasRendered = true;
    this.#bus.emit('scene:status', { status: 'ready' });
  }

  /** In reduced-motion mode nothing animates, so every state change renders one frame. */
  #invalidate(): void {
    if (this.#reducedMotion) this.#requestStaticFrame();
  }

  #requestStaticFrame(): void {
    if (this.#pendingFrame !== 0 || this.#failed || this.#contextLost) return;
    this.#pendingFrame = requestAnimationFrame(() => {
      this.#pendingFrame = 0;
      this.#director.settle();
      this.#core.snap();
      this.#update(0, 0);
      this.#render(0);
    });
  }

  // ---------------------------------------------------------------------------------------
  // Layout & quality

  /** Resizes the GPU buffers to the canvas and follows `devicePixelRatio` within the cap. */
  #applySize(): void {
    const width = Math.max(1, this.#canvas.clientWidth);
    const height = Math.max(1, this.#canvas.clientHeight);

    const pixelRatio = effectivePixelRatio(window.devicePixelRatio, this.#quality.maxPixelRatio);
    if (pixelRatio !== this.#renderer.getPixelRatio()) {
      this.#renderer.setPixelRatio(pixelRatio);
      // The composer keeps its own pixel ratio for its render targets.
      this.#post?.setPixelRatio(pixelRatio);
      this.#quality = { ...this.#quality, pixelRatio };
    }
    this.#renderer.setSize(width, height, false);
    this.#post?.setSize(width, height);
    this.#galaxy.setViewportScale(this.#renderer.getDrawingBufferSize(scratchSize).y / 1000);
    this.#updateCameras(width, height);
  }

  #updateCameras(width: number, height: number): void {
    const firstLayout = this.#width === 0;
    this.#width = Math.max(1, width);
    this.#height = Math.max(1, height);
    const aspect = this.#width / this.#height;
    // Portrait screens pull the camera back so more of the galaxy stays in frame.
    this.#targetDistance = CAMERA_DISTANCE + (aspect < 1 ? (1 - aspect) * 4 : 0);
    // Later changes are eased in #update; the very first framing is simply where we start.
    if (firstLayout) this.#cameraDistance = this.#targetDistance;

    for (const camera of [this.#camera, this.#anchorCamera]) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    this.#anchorCamera.position.set(0, 0, this.#targetDistance);
    this.#anchorCamera.lookAt(0, 0, 0);
    this.#anchorCamera.updateMatrixWorld();

    this.#placeGalaxy();
    this.#placeCore();
  }

  /** Where the viewport point (x, y) lands on the plane at depth `planeZ`, in world units. */
  #unproject(x: number, y: number, planeZ: number, out: Vector3): Vector3 {
    const camera = this.#anchorCamera;
    const [ndcX, ndcY] = toNdc(x, y, this.#width, this.#height);
    const direction = scratchDirection
      .copy(scratchPoint.set(ndcX, ndcY, 0.5).unproject(camera))
      .sub(camera.position)
      .normalize();
    const distance = (planeZ - camera.position.z) / direction.z;
    return out.copy(camera.position).addScaledVector(direction, distance);
  }

  /**
   * Keeps the galaxy's bright centre out from behind the glass: beside the card on wide
   * screens (lower left, so the arms still sweep behind it), below the card on tall ones.
   * Only the card's horizontal position is used, so scrolling never moves the galaxy.
   */
  #placeGalaxy(): void {
    const width = this.#width;
    const height = this.#height;
    const portrait = width / height < 1.1;
    const cardWidth = this.#cardRect?.width ?? Math.min(width, 432);
    const cardLeft = this.#cardRect?.left ?? (width - cardWidth) / 2;

    const x = portrait ? width / 2 : cardLeft - cardWidth * 0.2;
    const y = height * (portrait ? 0.86 : 0.66);
    this.#galaxy.points.position.copy(this.#unproject(x, y, GALAXY_PLANE_Z, scratchTarget));
  }

  /**
   * Floats the core over the card's top-left corner, so part of it is seen through the frosted
   * glass and its colour bleeds into the card. On narrow screens it moves to the top-right
   * corner (away from the heading) and it always stays fully inside the viewport.
   */
  #placeCore(): void {
    const rect = this.#cardRect;
    if (rect === null) return;
    const width = this.#width;
    const height = this.#height;
    const camera = this.#anchorCamera;

    const depth = camera.position.z - CORE_PLANE_Z;
    const worldPerPixel = (2 * depth * Math.tan((FOV * Math.PI) / 360)) / height;
    const radiusPx = clamp(Math.min(width, height) * 0.085, 48, 104);

    const narrow = width < 480;
    const cornerX = narrow ? rect.left + rect.width - radiusPx * 0.35 : rect.left;
    const x = clamp(cornerX, radiusPx * 1.1, width - radiusPx * 1.1);
    const y = Math.max(radiusPx * 1.1, rect.top + radiusPx * 0.1);

    this.#core.setTarget(
      this.#unproject(x, y, CORE_PLANE_Z, scratchTarget),
      radiusPx * worldPerPixel,
    );
  }

  /** Frames consistently miss their budget: give up bloom, then refraction, then resolution. */
  #degrade(): void {
    const next = degradeQuality(this.#quality);
    if (!next) {
      // Nothing left to give up: stop adapting. Forgetting the previous profile also keeps a
      // later "restore" verdict from undoing a step that was already kept.
      this.#previousQuality = null;
      this.#quality = { ...this.#quality, adaptive: false };
      return;
    }
    this.#previousQuality = this.#quality;
    this.#applyQuality(next);
  }

  /** The last downgrade did not speed anything up (e.g. a 30 Hz display): undo it. */
  #restore(): void {
    if (!this.#previousQuality) return;
    this.#applyQuality(this.#previousQuality);
    this.#previousQuality = null;
  }

  #applyQuality(next: QualityProfile): void {
    if (next.bloom !== (this.#post !== null)) {
      if (next.bloom) {
        this.#post = createPostProcessing(this.#renderer, this.#scene, this.#camera);
      } else {
        this.#post?.dispose();
        this.#post = null;
      }
      this.#galaxy.setIntensity(next.bloom ? GALAXY_INTENSITY.bloom : GALAXY_INTENSITY.plain);
      this.#core.setBloom(next.bloom);
    }
    if (next.transmission > 0) this.#renderer.transmissionResolutionScale = next.transmission;
    this.#quality = next;
    this.#applySize();
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
