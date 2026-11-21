// Character toon shader: vertex stage. Skinned (Babylon's bone includes), instanced or not.
// Vertex data from the Blender pipeline:
//   color     rgb = painted albedo, a = material id / 8 (see vb_toon)
//   uv        x = baked ambient occlusion, y = ink line width scale
//   uv2       face shadow thresholds for light from the left (x) and right (y)
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute normal: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
#ifdef UV1
attribute uv: vec2f;
#endif
#ifdef UV2
attribute uv2: vec2f;
#endif

#include<bonesDeclaration>
#include<instancesDeclaration>

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform squash: vec4f;     // xyz scale about the root for squash-and-stretch on hits, w unused

varying vWorldPos: vec3f;
varying vNormalW: vec3f;
varying vNormalV: vec3f;
varying vColor: vec4f;
varying vData: vec4f;
varying vObjPos: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
#include<bonesVertex>
    let p = vertexInputs.position;
    var worldPos = finalWorld * vec4f(p, 1.0);
    // squash and stretch around the model's origin in world space (hit reactions, landing)
    let origin = finalWorld * vec4f(0.0, 0.0, 0.0, 1.0);
    let rootW = (uniforms.world * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    _ = origin;
    worldPos = vec4f(rootW + (worldPos.xyz - rootW) * uniforms.squash.xyz, 1.0);
    vertexOutputs.position = uniforms.viewProjection * worldPos;
    let nW = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
    vertexOutputs.vWorldPos = worldPos.xyz;
    vertexOutputs.vNormalW = nW;
    vertexOutputs.vNormalV = normalize((uniforms.view * vec4f(nW, 0.0)).xyz);
#ifdef VERTEXCOLOR
    vertexOutputs.vColor = vertexInputs.color;
#else
    vertexOutputs.vColor = vec4f(1.0, 1.0, 1.0, 0.0);
#endif
    var data = vec4f(1.0, 1.0, 0.5, 0.5);
#ifdef UV1
    data = vec4f(vertexInputs.uv.x, vertexInputs.uv.y, data.z, data.w);
#endif
#ifdef UV2
    data = vec4f(data.x, data.y, vertexInputs.uv2.x, vertexInputs.uv2.y);
#endif
    vertexOutputs.vData = data;
    vertexOutputs.vObjPos = p;
}
