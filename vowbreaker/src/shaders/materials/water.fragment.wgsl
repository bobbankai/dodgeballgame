// Stage water (src/render/Water.ts): fragment stage (vb_water_toon). The water column's colour by
// how much water lies in front of the scene (G-buffer depth), a stepped sky reflection, sun glints,
// shore foam and whitecaps, caustics in the shallows, rain rings, and pond life (lily pads, koi) or
// leaves on a canal; an ink line where the water meets the land. Alpha blended over the scene.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_lighting>
#include<vb_water>
#include<vb_water_toon>

varying vWorld: vec3f;
varying vNormalW: vec3f;
varying vCrest: f32;
varying vViewZ: f32;
varying vUV: vec2f;

uniform cameraPosition: vec3f;
uniform waterParams: vec4f;    // time, wave amplitude, wave length, kind
uniform waterParams2: vec4f;   // depth scale, flow x, flow z, rain
uniform shallowColor: vec3f;
uniform deepColor: vec3f;
uniform foamColor: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyColor: vec3f;
uniform horizonColor: vec3f;
uniform screenSize: vec2f;
uniform waterSize: vec4f;      // grid size x, z (m), rim slope (m of depth per m from the rim), -

var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let t = uniforms.waterParams.x;
    let kind = i32(uniforms.waterParams.w + 0.5);
    let P = fragmentInputs.vWorld;
    let V = normalize(uniforms.cameraPosition - P);
    var look: WaterLook;
    look.shallow = uniforms.shallowColor;
    look.deep = uniforms.deepColor;
    look.foam = uniforms.foamColor;
    look.depthScale = uniforms.waterParams2.x;
    look.flow = uniforms.waterParams2.yz;
    look.kind = kind;

    // how much water lies between the surface and the scene behind it
    let suv = vec2f(fragmentInputs.position.x / uniforms.screenSize.x, 1.0 - fragmentInputs.position.y / uniforms.screenSize.y);
    let sceneZ = textureSampleLevel(gbuffer, gbufferSampler, suv, 0.0).b;
    let viewThick = max(sceneZ - fragmentInputs.vViewZ, 0.0);
    // the vertical depth under the surface is less than the view path through it
    var thickness = viewThick * max(abs(V.y), 0.2);
    // a pond sits flush with the ground: its depth comes from how far a point is from its rim
    if (uniforms.waterSize.z > 0.0) {
        let rim = min(min(fragmentInputs.vUV.x, 1.0 - fragmentInputs.vUV.x) * uniforms.waterSize.x, min(fragmentInputs.vUV.y, 1.0 - fragmentInputs.vUV.y) * uniforms.waterSize.y);
        thickness = max(min(thickness, 0.02 + rim * uniforms.waterSize.z), min(rim * uniforms.waterSize.z, look.depthScale * 1.5));
    }

    // the surface normal: waves, wind ripples, rain rings
    var n = fragmentInputs.vNormalW;
    let detail = waterDetailNormal(P.xz, t, look.flow, select(0.25, 0.12, kind == 1));
    n = normalize(vec3f(n.x + detail.x, n.y, n.z + detail.z));
    let rain = uniforms.waterParams2.w;
    if (rain > 0.0) {
        let rr = rainRipples(P.xz * 0.9, t, 0.7);
        n = normalize(n + vec3f(rr.x, 0.0, rr.y) * rain * 0.6);
    }

    // the column, the reflection and the light
    var col = waterColumn(look, thickness);
    let caust = waterCaustics(P.xz, t) * waterClarity(thickness, look.depthScale) * step(thickness, look.depthScale);
    col = col + uniforms.sunColor * caust * 0.25;
    let r = reflect(-V, n);
    let fres = fresnelSchlick(max(dot(n, V), 0.0), 0.04);
    let fresStep = floor(fres * 4.0 + 0.5) / 4.0;
    let refl = waterSkyReflection(r, uniforms.skyColor, uniforms.horizonColor);
    col = mix(col, refl, mix(fres, fresStep, 0.6) * 0.85);
    col = col + uniforms.sunColor * waterSunGlints(r, normalize(uniforms.sunDir), P.xz, t) * 1.5;

    // pond life under and on the surface
    if (kind == 1) {
        let koi = waterKoi(P.xz - vec2f(0.0), t);
        let koiCol = mix(vec3f(0.85, 0.3, 0.08), vec3f(0.95, 0.93, 0.88), koi.y);
        col = mix(col, mix(col, koiCol, 0.55), koi.x * (1.0 - fres));
        let lily = waterLilies(P.xz, t);
        col = mix(col, vec3f(0.22, 0.42, 0.18) * (0.8 + 0.2 * n.y), lily.x);
        col = mix(col, vec3f(0.98, 0.8, 0.86), lily.y);
    }
    if (kind == 2) {
        col = mix(col, vec3f(0.55, 0.35, 0.12), waterLeaves(P.xz, t, look.flow) * 0.9);
    }

    // foam at the shore and on crests
    let foamW = select(0.35, 0.15, kind == 1);
    var foam = waterShoreFoam(thickness, P.xz, t, foamW);
    if (kind == 0) {
        foam = max(foam, waterWhitecaps(fragmentInputs.vCrest, P.xz, t));
    }
    col = mix(col, look.foam, foam);

    // an ink line where the water meets the land
    let ink = 1.0 - smoothstep(0.0, 0.04, thickness);
    col = mix(col, vec3f(0.05, 0.06, 0.08), ink * 0.7);

    // alpha: clear over the shallows (the bed shows through), opaque where it is deep
    let a = clamp(1.0 - waterClarity(thickness, look.depthScale) * 0.75 + foam + fres * 0.3, 0.0, 1.0);
    fragmentOutputs.color = vec4f(col, a);
}
