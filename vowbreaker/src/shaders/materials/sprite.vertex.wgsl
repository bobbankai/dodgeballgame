// Effect sprites: one instanced quad per effect, laid out four ways:
//   mode 0  billboard facing the camera (sparks, flares, orbs, glyphs)
//   mode 1  lying on the ground (shockwave rings, seals, cracks of light, dust)
//   mode 2  a camera-facing ribbon stretched from pos to pos + dir (lightning, streaks)
//   mode 3  a vertical card facing along dir (slash crescents, talismans)
// Per instance:  s0 = pos.xyz, size     s1 = rgb, intensity/alpha
//                s2 = kind, age (0..1), rotation, seed     s3 = dir.xyz, mode
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute s0: vec4f;
attribute s1: vec4f;
attribute s2: vec4f;
attribute s3: vec4f;

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vData: vec4f;
varying vViewZ: f32;
varying vWorld: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let corner = vertexInputs.position.xy;          // -0.5..0.5
    let center = vertexInputs.s0.xyz;
    let size = vertexInputs.s0.w;
    let mode = i32(vertexInputs.s3.w + 0.5);
    let rot = vertexInputs.s2.z;
    let c = cos(rot);
    let s = sin(rot);
    let rc = vec2f(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
    // camera basis from the view matrix rows
    let camRight = vec3f(uniforms.view[0][0], uniforms.view[1][0], uniforms.view[2][0]);
    let camUp = vec3f(uniforms.view[0][1], uniforms.view[1][1], uniforms.view[2][1]);
    var wp = center;
    if (mode == 0) {
        wp = center + (camRight * rc.x + camUp * rc.y) * size;
    } else if (mode == 1) {
        wp = center + vec3f(rc.x, 0.0, rc.y) * size + vec3f(0.0, 0.02, 0.0);
    } else if (mode == 2) {
        let d = vertexInputs.s3.xyz;
        let mid = center + d * (corner.x + 0.5);
        let toCam = normalize(uniforms.cameraPosition - mid);
        let side = normalize(cross(normalize(d + vec3f(1e-5)), toCam));
        wp = mid + side * corner.y * size;
    } else {
        let f = normalize(vec3f(vertexInputs.s3.x, 0.0, vertexInputs.s3.z) + vec3f(1e-5, 0.0, 0.0));
        let r = vec3f(f.z, 0.0, -f.x);
        wp = center + (r * rc.x + vec3f(0.0, 1.0, 0.0) * rc.y) * size;
    }
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vUV = corner + 0.5;
    vertexOutputs.vColor = vertexInputs.s1;
    vertexOutputs.vData = vertexInputs.s2;
    vertexOutputs.vViewZ = (uniforms.view * vec4f(wp, 1.0)).z;
    vertexOutputs.vWorld = wp;
}
