/** Shared GLSL helpers: hashing, value noise and fbm. */
export const NOISE = /* glsl */ `
float ibHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float ibNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ibHash(i), ibHash(i + vec3(1, 0, 0)), f.x), mix(ibHash(i + vec3(0, 1, 0)), ibHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(ibHash(i + vec3(0, 0, 1)), ibHash(i + vec3(1, 0, 1)), f.x), mix(ibHash(i + vec3(0, 1, 1)), ibHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float ibFbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * ibNoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
float ibHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/**
 * The sea's waves (keep in step with seaHeight() in src/game/Sea.ts): four travelling waves,
 * scaled up by the storm.
 */
export const WAVES = [
  { amp: 0.32, len: 19.0, dir: [0.8, 0.6], speed: 1.0, phase: 0.0 },
  { amp: 0.2, len: 11.0, dir: [-0.5, 0.86], speed: 1.25, phase: 1.7 },
  { amp: 0.11, len: 6.3, dir: [0.96, -0.28], speed: 1.6, phase: 3.1 },
  { amp: 0.07, len: 3.7, dir: [-0.2, -0.98], speed: 2.1, phase: 4.4 },
];

export const WAVES_GLSL = /* glsl */ `
float seaWaves(vec2 p, float t, float storm) {
  float h = 0.0;
  ${WAVES.map((w) => `h += ${w.amp.toFixed(3)} * sin(dot(p, vec2(${w.dir[0].toFixed(3)}, ${w.dir[1].toFixed(3)})) * ${(
    (2 * Math.PI) / w.len
  ).toFixed(4)} + t * ${w.speed.toFixed(3)} + ${w.phase.toFixed(3)});`).join('\n  ')}
  return h * (1.0 + storm * 1.8);
}
`;
