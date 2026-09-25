import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export interface PostProcessing {
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  setPixelRatio(pixelRatio: number): void;
  dispose(): void;
}

/** Subtle bloom: enough to make the core and the brightest stars glow, not to smear text. */
const BLOOM = { strength: 0.62, radius: 0.55, threshold: 0.16 } as const;

/**
 * RenderPass → UnrealBloomPass → OutputPass. The composer renders in linear HDR
 * (half float); OutputPass applies tone mapping and the sRGB transfer at the very end,
 * so bloom operates on physically meaningful values.
 */
export function createPostProcessing(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
): PostProcessing {
  const size = renderer.getSize(new Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  const bloom = new UnrealBloomPass(size, BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  const renderPass = new RenderPass(scene, camera);
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(outputPass);

  return {
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
