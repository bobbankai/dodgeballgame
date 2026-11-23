// tbAO — scalable ambient obscurance (after McGuire et al., "Scalable Ambient Obscurance") at half
// resolution, from the G-buffer's view normals and linear view depth. A spiral of taps is distributed over
// a disc whose radius is a fixed world-space size, so occlusion is consistent near and far; each tap's
// contribution falls off with distance and with how far it sits behind the tangent plane. A second
// channel holds a short-range "contact" term used to darken creases where feet meet the ground.
#include<tbGlobals>
#include<tbCommon>
varying vUV: vec2f;
var gbufTexSampler: sampler;
var gbufTex: texture_2d<f32>;
uniform proj: vec4f;     // x tan(fov/2) * aspect, y tan(fov/2), z world radius, w intensity
uniform texel: vec4f;    // xy 1 / full-res size, z frame index, w max view distance

const TAPS: i32 = 14;
const TURNS: f32 = 7.0;

fn viewPos(uv: vec2f, z: f32) -> vec3f {
  let ndc = uv * 2.0 - 1.0;   // post vUV has its origin bottom-left
  return vec3f(ndc.x * uniforms.proj.x * z, ndc.y * uniforms.proj.y * z, z);
}

fn tapLocation(i: i32, spin: f32) -> vec3f {
  // golden spiral: (unit offset, radius fraction)
  let alpha = (f32(i) + 0.5) / f32(TAPS);
  let angle = alpha * (TURNS * 6.2831853) + spin;
  return vec3f(cos(angle), sin(angle), alpha);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let g = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0);
  let z = g.z;
  if (z <= 0.0 || z > uniforms.texel.w) {
    fragmentOutputs.color = vec4f(1.0, 1.0, z, 1.0);
    return fragmentOutputs;
  }
  let n = decodeNormal(g.xy);
  let p = viewPos(uv, z);
  // project the world radius to a screen radius (in uv)
  let radius = uniforms.proj.z;
  let ssR = clamp(radius / (z * uniforms.proj.y * 2.0), 0.002, 0.12);
  let spin = ign(input.position.xy + vec2f(uniforms.texel.z * 5.588238, uniforms.texel.z * 3.1)) * 6.2831853;
  var sum = 0.0;
  var contact = 0.0;
  let r2 = radius * radius;
  let bias = 0.012 * z;
  for (var i = 0; i < TAPS; i++) {
    let t = tapLocation(i, spin);
    let suv = uv + t.xy * vec2f(ssR * uniforms.proj.y / uniforms.proj.x, ssR) * t.z;
    if (any(suv < vec2f(0.0)) || any(suv > vec2f(1.0))) { continue; }
    let sg = textureSampleLevel(gbufTex, gbufTexSampler, suv, 0.0);
    if (sg.z <= 0.0) { continue; }
    let q = viewPos(suv, sg.z);
    let v = q - p;
    let vv = dot(v, v);
    let vn = dot(v, n);
    // falloff: (r^2 - d^2)^3 style smooth window, scaled by the tangent-plane term
    let f = max(r2 - vv, 0.0);
    sum = sum + f * f * f * max((vn - bias) / (0.01 + vv), 0.0);
    // very close occluders only: contact creases
    if (t.z < 0.35) { contact = contact + saturate((vn - bias * 0.5) / (0.02 + vv)) * saturate(1.0 - vv / (r2 * 0.12)); }
  }
  let k = 5.0 * uniforms.proj.w / (r2 * r2 * r2 * f32(TAPS));
  var ao = max(0.0, 1.0 - sum * k);
  // fade out far away and on near-grazing surfaces where the estimate is unreliable
  ao = mix(ao, 1.0, smoothstep(uniforms.texel.w * 0.6, uniforms.texel.w, z));
  let c = 1.0 - saturate(contact / 5.0) * 0.8;
  fragmentOutputs.color = vec4f(ao, c, z, 1.0);
}
