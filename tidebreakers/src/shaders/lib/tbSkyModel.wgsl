// tbSkyModel — the stylised sky shared by the sky dome, water reflections and fog colour.
// A painted gradient (horizon glow, zenith), a sun disc with a soft halo, and a band of drifting
// toon clouds with lit rims. Requires tbGlobals, tbCommon, tbNoise.

struct SkyLook {
  zenith: vec3f,
  horizon: vec3f,
  ground: vec3f,
  sunGlow: vec3f,
  cloudLit: vec3f,
  cloudShade: vec3f,
  cloudCover: f32,
  cloudHeight: f32,
};

fn skyGradient(dir: vec3f, k: SkyLook) -> vec3f {
  let y = dir.y;
  let up = pow(saturate(y), 0.45);
  var c = mix(k.horizon, k.zenith, up);
  // below the horizon: fade into the ground/sea haze colour
  c = mix(c, k.ground, smoothstep(0.0, -0.18, y));
  let s = globals.sunDir.xyz;
  let mu = saturate(dot(dir, s));
  // broad warm glow around the sun, stronger near the horizon
  c = c + k.sunGlow * (pow(mu, 6.0) * 0.45 + pow(mu, 48.0) * 0.6) * (1.0 - up * 0.6);
  return c;
}

fn sunDisc(dir: vec3f, size: f32) -> f32 {
  let mu = dot(dir, globals.sunDir.xyz);
  let r = 1.0 - mu;
  return smoothstep(size * 1.2, size * 0.7, r);
}

// Toon clouds: a sheet of domain-warped noise above the horizon, thresholded into soft-edged shapes,
// lit from the sun direction with a bright rim where the sun is behind them.
fn skyClouds(dir: vec3f, k: SkyLook, t: f32) -> vec4f {
  if (dir.y < 0.0) { return vec4f(0.0); }
  let h = k.cloudHeight;
  let p = dir.xz / (dir.y + 0.12) * h;
  let drift = vec2f(t * 0.004, t * 0.0015);
  let q = p * 0.35 + drift;
  let n = warpFbm2(q, t * 0.05) * 0.5 + 0.5;
  let detail = fbm2(q * 4.0 + 3.0, 3) * 0.5 + 0.5;
  let cover = k.cloudCover;
  let dens = smoothstep(1.0 - cover, 1.0 - cover + 0.18, n * 0.85 + detail * 0.15);
  // fake lighting: sample the field toward the sun
  let sd = normalize(globals.sunDir.xz + vec2f(1e-4));
  let n2 = warpFbm2(q + sd * 0.08, t * 0.05) * 0.5 + 0.5;
  let shade = saturate((n2 - n) * 6.0 + 0.55);
  var col = mix(k.cloudShade, k.cloudLit, smoothstep(0.35, 0.7, shade));
  // silver lining toward the sun
  let mu = saturate(dot(dir, globals.sunDir.xyz));
  col = col + k.sunGlow * pow(mu, 10.0) * (1.0 - dens) * 2.0;
  let fade = smoothstep(0.0, 0.12, dir.y);
  return vec4f(col, dens * fade);
}

fn defaultSky() -> SkyLook {
  var k: SkyLook;
  k.zenith = globals.skyColor.rgb * 0.9;
  k.horizon = mix(globals.fogColor.rgb, globals.skyColor.rgb, 0.25) * 1.1;
  k.ground = globals.fogColor.rgb * 0.8;
  k.sunGlow = globals.sunColor.rgb * 0.6;
  k.cloudLit = vec3f(1.0, 0.98, 0.95) * mix(vec3f(1.0), globals.sunColor.rgb, 0.4) * 1.1;
  k.cloudShade = mix(globals.skyColor.rgb, globals.shadowTint.rgb, 0.5) * 0.85;
  k.cloudCover = 0.45;
  k.cloudHeight = 1.0;
  return k;
}
