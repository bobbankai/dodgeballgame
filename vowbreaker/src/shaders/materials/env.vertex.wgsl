// Environment shader: vertex stage. Static (merged) scenery from the Blender stage scripts:
//   color  rgb = painted base colour, a = pattern id / 32 (vb_surface)
//   uv     x = baked AO, y = sway weight (foliage, banners, lantern strings: 0 = rigid)
// Instanced props (lanterns, poles, petals) use thin instances.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>

attribute position: vec3f;
attribute normal: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
#ifdef UV1
attribute uv: vec2f;
#endif

#include<instancesDeclaration>

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform envTime: vec4f;        // time, wind strength, wind dir x, wind dir z

varying vWorldPos: vec3f;
varying vNormalW: vec3f;
varying vColor: vec4f;
varying vAO: f32;
varying vSeed: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
    var wp = (finalWorld * vec4f(vertexInputs.position, 1.0)).xyz;
    var sway = 0.0;
    var ao = 1.0;
#ifdef UV1
    ao = vertexInputs.uv.x;
    sway = vertexInputs.uv.y;
#endif
    if (sway > 0.0) {
        // wind: a slow gust field over the world plus a quick flutter, stronger at the tips
        let t = uniforms.envTime.x;
        let dir = normalize(vec3f(uniforms.envTime.z, 0.0, uniforms.envTime.w) + vec3f(1e-4));
        let gust = simplex3(vec3f(wp.xz * 0.08 - dir.xz * t * 0.6, t * 0.1)) * 0.5 + 0.5;
        let flutter = sin(t * 7.0 + wp.x * 3.1 + wp.z * 2.3) * 0.25 + sin(t * 11.0 + wp.y * 5.0) * 0.15;
        let amount = sway * uniforms.envTime.y;
        wp = wp + dir * (gust * 0.35 + flutter * 0.08) * amount + vec3f(0.0, -abs(flutter) * 0.03 * amount, 0.0);
    }
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vWorldPos = wp;
    vertexOutputs.vNormalW = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
#ifdef VERTEXCOLOR
    vertexOutputs.vColor = vertexInputs.color;
#else
    vertexOutputs.vColor = vec4f(0.8, 0.8, 0.8, 0.0);
#endif
    vertexOutputs.vAO = ao;
    // a per-object seed from the instance/world origin (varies neon signs and window grids)
    let o = (finalWorld * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    vertexOutputs.vSeed = hash13(floor(o * 3.0));
}
