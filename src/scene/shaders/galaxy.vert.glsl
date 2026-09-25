// Spiral galaxy: every star orbits the centre on the GPU, so the CPU never touches the
// 30k-vertex buffer after upload. Radius and angle are recovered from the base position.

uniform float uPhase;      // integrated rotation (speed changes stay continuous)
uniform float uClock;      // wall-clock seconds, for twinkle and breathing
uniform float uSize;
uniform float uPixelRatio;
uniform float uRadius;
uniform float uSwirl;      // 0..1, pending request
uniform float uBurst;      // 0..1, decaying success shockwave

attribute vec3 aOffset;
attribute vec3 aColor;
attribute float aScale;

varying vec3 vColor;

void main() {
  float radius = length(position.xz);
  float angle = atan(position.z, position.x);
  float centre = 1.0 - clamp(radius / uRadius, 0.0, 1.0); // 1 at the core, 0 at the rim

  // Differential rotation: angular velocity falls off with radius (roughly Keplerian),
  // so the arms slowly wind up exactly like a real galaxy.
  angle += uPhase / (0.35 + radius * 0.55);

  // "Pending" vortex: extra twist concentrated near the core plus a slight inward pull.
  angle += uSwirl * 2.2 * centre * centre;
  radius *= 1.0 - uSwirl * 0.18 * centre;

  // Success shockwave pushes everything outward, strongest near the centre.
  radius *= 1.0 + uBurst * 0.16 * (0.35 + centre);

  vec3 star = vec3(cos(angle) * radius, 0.0, sin(angle) * radius) + aOffset;
  // Slow vertical breathing keeps the disc from looking like a flat decal.
  star.y += sin(uClock * 0.5 + radius * 1.7) * 0.05 * centre;

  vec4 viewPosition = modelViewMatrix * vec4(star, 1.0);
  gl_Position = projectionMatrix * viewPosition;

  float twinkle = 0.78 + 0.22 * sin(uClock * 1.6 + aScale * 97.0);
  gl_PointSize = uSize * aScale * uPixelRatio * twinkle * (1.0 + uBurst * 0.5);
  // Size attenuation: points shrink with distance like real geometry would.
  gl_PointSize *= 1.0 / -viewPosition.z;

  vColor = aColor;
}
