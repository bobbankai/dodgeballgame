// tbOcean — stylised sea: depth-tinted colour (island heightmap gives the seabed), banded toon
// shading, sky reflection with Fresnel, sharp sun glints, crest foam, animated shore foam lines and
// a soft caustic shimmer in the shallows.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
#include<tbSkyModel>
#include<tbLighting>
varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vCrest: f32;
varying vViewZ: f32;
varying vBase: vec2f;
uniform view: mat4x4f;
uniform seabed: vec4f;    // xy heightmap origin (world), z world size, w height scale
uniform seaFx: vec4f;     // x foam lines strength, y caustics, z reflection, w object id
var heightTexSampler: sampler;
var heightTex: texture_2d<f32>;

fn bedHeight(p: vec2f) -> f32 {
  let uv = (p - uniforms.seabed.xy) / uniforms.seabed.z;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return -40.0; }
  return (textureSampleLevel(heightTex, heightTexSampler, uv, 0.0).r - 0.5) * uniforms.seabed.w;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let p = input.vPosW;
  let t = globals.time.x;
  // small normal detail
  let dn = vec2f(gnoise2(p.xz * 0.9 + vec2f(t * 0.3, 0.0)), gnoise2(p.xz * 0.9 + vec2f(0.0, t * 0.27) + 7.0)) * 0.12
         + vec2f(gnoise2(p.xz * 3.1 - vec2f(t * 0.6, 0.0)), gnoise2(p.xz * 3.1 + vec2f(3.0, -t * 0.5))) * 0.05;
  var n = normalize(input.vNormalW + vec3f(dn.x, 0.0, dn.y));
  let v = normalize(globals.camPos.xyz - p);
  let bed = bedHeight(p.xz);
  let depth = max(p.y - bed, 0.0);
  let shallow = 1.0 - smoothstep(0.0, 6.0, depth);
  var water = mix(globals.seaColor.rgb, globals.seaShallow.rgb, shallow * shallow);
  // banded toon light on the water body
  let ndl = dot(n, globals.sunDir.xyz);
  let band = smoothstep(0.1, 0.2, ndl) * 0.35 + 0.65;
  water = water * band * (globals.sunColor.rgb * globals.sunDir.w * 0.6 + hemiAmbient(n) * 0.6);
  // caustics in the shallows
  let cv = voronoi2(p.xz * 1.6 + vec2f(t * 0.25, -t * 0.18));
  let caus = smoothstep(0.08, 0.0, cv.y - cv.x) * shallow * uniforms.seaFx.y;
  water = water + vec3f(0.7, 1.0, 0.95) * caus * 0.35 * globals.sunDir.w;
  // reflection of the painted sky
  let r = reflect(-v, n);
  var k = defaultSky();
  let sky = skyGradient(normalize(vec3f(r.x, abs(r.y), r.z)), k);
  let fres = 0.04 + 0.96 * pow(1.0 - saturate(dot(n, v)), 5.0);
  var col = mix(water, sky, fres * uniforms.seaFx.z);
  // sun glint: hard-edged anime sparkles
  let h = normalize(globals.sunDir.xyz + v);
  let sp = pow(saturate(dot(n, h)), 380.0);
  col = col + globals.sunColor.rgb * smoothstep(0.25, 0.3, sp) * 3.0 * globals.sunDir.w;
  // foam: crests, and moving lines toward the shore
  let crestF = smoothstep(0.42, 0.7, input.vCrest + gnoise2(p.xz * 1.5 + t * 0.2) * 0.12) * (0.35 + globals.sea.w * 0.9);
  let lines = sin(depth * 2.6 - t * 1.6 + gnoise2(p.xz * 0.6) * 2.0) * 0.5 + 0.5;
  let shoreF = smoothstep(1.4, 0.2, depth) * smoothstep(0.55, 0.8, lines) * uniforms.seaFx.x + smoothstep(0.35, 0.0, depth);
  let foam = saturate(crestF + shoreF) * smoothstep(-0.2, 0.4, gnoise2(p.xz * 3.5 + vec2f(t * 0.4, 0.0)) + 0.3);
  col = mix(col, vec3f(0.95, 0.98, 1.0) * (0.6 + 0.5 * saturate(ndl + 0.3)) * (globals.sunDir.w * 0.8 + 0.3), saturate(foam * globals.seaColor.w * 1.4));
  col = applyFog(col, p);
  fragmentOutputs.fragData0 = vec4f(col, 1.0);
  let nv = normalize((uniforms.view * vec4f(n, 0.0)).xyz);
  fragmentOutputs.fragData1 = vec4f(encodeNormal(nv), input.vViewZ, uniforms.seaFx.w);
}
