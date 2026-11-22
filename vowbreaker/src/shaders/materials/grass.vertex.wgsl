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

varying vT: f32;
varying vAcross: f32;
varying vWorld: vec3f;
varying vSeed: f32;
varying vFlower: f32;
varying vFade: f32;

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_grass>

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let b = grassBladeFrom(vertexInputs.g0, vertexInputs.g1);
    let t = vertexInputs.position.y;
    let dist = length(b.root - uniforms.cameraPosition);
    let fade = 1.0 - smoothstep(uniforms.grassParams2.y, uniforms.grassParams2.z, dist);
    // taper to a point; a blade further away is drawn a little wider so it does not shimmer
    let width = uniforms.grassParams2.x * (1.0 - t * 0.85) * (1.0 + dist * 0.02) * step(0.001, fade);
    let c = cos(b.facing);
    let s = sin(b.facing);
    var local = vec3f(vertexInputs.position.x * width * c, t * b.height, vertexInputs.position.x * width * s);
    let wind = grassWind(b.root.xz, uniforms.grassParams.x, uniforms.grassParams.zw, uniforms.grassParams.y);
    let push = grassPush(b.root, uniforms.pushers);
    local = grassBend(local, t, b.lean + wind * 0.6 + push, b.height);
    let wp = b.root + local;
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vT = t;
    vertexOutputs.vAcross = vertexInputs.position.x;
    vertexOutputs.vWorld = wp;
    vertexOutputs.vSeed = b.seed;
    vertexOutputs.vFlower = b.flower;
    vertexOutputs.vFade = fade;
}
