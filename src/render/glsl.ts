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
