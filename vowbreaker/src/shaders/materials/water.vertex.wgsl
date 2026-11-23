// Stage water (src/render/Water.ts): vertex stage. A flat grid moved by Gerstner waves (the sea);
// ponds and canals stay flat and get their ripples in the fragment stage. The wave height is
// passed on so the fragment stage can put whitecaps on the crests.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute uv: vec2f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform waterParams: vec4f;    // time, wave amplitude, wave length, kind

varying vWorld: vec3f;
varying vNormalW: vec3f;
varying vCrest: f32;
varying vViewZ: f32;
varying vUV: vec2f;

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_water_toon>

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var wp = (uniforms.world * vec4f(vertexInputs.position, 1.0)).xyz;
    let t = uniforms.waterParams.x;
    let g = waterWaves(wp.xz, t, uniforms.waterParams.y, uniforms.waterParams.z);
    // fade the waves out near the grid's edge so the surface never lifts off its border
    let edge = smoothstep(0.0, 0.08, min(min(vertexInputs.uv.x, 1.0 - vertexInputs.uv.x), min(vertexInputs.uv.y, 1.0 - vertexInputs.uv.y)));
    wp = wp + g.disp * edge;
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vWorld = wp;
    vertexOutputs.vNormalW = normalize(mix(vec3f(0.0, 1.0, 0.0), waterWaveNormal(g), edge));
    vertexOutputs.vCrest = g.disp.y / max(uniforms.waterParams.y * 0.5 * uniforms.waterParams.z / TAU, 1e-3) * 0.5 + 0.5;
    vertexOutputs.vViewZ = (uniforms.view * vec4f(wp, 1.0)).z;
    vertexOutputs.vUV = vertexInputs.uv;
}
