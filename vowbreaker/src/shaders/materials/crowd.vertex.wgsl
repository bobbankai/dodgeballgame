// The crowd (vb_crowd): one jointed body mesh, instanced. Per-vertex: position (unit body, feet at
// 0, height 1, facing +z), normal, uv (fabric), part (in uv2.x). Per-instance: c0 = position x, z,
// heading, scale; c1 = behaviour, phase offset, speed, route radius; c2 = palette, pattern, prop,
// seed. Strollers walk loops round the square's centre at their route radius; the rest stand.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute normal: vec3f;
attribute uv: vec2f;
attribute uv2: vec2f;
attribute c0: vec4f;
attribute c1: vec4f;
attribute c2: vec4f;

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;
uniform crowdParams: vec4f;    // time, square centre x, z, ground height

varying vNormalW: vec3f;
varying vWorld: vec3f;
varying vUV: vec2f;
varying vPart: f32;
varying vLook: vec4f;          // palette, pattern, prop, seed

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_crowd>

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let time = uniforms.crowdParams.x;
    let centre = uniforms.crowdParams.yz;
    let behaviour = i32(vertexInputs.c1.x + 0.5);
    let seed = vertexInputs.c2.w;
    let scale = vertexInputs.c0.w;
    var pos = vertexInputs.c0.xy;
    var heading = vertexInputs.c0.z;
    var moving = 0.0;
    var phase = vertexInputs.c1.y + time * 7.0;
    if (behaviour == 0 || behaviour == 3) {
        // walking a loop round the centre; strollers stop at stalls now and then
        let speed = vertexInputs.c1.z;
        let radius = vertexInputs.c1.w;
        let pause = select(smoothstep(0.75, 0.85, fract(time * 0.04 + seed * 3.0)) * (1.0 - smoothstep(0.95, 1.0, fract(time * 0.04 + seed * 3.0))), 0.0, behaviour == 3);
        moving = 1.0 - pause;
        let ang = vertexInputs.c1.y + time * speed / max(radius, 1.0) * select(1.0, -1.0, seed > 0.5);
        pos = centre + vec2f(cos(ang), sin(ang)) * radius;
        let tangent = vec2f(-sin(ang), cos(ang)) * select(1.0, -1.0, seed > 0.5);
        heading = atan2(tangent.x, tangent.y);
        phase = vertexInputs.c1.y * 13.0 + ang * radius * 2.2;
        if (pause > 0.5) {
            heading = heading + 1.5708 * select(1.0, -1.0, seed > 0.25);
        }
    }
    let pose = crowdPose(behaviour, phase, time, seed, moving);
    let part = i32(vertexInputs.uv2.x + 0.5);
    var local = crowdPoseVertex(vertexInputs.position, part, pose) * scale;
    // only the instance's own prop is kept
    let prop = i32(vertexInputs.c2.z + 0.5);
    if (part >= 6 && part - 5 != prop) {
        local = vec3f(0.0, 0.5 * scale, 0.0);
    }
    let rot = rotY(-heading);
    let wp = rot * local + vec3f(pos.x, uniforms.crowdParams.w, pos.y);
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vNormalW = normalize(rot * vertexInputs.normal);
    vertexOutputs.vWorld = wp;
    vertexOutputs.vUV = vertexInputs.uv;
    vertexOutputs.vPart = f32(part);
    vertexOutputs.vLook = vertexInputs.c2;
}
