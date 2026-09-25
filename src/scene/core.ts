import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type Texture,
} from 'three';
import { damp } from '../lib/math';
import { PALETTE } from './palette';

export interface CoreFrame {
  readonly dt: number;
  readonly clock: number;
  /** 0..1 — how "busy" the scene is (a request is pending). */
  readonly energy: number;
  /** 0..1 — decaying success burst. */
  readonly burst: number;
  /** 0..1 — decaying error flash. */
  readonly flash: number;
}

export interface GlassCoreOptions {
  readonly environment: Texture;
  readonly glow: Texture;
  /** With bloom the heart can rely on HDR glow; without it, the sprite halo does the work. */
  readonly bloom: boolean;
  /**
   * Real refraction through three.js' transmission pass. Without it (low-end devices) the
   * shell is a thin, reflective bubble instead, which costs no extra render pass.
   */
  readonly transmission: boolean;
}

const COLOR_LAMBDA = 4;
const POSITION_LAMBDA = 5;
const RING_SEGMENTS = 192;

/** Visual tuning with and without the bloom pass. */
const LOOK = {
  bloom: { heart: 1.25, halo: 0.18, haloScale: 4.2, emissive: 0.12 },
  plain: { heart: 1.1, halo: 0.45, haloScale: 5, emissive: 0.2 },
} as const;

/**
 * An orbit ring whose brightness falls off behind a bright head, like a comet's tail. As the
 * ring turns, the head travels around the core, so it reads as an orbit in 3D rather than a
 * flat outline (and does not repeat the logo's even ring).
 */
