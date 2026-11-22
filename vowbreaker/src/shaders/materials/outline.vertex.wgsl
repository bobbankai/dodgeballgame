// Inverted-hull ink outline (the Guilty Gear Xrd method): the mesh drawn again with front faces
// culled, pushed out along its normal in clip space so the line width is set in pixels. The width
// tapers with the painted line scale (uv.y), thins with distance and swells a little toward the
// silhouette's contour, like a brush line.
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

#include<bonesDeclaration>
#include<instancesDeclaration>

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform squash: vec4f;
uniform pivot: vec4f;      // squash-and-stretch pivot (the character's root, world space)
uniform outlineParams: vec4f;   // x width px, y reference distance, z depth push, w min scale
uniform screenSize: vec2f;
uniform heights: vec4f;
uniform wind: vec4f;
uniform motion: vec4f;
uniform sunDir: vec3f;
uniform cameraPosition: vec3f;

varying vColor: vec4f;
varying vObjPos: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
#include<bonesVertex>
    var worldPos = finalWorld * vec4f(vertexInputs.position, 1.0);
    let rootW = uniforms.pivot.xyz;
    worldPos = vec4f(rootW + (worldPos.xyz - rootW) * uniforms.squash.xyz, 1.0);
    // the same flutter as the body (vb_toon_motion), so the line stays on it
#ifdef VERTEXCOLOR
    let fl = flutterAt(decodeMaterialId(vertexInputs.color.a), vertexInputs.position, worldPos.xyz, uniforms.heights.x, uniforms.wind, uniforms.motion);
    worldPos = vec4f(worldPos.xyz + fl.disp, 1.0);
#endif
    let nW = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
    var clip = uniforms.viewProjection * worldPos;
    let clipN = (uniforms.viewProjection * vec4f(nW, 0.0)).xy;
    var scale = 1.0;
#ifdef UV1
    scale = vertexInputs.uv.y;
#endif
    let distScale = clamp(uniforms.outlineParams.y / max(clip.w, 0.1), uniforms.outlineParams.w, 1.25);
    // drawn the way an animator weights a line: heavier in shadow and on the contour (vb_toon_motion)
    let viewDir = normalize(uniforms.cameraPosition - worldPos.xyz);
    let weight = lineWeight(nW, viewDir, normalize(uniforms.sunDir), vertexInputs.position, uniforms.wind.w, uniforms.pivot.x * 3.1);
    let widthPx = uniforms.outlineParams.x * scale * distScale * weight;
    let dir = normalize(clipN + vec2f(1e-6));
    let offset = dir * widthPx * 2.0 / uniforms.screenSize * clip.w;
    clip = vec4f(clip.xy + offset, clip.z + uniforms.outlineParams.z * clip.w, clip.w);
    vertexOutputs.position = clip;
#ifdef VERTEXCOLOR
    vertexOutputs.vColor = vertexInputs.color;
#else
    vertexOutputs.vColor = vec4f(0.3, 0.3, 0.3, 0.0);
#endif
    vertexOutputs.vObjPos = vertexInputs.position;
}
