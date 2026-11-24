// tbSSR — screen-space reflections on the sea, at half resolution. For each water pixel the view ray is
// reflected about the G-buffer normal (which carries the ripples, so reflections wobble) and marched
// through view space, projecting every step back onto the screen and comparing it with the depth stored
// there; the first step that passes just behind a surface is refined by bisection and that pixel's lit
// colour is the reflection. Rays that leave the screen, point back at the camera or travel too far
// fade out, and the sea's own painted-sky reflection shows instead. Output: rgb reflection, a weight.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
varying vUV: vec2f;
var colorTexSampler: sampler;
var colorTex: texture_2d<f32>;
var gbufTexSampler: sampler;
var gbufTex: texture_2d<f32>;
uniform proj: vec4f;   // x tan(fov/2) * aspect, y tan(fov/2), z water object id, w frame index
uniform ssrC: vec4f;   // x max ray length (m), y strength, z base thickness (m), w Fresnel floor
uniform upV: vec4f;    // xyz world up in view space, w how much of the ripple normal survives (calmer = steadier)

const STEPS: i32 = 40;
const REFINE: i32 = 5;

fn viewPos(uv: vec2f, z: f32) -> vec3f {
  let ndc = uv * 2.0 - 1.0;
  return vec3f(ndc.x * uniforms.proj.x * z, ndc.y * uniforms.proj.y * z, z);
}

fn toUv(q: vec3f) -> vec2f {
  let z = max(q.z, 1e-3);
  return vec2f(q.x / (z * uniforms.proj.x), q.y / (z * uniforms.proj.y)) * 0.5 + 0.5;
}

fn sceneZ(uv: vec2f) -> vec2f {
  let g = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0);
  return vec2f(select(1e5, g.z, g.z > 0.0), g.w);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let g = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0);
  fragmentOutputs.color = vec4f(0.0);
  if (g.z <= 0.0 || abs(g.w - uniforms.proj.z) > 0.01) { return fragmentOutputs; }
  let p = viewPos(uv, g.z);
  // reflect about a calmed normal: the ripples still bend the image, but rays stay coherent
  let n = normalize(mix(uniforms.upV.xyz, decodeNormal(g.xy), uniforms.upV.w));
  let vdir = normalize(p);
  let r = reflect(vdir, n);
  // rays heading back toward the camera can't be found on screen
  let away = smoothstep(-0.05, 0.2, r.z);
  if (away <= 0.0) { return fragmentOutputs; }
  let ndv = saturate(dot(n, -vdir));
  let fres = uniforms.ssrC.w + (1.0 - uniforms.ssrC.w) * pow(1.0 - ndv, 3.0);
  // march: steps lengthen with distance from the camera (screen-space detail shrinks with depth)
  let jitter = ign(input.position.xy + vec2f(uniforms.proj.w * 5.3, uniforms.proj.w * 1.7)) * 0.5 + 0.25;
  let maxLen = uniforms.ssrC.x;
  var stepLen = (0.12 + g.z * 0.02) * (0.6 + jitter * 0.8);
  var q = p + n * 0.05;
  var prev = q;
  var hit = false;
  var huv = vec2f(0.0);
  var travelled = 0.0;
  for (var i = 0; i < STEPS; i++) {
    prev = q;
    q = q + r * stepLen;
    travelled = travelled + stepLen;
    stepLen = stepLen * 1.12;
    let suv = toUv(q);
    if (any(suv < vec2f(0.0)) || any(suv > vec2f(1.0)) || travelled > maxLen) { break; }
    let s = sceneZ(suv);
    let behind = q.z - s.x;
    let thick = uniforms.ssrC.z + stepLen * 1.5;
    if (behind > 0.0 && behind < thick && abs(s.y - uniforms.proj.z) > 0.01) {
      // bisect between the last step in front and this one
      var a = prev;
      var b = q;
      for (var k = 0; k < REFINE; k++) {
        let m = (a + b) * 0.5;
        let sm = sceneZ(toUv(m));
        if (m.z > sm.x) { b = m; } else { a = m; }
      }
      huv = toUv(b);
      hit = true;
      break;
    }
  }
  if (!hit) { return fragmentOutputs; }
  // fades: screen edges, ray length, rays grazing back toward the camera
  let edge = smoothstep(0.0, 0.08, huv.x) * smoothstep(1.0, 0.92, huv.x) * smoothstep(0.0, 0.1, huv.y) * smoothstep(1.0, 0.9, huv.y);
  let lenFade = 1.0 - smoothstep(maxLen * 0.55, maxLen, travelled);
  let col = textureSampleLevel(colorTex, colorTexSampler, huv, 0.0).rgb;
  let w = saturate(fres * edge * lenFade * away * uniforms.ssrC.y);
  fragmentOutputs.color = vec4f(col, w);
  return fragmentOutputs;
}
