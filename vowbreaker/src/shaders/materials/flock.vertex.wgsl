// Flocks (vb_flock): one small template mesh (a body, two wings, a neck and tail) instanced per
// bird straight from the simulation's storage buffer (12 floats each). The wings flap round the
// body's long axis by the bird's wingbeat, the shape is scaled for its kind, and the whole bird is
// turned to fly along its velocity.
#define DISABLE_UNIFORMITY_ANALYSIS
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_flock>

attribute position: vec3f;   // x across the wings, y up, z toward the head
attribute uv: vec2f;         // part (0 body, 1 left wing, 2 right wing, 3 neck/tail), distance out along it
attribute b0: vec4f;         // pos, wingbeat phase
attribute b1: vec4f;         // velocity, kind
attribute b2: vec4f;         // home, seed

uniform viewProjection: mat4x4f;
uniform cameraPosition: vec3f;

varying vWorldPos: vec3f;
varying vPart: vec2f;
varying vKind: vec2f;        // kind, seed
varying vFade: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let kind = i32(vertexInputs.b1.w + 0.5);
    let seed = vertexInputs.b2.w;
    let part = vertexInputs.uv.x;
    var lp = vertexInputs.position;
    // the wings flap: lifted round the body's long axis, more toward their tips
    if (part > 0.5 && part < 2.5) {
        let a = birdWingAngle(kind, vertexInputs.b0.w + seed);
        let span = abs(lp.x);
        lp = vec3f(sign(lp.x) * span * cos(a), lp.y + span * sin(a), lp.z);
    }
    lp = lp * birdScale(kind);
    // fly along the velocity, banking a little into turns
    let v = vertexInputs.b1.xyz;
    let fwd = normalize(v + vec3f(0.0, 0.0, 1e-4));
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd) + vec3f(1e-4, 0.0, 0.0));
    let up = cross(fwd, right);
    let wp = vertexInputs.b0.xyz + right * lp.x + up * lp.y + fwd * lp.z;
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vWorldPos = wp;
    vertexOutputs.vPart = vertexInputs.uv;
    vertexOutputs.vKind = vec2f(f32(kind), seed);
    vertexOutputs.vFade = 1.0 - smoothstep(60.0, 90.0, distance(wp, uniforms.cameraPosition));
}
