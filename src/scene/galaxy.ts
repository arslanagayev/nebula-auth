import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type IUniform,
} from 'three';
import { mulberry32 } from '../lib/random';
import { DEFAULT_GALAXY, generateGalaxy, type GalaxyParameters } from './galaxyData';
import { PALETTE } from './palette';
import fragmentShader from './shaders/galaxy.frag.glsl?raw';
import vertexShader from './shaders/galaxy.vert.glsl?raw';

/** Fixed seed: the galaxy looks identical on every visit (and in every screenshot). */
const GALAXY_SEED = 20_260_101;

interface GalaxyUniforms {
  [uniform: string]: IUniform;
  uPhase: IUniform<number>;
  uClock: IUniform<number>;
  uSize: IUniform<number>;
  uPixelRatio: IUniform<number>;
  uRadius: IUniform<number>;
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
  readonly pixelRatio: number;
  /** Brightness multiplier; slightly higher when there is no bloom pass to add glow. */
  readonly intensity: number;
}

export class Galaxy {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly #uniforms: GalaxyUniforms;

  constructor({ count, pixelRatio, intensity }: GalaxyOptions) {
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
      uSize: { value: 34 },
      uPixelRatio: { value: pixelRatio },
      uRadius: { value: params.radius },
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
  }

  setPixelRatio(pixelRatio: number): void {
    this.#uniforms.uPixelRatio.value = pixelRatio;
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
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
