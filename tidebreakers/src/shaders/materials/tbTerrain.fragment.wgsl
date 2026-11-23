// tbTerrain — painted island ground: wet sand at the waterline, dry sand, grass in two tones with
// painterly clumps, dirt paths, rock on steep faces; toon light, shadows, fog.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
#include<tbShadow>
#include<tbLighting>
#include<tbSurface>
#include<tbSkyModel>
varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vMask: vec4f;
varying vViewZ: f32;
uniform view: mat4x4f;
uniform palA: vec4f;   // grass light rgb, w sand height
uniform palB: vec4f;   // grass dark rgb, w beach width
uniform palC: vec4f;   // sand rgb, w rock slope threshold
uniform palD: vec4f;   // rock rgb, w path strength
uniform palE: vec4f;   // dirt rgb, w object id

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let n = normalize(input.vNormalW);
  let p = input.vPosW;
  let m = input.vMask;
  let sea = globals.sea.x;
  let hgt = p.y - sea;
  let slope = 1.0 - n.y;
  let n1 = fbm2(p.xz * 0.35, 4);
  let n2 = gnoise2(p.xz * 2.2);
  // grass: two tones broken into painterly clumps
  let clump = smoothstep(-0.15, 0.25, n1 + n2 * 0.25);
  var grass = mixOklab(uniforms.palB.rgb, uniforms.palA.rgb, clump * (0.6 + 0.4 * m.g));
  grass = grass * (0.92 + 0.12 * voronoi2(p.xz * 3.0).x);
  // sand: wet near the water
  var sand = uniforms.palC.rgb * (0.95 + 0.07 * n2);
  let wet = smoothstep(0.55, 0.0, hgt);
  sand = mix(sand, sand * vec3f(0.72, 0.7, 0.72), wet);
  let sandAmt = 1.0 - smoothstep(uniforms.palA.w, uniforms.palA.w + uniforms.palB.w, hgt + n1 * 0.6);
  var col = mix(grass, sand, sandAmt);
  // dirt paths
  let path = saturate(m.r * uniforms.palD.w + (n2 * 0.15)) ;
  col = mix(col, uniforms.palE.rgb * (0.9 + 0.12 * n1), smoothstep(0.35, 0.6, path));
  // rock on steep slopes (or painted)
  let rockAmt = max(smoothstep(uniforms.palC.w, uniforms.palC.w + 0.12, slope + n1 * 0.12), m.b);
  let rock = surfaceDetail(ECLS_ROCK, p, n, uniforms.palD.rgb);
  col = mix(col, rock, rockAmt);
  var t: ToonInput;
  t.albedo = col;
  t.n = n;
  t.v = normalize(globals.camPos.xyz - p);
  t.pos = p;
  t.ao = 1.0 - rockAmt * 0.2 * (1.0 - n.y);
  t.cls = CLS_CLOTH;
  t.shadow = sunShadow(p, n, input.position.xy);
  t.rimMask = 0.0;
  t.emissive = vec3f(0.0);
  var c = toonShade(t);
  // rain: puddles in the flat hollows mirror the sky, with rings where drops land
  let rainWet = globals.counts.w;
  if (rainWet > 0.0) {
    let flat = smoothstep(0.9, 0.98, n.y);
    let hollow = smoothstep(0.52, 0.62, fbm2(p.xz * 0.22 + 7.0, 3) * 0.5 + 0.5 + (1.0 - m.g) * 0.1);
    let puddle = flat * hollow * rainWet * (1.0 - rockAmt);
    if (puddle > 0.01) {
      // ripples: each cell has a drop landing on its own clock
      let cellp = p.xz * 2.2;
      let ci = floor(cellp);
      var ring = 0.0;
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          let cc = ci + vec2f(f32(ox), f32(oy));
          let h = hash22(cc);
          let age = fract(globals.time.x * (0.8 + h.x * 0.6) + h.y);
          let d = length(cellp - cc - h);
          ring = ring + smoothstep(0.06, 0.0, abs(d - age * 0.9)) * (1.0 - age);
        }
      }
      let v = normalize(globals.camPos.xyz - p);
      let pn = normalize(vec3f(ring * 0.08, 1.0, ring * 0.05));
      let r = reflect(-v, pn);
      let k = defaultSky();
      let sky = skyGradient(normalize(vec3f(r.x, abs(r.y), r.z)), k);
      let fr = 0.25 + 0.75 * pow(1.0 - saturate(dot(pn, v)), 4.0);
      c = mix(c, sky * 0.85 + c * 0.15, puddle * fr);
      c = c + vec3f(0.8, 0.85, 0.95) * ring * puddle * 0.25;
    }
  }
  // below the sea: absorbed toward the water colour with depth, caustics dancing on the bottom
  let below = globals.sea.x - p.y;
  if (below > 0.0) {
    let absorb = 1.0 - exp(-below * 0.45);
    c = mix(c, globals.seaShallow.rgb * (0.4 + 0.6 * globals.sunDir.w), absorb);
    let tq = globals.time.x;
    let cv = voronoi2(p.xz * 1.3 + vec2f(tq * 0.21, -tq * 0.17));
    let cv2 = voronoi2(p.xz * 1.9 - vec2f(tq * 0.15, tq * 0.12) + 3.0);
    let caus = smoothstep(0.12, 0.0, cv.y - cv.x) * 0.6 + smoothstep(0.1, 0.0, cv2.y - cv2.x) * 0.4;
    c = c + vec3f(0.65, 0.95, 0.9) * caus * exp(-below * 0.35) * 0.45 * globals.sunDir.w * t.shadow;
  }
  c = applyFog(c, p);
  fragmentOutputs.fragData0 = vec4f(c, 1.0);
  let nv = normalize((uniforms.view * vec4f(n, 0.0)).xyz);
  fragmentOutputs.fragData1 = vec4f(encodeNormal(nv), input.vViewZ, uniforms.palE.w);
}
