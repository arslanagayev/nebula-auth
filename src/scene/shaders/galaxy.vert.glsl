// Spiral galaxy: every star orbits the centre on the GPU, so the CPU never touches the
// 30k-vertex buffer after upload. Radius and angle are recovered from the base position.
// The orbit maths is mirrored by `orbitAngle()` in src/lib/sceneMotion.ts, which unit-tests it.

uniform float uPhase;         // integrated rotation (speed changes stay continuous)
uniform float uClock;         // wall-clock seconds, for twinkle and breathing
uniform float uSize;          // point size in px at a view distance of 1 and a 1000 px tall buffer
uniform float uViewportScale; // drawing-buffer height / 1000: stars keep their size relative to the frame
uniform float uRadius;
uniform vec4 uOrbit;          // rigid speed, max shear, shear rate, swirl twist (see ORBIT)
uniform float uSwirl;         // 0..1, pending request
uniform float uBurst;         // 0..1, decaying success shockwave

attribute vec3 aOffset;
attribute vec3 aColor;
attribute float aScale;

varying vec3 vColor;

void main() {
  float radius = length(position.xz);
  float angle = atan(position.z, position.x);
  float centre = 1.0 - clamp(radius / uRadius, 0.0, 1.0); // 1 at the core, 0 at the rim

  // The arm pattern turns rigidly, like a density wave, and the inner disc sways by a bounded
  // amount. Unbounded differential rotation would wind the arms into a featureless disc.
  angle += uPhase * uOrbit.x + uOrbit.y * centre * centre * sin(uPhase * uOrbit.z);

  // "Pending" vortex: extra twist concentrated near the core plus a slight inward pull.
  angle += uSwirl * uOrbit.w * centre * centre;
  radius *= 1.0 - uSwirl * 0.18 * centre;

  // Success shockwave pushes everything outward, strongest near the centre.
  radius *= 1.0 + uBurst * 0.16 * (0.35 + centre);

  vec3 star = vec3(cos(angle) * radius, 0.0, sin(angle) * radius) + aOffset;
  // Slow vertical breathing keeps the disc from looking like a flat decal.
  star.y += sin(uClock * 0.5 + radius * 1.7) * 0.05 * centre;

  vec4 viewPosition = modelViewMatrix * vec4(star, 1.0);
  gl_Position = projectionMatrix * viewPosition;

  // aScale * 97.0 is a cheap per-star hash: stars of different sizes twinkle out of phase.
  float twinkle = 0.78 + 0.22 * sin(uClock * 1.6 + aScale * 97.0);
  gl_PointSize = uSize * aScale * uViewportScale * twinkle * (1.0 + uBurst * 0.5);
  // Size attenuation: points shrink with distance like real geometry would.
  gl_PointSize *= 1.0 / -viewPosition.z;

  vColor = aColor;
}
