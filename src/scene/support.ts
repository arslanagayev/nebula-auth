/**
 * Feature detection for the WebGL layer. Deliberately free of three.js imports so it can
 * live in the main bundle and decide whether the heavy scene chunk is worth downloading.
 */
export function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    // Software rasterisers (SwiftShader, llvmpipe) report a "major performance caveat".
    // The animated CSS background looks better than a 10 fps galaxy.
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
