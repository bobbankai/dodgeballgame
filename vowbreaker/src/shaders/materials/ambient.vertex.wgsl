// Ambient weather: thousands of instanced quads animated entirely in the vertex shader inside a box
// that follows the camera (wrapping with fract), so rain, petals, ash and snow cost no CPU at all.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>

attribute position: vec3f;
attribute idx: f32;

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;
uniform ambientParams: vec4f;   // kind (0 rain, 1 petals, 2 ash, 3 snow, 4 embers, 5 lantern motes), time, box size, density
uniform ambientWind: vec4f;     // wind xyz, fall speed

varying vUV: vec2f;
varying vInfo: vec4f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let kind = i32(uniforms.ambientParams.x + 0.5);
    let t = uniforms.ambientParams.y;
    let box = uniforms.ambientParams.z;
    let i = vertexInputs.idx;
    let h = hash31(i * 1.618 + 0.37);
    let h2 = hash31(i * 2.71 + 5.1);
    var fall = uniforms.ambientWind.w * (0.7 + h2.x * 0.6);
    if (kind == 4 || kind == 5) {
        fall = -fall;
    }
    var local = h * box - vec3f(box * 0.5, 0.0, box * 0.5);
    local = local + vec3f(uniforms.ambientWind.x, -fall, uniforms.ambientWind.z) * t;
    // sway for light things
    if (kind == 1 || kind == 3 || kind == 2 || kind == 5) {
        local = local + vec3f(sin(t * (1.0 + h2.y) + i) * 0.4, 0.0, cos(t * (0.8 + h2.z) + i * 1.3) * 0.4);
    }
    // wrap into the box around the camera
    let cam = uniforms.cameraPosition;
    let rel = local - vec3f(cam.x, 0.0, cam.z);
    var w = vec3f(fract(rel.x / box + 0.5) - 0.5, fract(rel.y / box), fract(rel.z / box + 0.5) - 0.5) * box;
    w = vec3f(w.x + cam.x, w.y, w.z + cam.z);
    let camRight = vec3f(uniforms.view[0][0], uniforms.view[1][0], uniforms.view[2][0]);
    let camUp = vec3f(uniforms.view[0][1], uniforms.view[1][1], uniforms.view[2][1]);
    let corner = vertexInputs.position.xy;
    var wp: vec3f;
    var size = 0.05;
    if (kind == 0) {
        // rain: a thin streak along the fall direction
        let d = normalize(vec3f(uniforms.ambientWind.x, -fall, uniforms.ambientWind.z));
        let toCam = normalize(cam - w);
        let side = normalize(cross(d, toCam));
        wp = w + d * corner.y * 0.6 + side * corner.x * 0.012;
    } else {
        size = select(0.06, 0.09, kind == 1) * (0.6 + h2.y * 0.8);
        if (kind == 3) {
            size = 0.035;
        }
        let a = t * (1.0 + h2.z * 2.0) + i;
        let c = cos(a);
        let s = sin(a);
        let rc = vec2f(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
        wp = w + (camRight * rc.x + camUp * rc.y) * size;
    }
    // only draw the fraction the density asks for
    if (h2.z > uniforms.ambientParams.w) {
        wp = vec3f(0.0, -1000.0, 0.0);
    }
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vUV = corner + 0.5;
    let distFade = 1.0 - smoothstep(box * 0.3, box * 0.5, length(w.xz - cam.xz));
    vertexOutputs.vInfo = vec4f(f32(kind), h2.x, distFade, h.y);
}
