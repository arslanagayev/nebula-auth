import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector4,
  type IUniform,
  type Texture,
} from 'three';
import { mulberry32 } from '../lib/random';
import { ORBIT } from '../lib/sceneMotion';
import { armSpine, DEFAULT_GALAXY, generateGalaxy, type GalaxyParameters } from './galaxyData';
import { PALETTE } from './palette';
import fragmentShader from './shaders/galaxy.frag.glsl?raw';
import vertexShader from './shaders/galaxy.vert.glsl?raw';

/** Fixed seed: the galaxy looks identical on every visit (and in every screenshot). */
const GALAXY_SEED = 20_260_101;
const DUST_SEED = 424_242;
/** Soft gas clouds along the arms: few, large and faint. */
const DUST_CLOUDS = 12;
/** Default point size in px at a view distance of 1 in a 1000 px tall drawing buffer. */
export const POINT_SIZE = 40;

interface GalaxyUniforms {
  [uniform: string]: IUniform;
  uPhase: IUniform<number>;
  uClock: IUniform<number>;
  uSize: IUniform<number>;
  uViewportScale: IUniform<number>;
  uRadius: IUniform<number>;
  uOrbit: IUniform<Vector4>;
  uSwirl: IUniform<number>;
  uBurst: IUniform<number>;
  uFlash: IUniform<number>;
  uIntensity: IUniform<number>;
  uFlashColor: IUniform<Color>;
  uBurstColor: IUniform<Color>;
}

export interface GalaxyFrame {
  readonly phase: number;
  readonly clock: number;
  readonly swirl: number;
  readonly burst: number;
  readonly flash: number;
}

export interface GalaxyOptions {
  readonly count: number;
  /** Brightness multiplier; slightly higher when there is no bloom pass to add glow. */
  readonly intensity: number;
  /** Point size (see {@link POINT_SIZE}); larger when fewer stars have to fill the arms. */
  readonly pointSize?: number;
  /** Soft round sprite for the dust clouds. */
  readonly sprite: Texture;
}

export class Galaxy {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly #uniforms: GalaxyUniforms;
  /** Faint gas clouds that turn with the arm pattern. */
  readonly #dust = new Group();

  constructor({ count, intensity, sprite, pointSize = POINT_SIZE }: GalaxyOptions) {
    const params: GalaxyParameters = { ...DEFAULT_GALAXY, count };
    const data = generateGalaxy(params, mulberry32(GALAXY_SEED));

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('aOffset', new BufferAttribute(data.offsets, 3));
    geometry.setAttribute('aColor', new BufferAttribute(data.colors, 3));
    geometry.setAttribute('aScale', new BufferAttribute(data.scales, 1));

    this.#uniforms = {
      uPhase: { value: 0 },
      uClock: { value: 0 },
      uSize: { value: pointSize },
      uViewportScale: { value: 1 },
      uRadius: { value: params.radius },
      uOrbit: { value: new Vector4(ORBIT.rigid, ORBIT.shear, ORBIT.shearRate, ORBIT.swirlTwist) },
      uSwirl: { value: 0 },
      uBurst: { value: 0 },
      uFlash: { value: 0 },
      uIntensity: { value: intensity },
      uFlashColor: { value: new Color(PALETTE.danger) },
      uBurstColor: { value: new Color(PALETTE.success) },
    };

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.#uniforms,
      blending: AdditiveBlending,
      depthWrite: false,
      // Kept in the opaque render list on purpose: additive blending still applies, and it
      // lets the transmissive glass core refract the galaxy (three.js only feeds opaque
      // objects into the transmission pass).
      transparent: false,
    });

    this.points = new Points(geometry, material);
    // Stars move in the vertex shader, so the CPU-side bounding sphere would be wrong.
    this.points.frustumCulled = false;

    this.#createDust(params, sprite);
    this.points.add(this.#dust);
  }

  /** Drawing-buffer height / 1000, so stars keep their size relative to the frame. */
  setViewportScale(scale: number): void {
    this.#uniforms.uViewportScale.value = scale;
  }

  setIntensity(intensity: number): void {
    this.#uniforms.uIntensity.value = intensity;
  }

  update(frame: GalaxyFrame): void {
    const uniforms = this.#uniforms;
    uniforms.uPhase.value = frame.phase;
    uniforms.uClock.value = frame.clock;
    uniforms.uSwirl.value = frame.swirl;
    uniforms.uBurst.value = frame.burst;
    uniforms.uFlash.value = frame.flash;
    // The clouds follow the rigid part of the orbit (see galaxy.vert.glsl); a positive
    // shader angle is a negative rotation about Y.
    this.#dust.rotation.y = -frame.phase * ORBIT.rigid;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
    for (const cloud of this.#dust.children) {
      if (cloud instanceof Sprite) cloud.material.dispose();
    }
  }

  #createDust(params: GalaxyParameters, sprite: Texture): void {
    const random = mulberry32(DUST_SEED);
    const violet = new Color(PALETTE.violet);
    const pink = new Color(PALETTE.pink);
    for (let i = 0; i < DUST_CLOUDS; i += 1) {
      const distance = 1.3 + random() * (params.radius * 0.62);
      const spine = armSpine(params, i % params.branches, distance);
      const cloud = new Sprite(
        new SpriteMaterial({
          map: sprite,
          color: i % 2 === 0 ? violet : pink,
          blending: AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.06 + random() * 0.06,
        }),
      );
      cloud.position.set(spine.x, (random() - 0.5) * 0.2, spine.z);
      cloud.scale.setScalar(3 + random() * 2);
      this.#dust.add(cloud);
    }
  }
}
