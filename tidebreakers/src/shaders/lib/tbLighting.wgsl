// tbLighting — the toon lighting model.
//
// Light is quantised into a lit and a shadow band with a controllable soft terminator. Shadowed colour is
// not black: it is the albedo multiplied by the scene's shadow tint with extra saturation (painted anime
// shadows), and AO only darkens inside that shadow colour. On top: hemisphere ambient, warm skin
// scattering at the terminator, view rim light on the lit side, and stylised highlights per material
// class (hair "angel ring", hard metal glints with a sky/ground reflection band, soft cloth sheen).

const CLS_SKIN: i32 = 0;
const CLS_CLOTH: i32 = 1;
const CLS_HAIR: i32 = 2;
const CLS_METAL: i32 = 3;
const CLS_LEATHER: i32 = 4;
const CLS_GLOW: i32 = 5;
const CLS_WHITE: i32 = 6;
const CLS_WOOD: i32 = 7;

struct ToonInput {
  albedo: vec3f,
  n: vec3f,          // world normal
  v: vec3f,          // world direction to the camera
  pos: vec3f,        // world position
  ao: f32,
  cls: i32,
  shadow: f32,       // 1 lit .. 0 shadowed (sun shadow map)
  rimMask: f32,      // 0 disables rim (inner faces)
  emissive: vec3f,
};

fn toonBand(x: f32, soft: f32) -> f32 {
  let w = mix(0.012, 0.22, soft);
  return smoothstep(-w, w, x);
}

// Painted shadow colour for an albedo: multiplied by the tint, pushed more saturated.
fn shadeColor(albedo: vec3f, tint: vec3f, satBoost: f32) -> vec3f {
  let c = albedo * tint;
  return saturateColor(c, 1.0 + satBoost);
}

fn hemiAmbient(n: vec3f) -> vec3f {
  let t = n.y * 0.5 + 0.5;
  return mix(globals.groundColor.rgb, globals.skyColor.rgb, t * t * (3.0 - 2.0 * t));
}

fn fresnel(n: vec3f, v: vec3f, p: f32) -> f32 { return pow(1.0 - saturate(dot(n, v)), p); }

// Stylised highlight shapes -------------------------------------------------------------------------
fn hairRing(n: vec3f, v: vec3f, l: vec3f, pos: vec3f) -> f32 {
  // A band around the head where the half vector meets the normal, broken into jagged strands.
  let h = normalize(l + v);
  let up = vec3f(0.0, 1.0, 0.0);
  let t = normalize(cross(n, normalize(cross(up, n) + vec3f(1e-4, 0.0, 0.0))));
  let th = dot(t, h);
  let sinth = sqrt(max(1.0 - th * th, 0.0));
  let strand = 0.65 + 0.35 * sin(pos.x * 160.0 + pos.z * 140.0 + pos.y * 30.0);
  let spec = pow(sinth, 60.0) * strand;
  return smoothstep(0.35, 0.55, spec);
}

fn hardSpec(n: vec3f, v: vec3f, l: vec3f, power: f32, cut: f32) -> f32 {
  let h = normalize(l + v);
  return smoothstep(cut, cut + 0.04, pow(saturate(dot(n, h)), power));
}

// Point lights (lanterns, fires, specials): ramped lambert with smooth range falloff.
fn pointLights(pos: vec3f, n: vec3f, albedo: vec3f) -> vec3f {
  var acc = vec3f(0.0);
  let count = i32(globals.counts.x);
  for (var i = 0; i < 12; i++) {
    if (i >= count) { break; }
    let lp = globals.lightPos[i];
    let lc = globals.lightCol[i];
    let d = lp.xyz - pos;
    let dist = length(d);
    let att = sq(saturate(1.0 - dist / max(lp.w, 0.001)));
    let ndl = dot(n, d / max(dist, 1e-4));
    let band = toonBand(ndl, 0.6) * 0.8 + 0.2 * saturate(ndl * 0.5 + 0.5);
    acc = acc + albedo * lc.rgb * lc.w * att * band;
  }
  return acc;
}

