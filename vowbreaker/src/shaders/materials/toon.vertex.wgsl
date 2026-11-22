// Character toon shader: vertex stage. Skinned (Babylon's bone includes), instanced or not.
// Vertex data from the Blender pipeline:
//   color     rgb = painted albedo, a = material id / 8 (see vb_toon)
//   uv        x = baked ambient occlusion, y = ink line width scale
//   uv2       face shadow thresholds for light from the left (x) and right (y)
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_toon>
#include<vb_toon_motion>

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
uniform squash: vec4f;
uniform pivot: vec4f;      // squash-and-stretch pivot (the character's root, world space)
uniform heights: vec4f;    // figure height, head height (object space), -, -
uniform wind: vec4f;       // world wind x, z, strength, time
uniform motion: vec4f;     // the character's velocity x, z (world), speed, -

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
    // squash and stretch around the character's root (hit reactions, landing)
    let rootW = uniforms.pivot.xyz;
    worldPos = vec4f(rootW + (worldPos.xyz - rootW) * uniforms.squash.xyz, 1.0);
    // hems and hair in the wind (vb_toon_motion)
#ifdef VERTEXCOLOR
    let fl = flutterAt(decodeMaterialId(vertexInputs.color.a), p, worldPos.xyz, uniforms.heights.x, uniforms.wind, uniforms.motion);
    worldPos = vec4f(worldPos.xyz + fl.disp, 1.0);
#endif
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
