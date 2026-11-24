// tbOcean — stylised sea: depth-tinted colour (island heightmap gives the seabed), banded toon
// shading, sky reflection with Fresnel, sharp sun glints, crest foam, animated shore foam lines and
// a soft caustic shimmer in the shallows. Low sun behind a wave lights its crest from inside (translucent
// green-cyan, thinnest at the top), the way painted anime seas glow at sunset.
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
  // light through the crests: strongest looking toward the sun, where the wave is high and thin
  let lh = normalize(globals.sunDir.xyz + n * 0.45);
  let through = pow(saturate(dot(v, -lh)), 3.0);
  let thin = smoothstep(0.35, 0.95, input.vCrest);
  let glow = mix(globals.seaShallow.rgb, vec3f(0.35, 0.95, 0.8), 0.45) * globals.sunColor.rgb;
  col = col + glow * through * thin * (0.55 + 0.45 * shallow) * 1.3 * globals.sunDir.w * (1.0 - fres * 0.6);
  // sun glint: hard-edged anime sparkles
  let h = normalize(globals.sunDir.xyz + v);
  let sp = pow(saturate(dot(n, h)), 380.0);
  col = col + globals.sunColor.rgb * smoothstep(0.25, 0.3, sp) * 3.0 * globals.sunDir.w;
  // foam: whitecaps on the crests, torn into streaks along the wind, and moving lines toward the shore
  let wind = normalize(globals.wind.xy + vec2f(1e-3, 0.0));
  let along = vec2f(dot(p.xz, wind), dot(p.xz, vec2f(-wind.y, wind.x)));
  let streak = gnoise2(along * vec2f(0.35, 2.6) + vec2f(-t * 0.6, 0.0)) * 0.5 + 0.5;
  let tear = gnoise2(along * vec2f(1.4, 5.0) + vec2f(-t * 1.1, 3.0)) * 0.5 + 0.5;
  let crestF = smoothstep(0.5, 0.78, input.vCrest + (streak - 0.5) * 0.25) * (0.3 + globals.sea.w * 0.8);
  let whitecap = crestF * smoothstep(0.35, 0.65, streak * 0.7 + tear * 0.3);
  // wind streaks on the open water in a storm: long thin lines, not blotches
  let lines2 = smoothstep(0.82, 0.92, streak) * smoothstep(0.4, 0.7, tear) * globals.sea.w * 0.35;
  let lines = sin(depth * 2.6 - t * 1.6 + gnoise2(p.xz * 0.6) * 2.0) * 0.5 + 0.5;
  let shoreF = smoothstep(1.4, 0.2, depth) * smoothstep(0.55, 0.8, lines) * uniforms.seaFx.x + smoothstep(0.35, 0.0, depth);
  let foam = saturate(whitecap + lines2 + shoreF * smoothstep(0.3, 0.6, tear + 0.25));
  col = mix(col, vec3f(0.95, 0.98, 1.0) * (0.6 + 0.5 * saturate(ndl + 0.3)) * (globals.sunDir.w * 0.8 + 0.3), saturate(foam * globals.seaColor.w * 1.4));
  col = applyFog(col, p);
  fragmentOutputs.fragData0 = vec4f(col, 1.0);
  let nv = normalize((uniforms.view * vec4f(n, 0.0)).xyz);
  fragmentOutputs.fragData1 = vec4f(encodeNormal(nv), input.vViewZ, uniforms.seaFx.w);
}