fn toonShade(s: ToonInput) -> vec3f {
  let l = globals.sunDir.xyz;
  let ndl = dot(s.n, l);
  let soft = globals.sunColor.w;
  var lit = toonBand(ndl, soft) * s.shadow;
  // skin and hair keep their shadows a touch softer
  if (s.cls == CLS_SKIN) { lit = toonBand(ndl + 0.05, soft + 0.18) * mix(0.35, 1.0, s.shadow); }
  let sunI = globals.sunDir.w;
  let tint = globals.shadowTint.rgb;
  var shadowC = shadeColor(s.albedo, tint, globals.shadowTint.w);
  shadowC = shadowC * mix(0.55, 1.0, s.ao);
  let litC = s.albedo * mix(0.82, 1.0, s.ao) * globals.sunColor.rgb * sunI;
  var col = mix(shadowC, litC, lit);
  // ambient fill
  col = col + s.albedo * hemiAmbient(s.n) * s.ao * 0.35;
  // warm scattering at the terminator on skin
  if (s.cls == CLS_SKIN) {
    let term = exp(-sq((ndl - 0.02) / 0.16)) * (1.0 - lit * 0.5);
    col = col + vec3f(0.55, 0.12, 0.06) * term * 0.22 * s.albedo.r;
  }
  // stylised highlights
  let v = s.v;
  if (s.cls == CLS_HAIR) {
    col = col + mix(s.albedo, vec3f(0.6, 0.75, 0.95), 0.55) * hairRing(s.n, v, l, s.pos) * lit * 0.55;
  } else if (s.cls == CLS_METAL) {
    let r = reflect(-v, s.n);
    let env = mix(globals.groundColor.rgb * 0.6, globals.skyColor.rgb * 1.6, smoothstep(-0.15, 0.25, r.y));
    col = col * 0.55 + s.albedo * env * 0.5;
    col = col + vec3f(1.0, 0.97, 0.9) * hardSpec(s.n, v, l, 60.0, 0.5) * (0.4 + 0.6 * lit) * sunI;
  } else if (s.cls == CLS_LEATHER || s.cls == CLS_WOOD) {
    col = col + s.albedo * hardSpec(s.n, v, l, 18.0, 0.55) * lit * 0.25;
  } else if (s.cls == CLS_WHITE) {
    col = mix(col, s.albedo * (0.85 + 0.15 * lit), 0.6);
  }
  // rim light on the lit side (and a fainter one in shadow)
  let rim = fresnel(s.n, v, 3.0) * smoothstep(0.0, 0.5, dot(s.n, l) + 0.35) * s.rimMask;
  col = col + globals.rimColor.rgb * globals.rimColor.w * smoothstep(0.45, 0.65, rim) * mix(0.35, 1.0, lit);
  col = col + pointLights(s.pos, s.n, s.albedo);
  col = col + s.emissive;
  return col;
}

// Height fog with sun in-scattering and aerial perspective toward the fog colour.
fn applyFog(col: vec3f, wp: vec3f) -> vec3f {
  let cam = globals.camPos.xyz;
  let d = wp - cam;
  let dist = length(d);
  let dens = globals.fogColor.w;
  if (dens <= 0.0) { return col; }
  let fall = globals.fogParams.x;
  let h0 = globals.fogParams.y;
  let start = globals.fogParams.z;
  // integrate exp(-fall*(y-h0)) along the ray
  let dy = d.y;
  let a = exp(-fall * (cam.y - h0));
  var integ = a * dist;
  if (abs(dy) > 0.01) { integ = a * (1.0 - exp(-fall * dy)) / (fall * dy) * dist; }
  let f = 1.0 - exp(-dens * max(integ - start * a, 0.0));
  let sunAmt = pow(saturate(dot(d / max(dist, 1e-3), globals.sunDir.xyz)), 8.0) * globals.fogParams.w;
  let fc = globals.fogColor.rgb + globals.sunColor.rgb * sunAmt;
  return mix(col, fc, saturate(f));
}
