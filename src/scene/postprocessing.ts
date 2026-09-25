import {
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export interface PostProcessing {
  /** The composer's scene target: programs compiled against it match what bloom renders. */
  readonly target: WebGLRenderTarget;
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  setPixelRatio(pixelRatio: number): void;
  dispose(): void;
}

/**
 * Bloom only for what is meant to glow: the glass core's HDR heart and the galaxy's centre
 * are the only values above the threshold. A low threshold and a wide radius turned 30k
 * additive stars into a navy haze over the whole frame.
 */
const BLOOM = { strength: 0.5, radius: 0.35, threshold: 0.6 } as const;

/**
 * RenderPass → UnrealBloomPass → OutputPass. The composer renders in linear HDR
 * (half float); OutputPass applies tone mapping and the sRGB transfer at the very end,
 * so bloom operates on physically meaningful values.
 *
 * With bloom, the 3D content is drawn into the composer's target rather than the canvas, so
 * that target carries the MSAA samples on standard-density screens (the canvas itself is
 * created without antialiasing, see `resolveQuality`).
 */
export function createPostProcessing(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
): PostProcessing {
  const size = renderer.getSize(new Vector2());
  const pixelRatio = renderer.getPixelRatio();
  const target = new WebGLRenderTarget(size.x * pixelRatio, size.y * pixelRatio, {
    type: HalfFloatType,
    samples: pixelRatio < 2 ? 4 : 0,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(size.x, size.y);

  const bloom = new UnrealBloomPass(size, BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  const renderPass = new RenderPass(scene, camera);
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(outputPass);

  return {
    target,
    render: (deltaSeconds) => {
      composer.render(deltaSeconds);
    },
    setSize: (width, height) => {
      composer.setSize(width, height);
    },
    setPixelRatio: (pixelRatio) => {
      composer.setPixelRatio(pixelRatio);
    },
    dispose: () => {
      renderPass.dispose();
      bloom.dispose();
      outputPass.dispose();
      composer.dispose();
    },
  };
}
