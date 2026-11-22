// Grass blades (vb_grass), instanced: one tapered strip per blade, placed by per-instance data
// (root + height, then facing, lean angle, lean amount, seed + flower kind), bent by the gust field
// and pushed aside by the fighters, faded out with distance.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;     // x across (-0.5..0.5), y up (0..1)
attribute g0: vec4f;
attribute g1: vec4f;

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;
uniform grassParams: vec4f;    // time, wind strength, wind dir x, wind dir z
uniform grassParams2: vec4f;   // blade width, fade start, fade end, -
uniform pushers: array<vec4f, 4>;
uniform marksParams: vec4f;     // the fight's ground marks: centre x, z, 1 / size, on

var marksA: texture_2d<f32>;
var marksASampler: sampler;
var marksB: texture_2d<f32>;
var marksBSampler: sampler;

varying vT: f32;
varying vAcross: f32;
varying vWorld: vec3f;
varying vSeed: f32;
varying vFlower: f32;
varying vFade: f32;
varying vScar: vec4f;      // burn, frost, ink, trample
varying vHeat: f32;

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_grass>
#include<vb_grass_marks>

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var b = grassBladeFrom(vertexInputs.g0, vertexInputs.g1);
    let t = vertexInputs.position.y;
    // the fight's marks at the root: burnt, cut, flattened, trampled, frozen (vb_grass_marks)
    var scar = grassScarNone();
    if (uniforms.marksParams.w > 0.5) {
        let muv = (b.root.xz - uniforms.marksParams.xy) * uniforms.marksParams.z + 0.5;
        if (all(muv > vec2f(0.002)) && all(muv < vec2f(0.998))) {
            let ma = textureSampleLevel(marksA, marksASampler, muv, 0.0);
            let mb = textureSampleLevel(marksB, marksBSampler, muv, 0.0);
            let e = 2.0 / 512.0;
            let gx = textureSampleLevel(marksB, marksBSampler, muv + vec2f(e, 0.0), 0.0).y - mb.y;
            let gz = textureSampleLevel(marksB, marksBSampler, muv + vec2f(0.0, e), 0.0).y - mb.y;
            scar = grassScar(ma, mb, vec2f(gx, gz) * 20.0, b.seed);
        }
    }
    b.height = b.height * scar.height;
    let dist = length(b.root - uniforms.cameraPosition);
    let fade = 1.0 - smoothstep(uniforms.grassParams2.y, uniforms.grassParams2.z, dist);
    // taper to a point; a blade further away is drawn a little wider so it does not shimmer
    let width = uniforms.grassParams2.x * (1.0 - t * 0.85) * (1.0 + dist * 0.02) * step(0.001, fade);
    let c = cos(b.facing);
    let s = sin(b.facing);
    var local = vec3f(vertexInputs.position.x * width * c, t * b.height, vertexInputs.position.x * width * s);
    let wind = grassWind(b.root.xz, uniforms.grassParams.x, uniforms.grassParams.zw, uniforms.grassParams.y);
    let push = grassPush(b.root, uniforms.pushers);
    local = grassBend(local, t, b.lean + wind * 0.6 * scar.windFree + push + scar.lean, b.height);
    let wp = b.root + local;
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vT = t;
    vertexOutputs.vAcross = vertexInputs.position.x;
    vertexOutputs.vWorld = wp;
    vertexOutputs.vSeed = b.seed;
    vertexOutputs.vFlower = b.flower;
    vertexOutputs.vFade = fade;
    vertexOutputs.vScar = vec4f(scar.burn, scar.frost, scar.ink, scar.trample);
    vertexOutputs.vHeat = scar.heat;
}
