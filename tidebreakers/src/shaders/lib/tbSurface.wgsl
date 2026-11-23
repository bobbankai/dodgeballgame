// tbSurface — procedural painted surface detail for scenery classes (world-space, triplanar where
// needed). Each returns a multiplier / colour shift applied to the albedo before toon lighting.
// Requires tbCommon, tbNoise.

const ECLS_PLAIN: i32 = 0;
const ECLS_WOOD: i32 = 1;
const ECLS_STONE: i32 = 2;
const ECLS_ROOF: i32 = 3;
const ECLS_PLASTER: i32 = 4;
const ECLS_FOLIAGE: i32 = 5;
const ECLS_METAL: i32 = 6;
const ECLS_ROCK: i32 = 7;
const ECLS_BRICK: i32 = 8;
const ECLS_SAND: i32 = 9;
const ECLS_GLOW: i32 = 10;
const ECLS_CLOTH: i32 = 11;
const ECLS_MARBLE: i32 = 12;
const ECLS_CORAL: i32 = 13;

fn triplanarW(n: vec3f) -> vec3f {
  var w = pow(abs(n), vec3f(4.0));
  return w / (w.x + w.y + w.z);
}

fn woodGrain(p: vec3f, n: vec3f) -> f32 {
  // planks run along the dominant horizontal axis; grain = stretched noise + plank seams
  let w = triplanarW(n);
  let along = select(p.z, p.x, abs(n.z) > abs(n.x));
  let across = select(p.x, p.z, abs(n.z) > abs(n.x));
  let g = gnoise2(vec2f(along * 1.5, across * 22.0 + p.y * 22.0)) * 0.5 + 0.5;
  let seam = smoothstep(0.035, 0.0, abs(fract(across * 4.0 + p.y * 4.0 * w.y) - 0.5) - 0.465);
  let knot = smoothstep(0.08, 0.0, length(fract(vec2f(along * 0.7, across * 4.0)) - vec2f(0.5)) - 0.04);
  return mix(0.86, 1.06, g) * (1.0 - seam * 0.45) * (1.0 - knot * 0.25);
}

fn stoneCourses(p: vec3f, n: vec3f, scale: f32) -> f32 {
  let w = triplanarW(n);
  let uvx = select(p.zy, p.xy, w.z > w.x) * scale;
  let uv = select(uvx, p.xz * scale, w.y > 0.6);
  let row = floor(uv.y);
  let q = vec2f(uv.x + hash11(row) * 0.7, uv.y);
  let v = voronoi2(q * vec2f(1.0, 1.6));
  let mortar = smoothstep(0.06, 0.0, v.y - v.x);
  let tone = 0.88 + 0.16 * v.z;
  return tone * (1.0 - mortar * 0.5);
}

fn roofTiles(p: vec3f) -> f32 {
  let r = fract(p.y * 7.0 + p.x * 0.0);
  let col = fract(p.x * 4.5 + floor(p.y * 7.0) * 0.5 + p.z * 4.5);
  let lip = smoothstep(0.0, 0.25, r) * 0.25 + 0.75;
  let gap = smoothstep(0.04, 0.0, abs(col - 0.5) - 0.46);
  return lip * (1.0 - gap * 0.35) * (0.92 + 0.1 * hash12(floor(vec2f(p.x * 4.5 + p.z * 4.5, p.y * 7.0))));
}

fn bricks(p: vec3f, n: vec3f) -> f32 {
  let w = triplanarW(n);
  let uv = select(p.zy, p.xy, w.z > w.x) * vec2f(4.0, 8.0);
  let row = floor(uv.y);
  let x = uv.x + select(0.0, 0.5, fract(row * 0.5) > 0.25);
  let fx = fract(x);
  let fy = fract(uv.y);
  let mortar = max(smoothstep(0.06, 0.0, fx) + smoothstep(0.94, 1.0, fx), smoothstep(0.1, 0.0, fy) + smoothstep(0.9, 1.0, fy));
  let tone = 0.85 + 0.2 * hash12(vec2f(floor(x), row));
  return tone * (1.0 - saturate(mortar) * 0.4);
}

fn surfaceDetail(cls: i32, p: vec3f, n: vec3f, albedo: vec3f) -> vec3f {
  var a = albedo;
  if (cls == ECLS_WOOD) { a = a * woodGrain(p, n); }
  else if (cls == ECLS_STONE) { a = a * stoneCourses(p, n, 2.2); }
  else if (cls == ECLS_ROOF) { a = a * roofTiles(p); }
  else if (cls == ECLS_PLASTER) { a = a * (0.93 + 0.1 * fbm3(p * 1.7, 3)) ; }
  else if (cls == ECLS_FOLIAGE) {
    let n1 = fbm3(p * 2.5, 3);
    a = a * (0.8 + 0.35 * n1);
    a = mixOklab(a, a * vec3f(1.2, 1.15, 0.6), saturate(n1 * 0.5 + 0.3) * 0.25);
  }
  else if (cls == ECLS_ROCK) {
    let n1 = fbm3(p * 0.9, 4);
    let strata = 0.5 + 0.5 * sin(p.y * 6.0 + n1 * 3.0);
    a = a * (0.82 + 0.25 * n1) * (0.94 + 0.08 * strata);
    a = mix(a, a * vec3f(0.75, 0.9, 0.7), smoothstep(0.55, 0.95, n.y) * 0.4);   // moss on top
  }
  else if (cls == ECLS_BRICK) { a = a * bricks(p, n); }
  else if (cls == ECLS_SAND) { a = a * (0.94 + 0.08 * gnoise2(p.xz * 3.0)); }
  else if (cls == ECLS_MARBLE) {
    let v = warpFbm2(p.xz * 0.6 + p.y * 0.3, 0.0);
    a = mix(a, a * vec3f(0.82, 0.8, 0.86), smoothstep(0.1, 0.0, abs(v)) * 0.6);
  }
  else if (cls == ECLS_CORAL) { a = a * (0.8 + 0.3 * voronoi3(p * 6.0).x); }
  return a;
}
