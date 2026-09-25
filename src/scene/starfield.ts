import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  type Texture,
} from 'three';
import { mulberry32 } from '../lib/random';
import { PALETTE } from './palette';

const STARFIELD_SEED = 7;

/**
 * Distant background stars on a thick spherical shell. Static geometry: the parallax
 * camera movement alone is enough to give them depth.
 */
export class Starfield {
  readonly points: Points<BufferGeometry, PointsMaterial>;

  constructor(count: number, sprite: Texture) {
    const random = mulberry32(STARFIELD_SEED);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const white = new Color('#ffffff');
    const cyan = new Color(PALETTE.cyan);
    const pink = new Color(PALETTE.pink);

    for (let i = 0; i < count; i += 1) {
      // Uniform direction on a sphere (inverse transform sampling), radius 18–40.
      const u = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const radius = 18 + random() * 22;
      const ring = Math.sqrt(1 - u * u);
      positions[i * 3] = ring * Math.cos(theta) * radius;
      positions[i * 3 + 1] = u * radius;
      positions[i * 3 + 2] = ring * Math.sin(theta) * radius;

      const pick = random();
      const tint = pick < 0.85 ? white : pick < 0.93 ? cyan : pink;
      const brightness = 0.25 + random() * 0.75;
      colors[i * 3] = tint.r * brightness;
      colors[i * 3 + 1] = tint.g * brightness;
      colors[i * 3 + 2] = tint.b * brightness;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));

    const material = new PointsMaterial({
      size: 0.16,
      map: sprite,
      vertexColors: true,
      sizeAttenuation: true,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    this.points = new Points(geometry, material);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
