// tbWaves — the sea surface (sum of Gerstner waves). Mirrored on the CPU in src/world/Sea.ts so boats
// float and splashes land on the same water. Requires tbGlobals (globals.sea: x level, y amplitude scale,
// z choppiness, w storm 0..1).

struct WaveOut { pos: vec3f, normal: vec3f, crest: f32 };

fn gerstner(p: vec2f, t: f32) -> WaveOut {
  var o: WaveOut;
  var disp = vec3f(0.0);
  var dx = vec3f(1.0, 0.0, 0.0);
  var dz = vec3f(0.0, 0.0, 1.0);
  let amp = globals.sea.y * (1.0 + globals.sea.w * 2.2);
  let chop = globals.sea.z;
  // (direction angle, wavelength, amplitude, speed factor)
  let W = array<vec4f, 6>(
    vec4f(0.3, 24.0, 0.28, 1.0), vec4f(1.4, 13.0, 0.17, 1.1), vec4f(-0.7, 8.5, 0.1, 1.0),
    vec4f(2.3, 5.2, 0.06, 1.2), vec4f(0.9, 3.4, 0.035, 1.3), vec4f(-1.9, 2.1, 0.02, 1.4));
  var crest = 0.0;
  for (var i = 0; i < 6; i++) {
    let w = W[i];
    let d = vec2f(cos(w.x), sin(w.x));
    let k = 6.2831853 / w.y;
    let c = sqrt(9.8 / k) * w.w;
    let a = w.z * amp;
    let f = k * (dot(d, p) - c * t);
    let q = chop * 0.9 / (k * a * 6.0 + 1e-4);
    let sf = sin(f);
    let cf = cos(f);
    disp = disp + vec3f(q * a * d.x * cf, a * sf, q * a * d.y * cf);
    dx = dx + vec3f(-q * d.x * d.x * k * a * sf, d.x * k * a * cf, -q * d.x * d.y * k * a * sf);
    dz = dz + vec3f(-q * d.x * d.y * k * a * sf, d.y * k * a * cf, -q * d.y * d.y * k * a * sf);
    crest = crest + max(sf, 0.0) * a;
  }
  o.pos = vec3f(p.x, globals.sea.x, p.y) + disp;
  o.normal = normalize(cross(dz, dx));
  o.crest = crest;
  return o;
}
