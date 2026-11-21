// Shared vertex stage for the depth-like passes: the sun's shadow map and the G-buffer.
// Skinned and instanced like the colour pass so animated fighters cast and receive correctly.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute normal: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif

#include<bonesDeclaration>
#include<instancesDeclaration>

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform squash: vec4f;
uniform objectId: f32;

varying vNormalV: vec3f;
varying vViewZ: f32;
varying vId: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
#include<bonesVertex>
    var worldPos = finalWorld * vec4f(vertexInputs.position, 1.0);
    let rootW = (uniforms.world * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    worldPos = vec4f(rootW + (worldPos.xyz - rootW) * uniforms.squash.xyz, 1.0);
    vertexOutputs.position = uniforms.viewProjection * worldPos;
    let nW = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
    vertexOutputs.vNormalV = normalize((uniforms.view * vec4f(nW, 0.0)).xyz);
    vertexOutputs.vViewZ = (uniforms.view * worldPos).z;
    var id = uniforms.objectId;
#ifdef VERTEXCOLOR
    // scenery carries its own per-part ids in the colour alpha (pattern ids) so joints between
    // different materials get an ink line even where depth and normals agree
    id = id + floor(vertexInputs.color.a * 32.0 + 0.5);
#endif
    vertexOutputs.vId = id;
}
