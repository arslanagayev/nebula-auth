uniform float uIntensity;
uniform vec3 uFlashColor;
uniform float uFlash;      // 0..1, decaying error flash
uniform vec3 uBurstColor;
uniform float uBurst;      // 0..1, decaying success burst

varying vec3 vColor;

void main() {
  // Round, soft point: distance from the sprite centre, eased so the core is bright and
  // the edge fades to nothing (no hard disc outline, no texture lookup).
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float glow = pow(1.0 - d * 2.0, 2.4);

  vec3 color = mix(vColor, uFlashColor, uFlash * 0.7);
  color = mix(color, uBurstColor, uBurst * 0.6);
  color *= uIntensity * (1.0 + uBurst * 0.9 + uFlash * 0.4);

  // Additive blending (src * alpha + dst): overlapping stars accumulate into a glowing core.
  gl_FragColor = vec4(color, glow);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