function createOrbitRing(): TorusGeometry {
  const geometry = new TorusGeometry(1.35, 0.012, 6, RING_SEGMENTS);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    // TorusGeometry emits (tubular segments + 1) vertices per radial ring, in order.
    const along = (index % (RING_SEGMENTS + 1)) / RING_SEGMENTS;
    const brightness = 0.06 + 0.94 * along ** 3;
    colors.fill(brightness, index * 3, index * 3 + 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/**
 * The floating "core": a smooth, iridescent glass orb refracting the galaxy, with an emissive
 * heart that pulses in the password strength colour and an orbiting comet ring.
 */
export class GlassCore {
  readonly group = new Group();

  readonly #spinner = new Group();
  readonly #shell: Mesh<IcosahedronGeometry, MeshPhysicalMaterial>;
  readonly #heart: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly #ring: Mesh<TorusGeometry, MeshBasicMaterial>;
  readonly #halo: Sprite;
  #look: (typeof LOOK)[keyof typeof LOOK] = LOOK.bloom;

  readonly #color = new Color(PALETTE.violet);
  readonly #targetColor = new Color(PALETTE.violet);
  readonly #scratch = new Color();
  readonly #danger = new Color(PALETTE.danger);
  readonly #success = new Color(PALETTE.success);

  readonly #position = new Vector3();
  readonly #targetPosition = new Vector3();
  #scale = 1;
  #targetScale = 1;
  #hasTarget = false;
  #pulseRate = 1.1;
  #targetPulseRate = 1.1;
  #pulsePhase = 0;

  constructor({ environment, glow, bloom, transmission }: GlassCoreOptions) {
    this.#shell = new Mesh(
      // Smooth glass reads as premium; flat facets looked like a low-poly disco ball.
      new IcosahedronGeometry(1, 12),
      new MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.12,
        transmission: transmission ? 1 : 0,
        transparent: !transmission,
        opacity: transmission ? 1 : 0.4,
        thickness: 0.9,
        ior: 1.5,
        dispersion: 0.35,
        iridescence: 1,
        iridescenceIOR: 1.33,
        iridescenceThicknessRange: [100, 400],
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        specularIntensity: 1,
        envMap: environment,
        envMapIntensity: 1,
        attenuationColor: new Color(PALETTE.violet),
        attenuationDistance: 2.4,
      }),
    );

    this.#heart = new Mesh(
      new SphereGeometry(0.3, 32, 16),
      // toneMapped: false lets the colour exceed 1.0 so the bloom pass picks it up.
      new MeshBasicMaterial({ color: new Color(PALETTE.violet), toneMapped: false }),
    );

    this.#ring = new Mesh(
      createOrbitRing(),
      new MeshBasicMaterial({
        color: new Color(PALETTE.cyan),
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.#ring.rotation.set(1.35, 0.32, 0);

    this.#halo = new Sprite(
      new SpriteMaterial({
        map: glow,
        color: new Color(PALETTE.violet),
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.setBloom(bloom);

    this.#spinner.add(this.#shell, this.#heart);
    this.group.add(this.#halo, this.#spinner, this.#ring);
  }

  /** With bloom the heart glows through HDR; without it, a larger sprite halo takes over. */
  setBloom(enabled: boolean): void {
    this.#look = enabled ? LOOK.bloom : LOOK.plain;
    this.#halo.scale.setScalar(this.#look.haloScale);
  }

  /** Swaps the reflection map, e.g. after the WebGL context was restored. */
  setEnvironment(environment: Texture): void {
    this.#shell.material.envMap = environment;
    this.#shell.material.needsUpdate = true;
  }

  /** Target colour and pulse rate (Hz); both ease in over a few frames. */
  setColor(color: string, pulseRate: number): void {
    this.#targetColor.set(color);
    this.#targetPulseRate = pulseRate;
  }

  /** Where the core should float, in world units. The first call places it immediately. */
  setTarget(position: Vector3, scale: number): void {
    this.#targetPosition.copy(position);
    this.#targetScale = scale;
    if (!this.#hasTarget) {
      this.#hasTarget = true;
      this.snap();
    }
  }

  /** Jump straight to the targets (reduced motion, first placement). */
  snap(): void {
    this.#position.copy(this.#targetPosition);
    this.#scale = this.#targetScale;
    this.#color.copy(this.#targetColor);
    this.#pulseRate = this.#targetPulseRate;
  }

  update({ dt, clock, energy, burst, flash }: CoreFrame): void {
    const look = this.#look;
    const easeColor = 1 - Math.exp(-COLOR_LAMBDA * dt);
    this.#color.lerp(this.#targetColor, easeColor);
    this.#pulseRate = damp(this.#pulseRate, this.#targetPulseRate, 3, dt);
    this.#pulsePhase += dt * this.#pulseRate * Math.PI * 2;
    const pulse = 0.5 + 0.5 * Math.sin(this.#pulsePhase);

    this.#position.lerp(this.#targetPosition, 1 - Math.exp(-POSITION_LAMBDA * dt));
    this.#scale = damp(this.#scale, this.#targetScale, POSITION_LAMBDA, dt);

    // Error flashes pull the colour towards red, success towards cyan-green.
    const color = this.#scratch.copy(this.#color);
    color.lerp(this.#danger, flash * 0.8).lerp(this.#success, burst * 0.7);

    const intensity = look.heart * (0.8 + pulse * 0.4 + energy * 0.5 + burst * 1.2);
    this.#heart.material.color.copy(color).multiplyScalar(intensity);
    this.#heart.scale.setScalar(0.92 + pulse * 0.12 + burst * 0.35);

    // The strength colour also tints the glass body itself, so it survives without bloom
    // and no facet ever renders black.
    const shell = this.#shell.material;
    shell.attenuationColor.copy(color);
    shell.emissive.copy(color).multiplyScalar(look.emissive + energy * 0.1);

    this.#halo.material.color.copy(color);
    this.#halo.material.opacity = look.halo * (0.75 + pulse * 0.35 + burst);
    this.#ring.material.color.copy(color).lerp(this.#success, 0.35);

    const spin = 1 + energy * 3;
    this.#spinner.rotation.x += dt * 0.16 * spin;
    this.#spinner.rotation.y += dt * 0.24 * spin;
    this.#ring.rotation.z += dt * 0.5 * spin;

    const bob = Math.sin(clock * 0.9) * 0.08;
    this.group.position.set(
      this.#position.x,
      this.#position.y + bob * this.#scale,
      this.#position.z,
    );
    this.group.scale.setScalar(this.#scale * (1 + burst * 0.12));
  }

  dispose(): void {
    this.#shell.geometry.dispose();
    this.#shell.material.dispose();
    this.#heart.geometry.dispose();
    this.#heart.material.dispose();
    this.#ring.geometry.dispose();
    this.#ring.material.dispose();
    this.#halo.material.dispose();
  }
}
