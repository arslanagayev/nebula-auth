import {
  AdditiveBlending,
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
import { IDLE_CORE_COLOR, PALETTE } from './palette';

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
}

const COLOR_LAMBDA = 4;
const POSITION_LAMBDA = 5;

/**
 * The floating "core": a faceted, iridescent glass gem refracting the galaxy, with an
 * emissive heart that pulses in the password strength colour and an orbit ring echoing the
 * Nebula logo.
 */
export class GlassCore {
  readonly group = new Group();

  readonly #spinner = new Group();
  readonly #shell: Mesh<IcosahedronGeometry, MeshPhysicalMaterial>;
  readonly #heart: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly #ring: Mesh<TorusGeometry, MeshBasicMaterial>;
  readonly #halo: Sprite;
  #bloom: boolean;

  readonly #color = new Color(IDLE_CORE_COLOR);
  readonly #targetColor = new Color(IDLE_CORE_COLOR);
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

  constructor({ environment, glow, bloom }: GlassCoreOptions) {
    this.#bloom = bloom;

    this.#shell = new Mesh(
      new IcosahedronGeometry(1, 1),
      new MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.05,
        transmission: 1,
        thickness: 1.3,
        ior: 1.5,
        dispersion: 1.5,
        iridescence: 1,
        iridescenceIOR: 1.33,
        iridescenceThicknessRange: [140, 520],
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        specularIntensity: 1,
        envMap: environment,
        envMapIntensity: 1.35,
        attenuationColor: new Color(IDLE_CORE_COLOR),
        attenuationDistance: 2.4,
        flatShading: true,
      }),
    );

    this.#heart = new Mesh(
      new SphereGeometry(0.36, 32, 16),
      // toneMapped: false lets the colour exceed 1.0 so the bloom pass picks it up.
      new MeshBasicMaterial({ color: new Color(IDLE_CORE_COLOR), toneMapped: false }),
    );

    this.#ring = new Mesh(
      new TorusGeometry(1.6, 0.012, 6, 192),
      new MeshBasicMaterial({
        color: new Color(PALETTE.cyan),
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.#ring.rotation.set(1.18, 0.32, 0);

    this.#halo = new Sprite(
      new SpriteMaterial({
        map: glow,
        color: new Color(IDLE_CORE_COLOR),
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
    this.#bloom = enabled;
    this.#halo.scale.setScalar(enabled ? 4.2 : 5);
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

    const baseIntensity = this.#bloom ? 2.1 : 1.25;
    const intensity = baseIntensity * (0.8 + pulse * 0.4 + energy * 0.5 + burst * 1.2);
    this.#heart.material.color.copy(color).multiplyScalar(intensity);
    this.#heart.scale.setScalar(0.92 + pulse * 0.12 + burst * 0.35);

    const shell = this.#shell.material;
    shell.attenuationColor.copy(color);
    shell.emissive.copy(color).multiplyScalar(0.06 + energy * 0.08);

    this.#halo.material.color.copy(color);
    this.#halo.material.opacity = (this.#bloom ? 0.28 : 0.55) * (0.75 + pulse * 0.35 + burst);
    this.#ring.material.color.copy(color).lerp(this.#success, 0.35);

    const spin = 1 + energy * 3;
    this.#spinner.rotation.x += dt * 0.16 * spin;
    this.#spinner.rotation.y += dt * 0.24 * spin;
    this.#ring.rotation.z += dt * 0.35 * spin;

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
