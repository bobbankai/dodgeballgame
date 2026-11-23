// Debris chunks (vb_debris): the shared chunk mesh, instanced once per chunk straight from the
// simulation's storage buffer (24 floats each). Each instance stretches the mesh by its kind and
// seed, dents it, turns it by its quaternion and places it. With INK defined this draws the ink
// hull instead: the same chunk pushed out along its normals, front faces culled.
#define DISABLE_UNIFORMITY_ANALYSIS
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_debris>

attribute position: vec3f;
attribute normal: vec3f;
attribute c0: vec4f;   // pos, life
attribute c1: vec4f;   // vel, maxLife
attribute c2: vec4f;   // quaternion
attribute c3: vec4f;   // angular velocity, size
attribute c4: vec4f;   // colour, kind
attribute c5: vec4f;   // seed, state, heat, bounces

uniform viewProjection: mat4x4f;
uniform cameraPosition: vec3f;

varying vWorldPos: vec3f;
varying vLocal: vec3f;
varying vColor: vec4f;    // colour, kind
varying vInfo: vec4f;     // seed, heat, fade, -

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let life = vertexInputs.c0.w;
    var size = vertexInputs.c3.w;
    if (life <= 0.0) {
        size = 0.0;
    }
    let kind = i32(vertexInputs.c4.w + 0.5);
    let seed = vertexInputs.c5.x;
    let scale = debrisShapeScale(kind, seed);
    let local = vertexInputs.position * debrisDent(vertexInputs.position, seed);
    var p = local * scale;
#ifdef INK
    // the hull: pushed out by a width that stays a few pixels wide at any distance
    let centre = vertexInputs.c0.xyz;
    let dist = length(uniforms.cameraPosition - centre);
    p = p + normalize(vertexInputs.normal / scale) * (0.035 + dist * 0.0015) / max(size, 0.02);
#endif
    let wp = vertexInputs.c0.xyz + quatRotate(vertexInputs.c2, p * size);
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vWorldPos = wp;
    vertexOutputs.vLocal = local;
    vertexOutputs.vColor = vertexInputs.c4;
    // fade: chunks shrink into the floor at the end (handled by sinking); nothing else fades
    vertexOutputs.vInfo = vec4f(seed, vertexInputs.c5.z, clamp(life / 0.6, 0.0, 1.0), 0.0);
}
