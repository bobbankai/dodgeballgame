// Rising lanterns (vb_lanterns3d): the template barrel instanced per lantern; position, swell,
// sway and turn all come from the lantern's seed and the time.
#define DISABLE_UNIFORMITY_ANALYSIS
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_lanterns3d>

attribute position: vec3f;
attribute l0: vec4f;     // x, z, base height, seed
attribute l1: vec4f;     // size, speed, climb, cursed

uniform viewProjection: mat4x4f;
uniform lanternParams: vec4f;   // time, wind x, wind z, -
uniform cameraPosition: vec3f;

varying vLocal: vec3f;
varying vInfo: vec4f;    // seed, cursed, -, -

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let t = uniforms.lanternParams.x;
    let s = lanternAt(vertexInputs.l0, vertexInputs.l1, t, uniforms.lanternParams.yz);
    // a lantern drifting up past the lens shrinks away rather than filling the frame
    let near = smoothstep(2.5, 6.0, length(s.pos - uniforms.cameraPosition));
    var p = lanternBulge(vertexInputs.position) * s.scale * near;
    p = vec3f(rotate2(p.xz, s.spin).x, p.y, rotate2(p.xz, s.spin).y);
    p = vec3f(p.x + p.y * s.tilt.x, p.y, p.z + p.y * s.tilt.y);
    let wp = s.pos + p;
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vLocal = vertexInputs.position;
    vertexOutputs.vInfo = vec4f(vertexInputs.l0.w, vertexInputs.l1.w, 0.0, 0.0);
}
