// tbParticle — procedural particle shapes (no textures): glow, star spark, shock ring, smoke puff, streak,
// wind arc, droplet, shard, ink burst, telegraph ring. Output is additive HDR (blooms).
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
varying vUV: vec2f;
varying vInfo: vec4f;
varying vCol: vec4f;
varying vWorld: vec3f;

fn star(p: vec2f, points: f32, sharp: f32) -> f32 {
  let a = atan2(p.y, p.x);
  let r = length(p);
  let s = pow(abs(cos(a * points * 0.5)), sharp) * 0.85 + 0.15;
  return saturate(1.0 - r / (0.5 * s));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let p = input.vUV - 0.5;
  let r = length(p) * 2.0;
  let life = input.vInfo.y;
  let shape = i32(input.vInfo.z + 0.5);
  var a = 0.0;
  var col = input.vCol.rgb;
  if (shape == 0) {            // soft glow
    a = pow(saturate(1.0 - r), 2.2);
  } else if (shape == 1) {     // 4-point star spark with a hot core
    a = star(p, 4.0, 18.0) + pow(saturate(1.0 - r), 6.0);
    col = mix(col, vec3f(1.0), pow(saturate(1.0 - r * 1.5), 3.0));
  } else if (shape == 2) {     // shock ring (thins as it grows)
    let w = mix(0.22, 0.04, life);
    a = smoothstep(w, 0.0, abs(r - 0.82)) * smoothstep(1.0, 0.9, r);
  } else if (shape == 3) {     // smoke puff: lumpy noisy disc, darker centre
    let n = fbm2(p * 4.0 + vec2f(input.vInfo.x * 3.0, life * 0.7), 3) * 0.5;
    a = smoothstep(0.95, 0.4, r + n * 0.6) * 0.75;
    col = col * (0.75 + 0.25 * smoothstep(0.0, 0.8, r));
  } else if (shape == 4) {     // streak (velocity aligned elongated glow)
    let q = vec2f(p.x * 2.0, p.y);
    a = pow(saturate(1.0 - length(q) * 2.0), 1.6);
  } else if (shape == 5) {     // wind arc: a crescent band
    let ang = atan2(p.y, p.x);
    let band = smoothstep(0.08, 0.0, abs(r - 0.72)) * smoothstep(-0.2, 1.2, sin(ang + 1.2));
    let streaks = 0.6 + 0.4 * sin(ang * 9.0 + life * 20.0);
    a = band * streaks;
  } else if (shape == 6) {     // droplet with highlight
    a = smoothstep(1.0, 0.75, r);
    col = mix(col * 0.75, vec3f(1.0), smoothstep(0.35, 0.0, length(p - vec2f(-0.12, 0.12))));
  } else if (shape == 7) {     // shard (triangle)
    let q = p * 2.0;
    let d = max(abs(q.x) * 1.7 + q.y, -q.y - 0.5);
    a = smoothstep(0.5, 0.42, d);
  } else if (shape == 8) {     // ink splash: jagged blob (anime impact)
    let ang = atan2(p.y, p.x);
    let edge = 0.62 + 0.25 * sin(ang * 7.0 + input.vInfo.x * 5.0) * sin(ang * 3.0 + 1.3);
    a = smoothstep(edge, edge - 0.08, r);
  } else if (shape == 9) {     // telegraph ring with a pulsing fill
    let ring = smoothstep(0.07, 0.0, abs(r - 0.9));
    let fill = smoothstep(1.0, 0.85, r) * (0.18 + 0.18 * sin(globals.time.x * 18.0));
    a = ring + fill * smoothstep(0.0, 1.0, life);
  } else {                     // glyph sparkle
    a = star(p, 6.0, 10.0);
  }
  // fade in quickly, out over life
  let fade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.65, 1.0, life));
  a = a * input.vCol.a * fade;
  if (a < 0.003) { discard; }
  fragmentOutputs.fragData0 = vec4f(col * a, a);
  fragmentOutputs.fragData1 = vec4f(0.0);
}
