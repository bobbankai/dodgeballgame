// Ambient weather (vb_ambient_weather): thousands of instanced quads animated entirely in the vertex
// shader inside a box that follows the camera, so rain, petals, ash, snow, embers, fireflies, leaves,
// paper slips and dust cost no CPU at all. Flat things are cards tumbling in 3D; streaks stretch
// along their fall; rain that reaches the ground is drawn as a splash lying on it.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_ambient_weather>

attribute position: vec3f;
attribute idx: f32;

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;
uniform ambientParams: vec4f;   // kind, time, box size, density
uniform ambientWind: vec4f;     // wind xyz, fall speed
uniform ambientParams2: vec4f;  // lightning flash, ground height, -, -
uniform sunDir: vec3f;

varying vUV: vec2f;
varying vInfo: vec4f;            // kind, seed, distance fade, splash age
varying vInfo2: vec4f;           // facing, toward the sun, seed2, -

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let kind = i32(uniforms.ambientParams.x + 0.5);
    let t = uniforms.ambientParams.y;
    let box = uniforms.ambientParams.z;
    let cam = uniforms.cameraPosition;
    let d = ambientDrop(kind, vertexInputs.idx, t, box, cam, uniforms.ambientWind, uniforms.ambientParams2.y);
    let camRight = vec3f(uniforms.view[0][0], uniforms.view[1][0], uniforms.view[2][0]);
    let camUp = vec3f(uniforms.view[0][1], uniforms.view[1][1], uniforms.view[2][1]);
    let corner = vertexInputs.position.xy;
    var wp: vec3f;
    var facing = 1.0;
    var toSun = 1.0;
    let toCam = normalize(cam - d.pos);
    if (d.splash > 0.0) {
        // a splash lies on the ground
        wp = d.pos + vec3f(corner.x, 0.0, corner.y) * 0.25;
    } else if (kind == 0 || kind == 10) {
        // streaks along the wind-bent fall
        let dir = normalize(vec3f(uniforms.ambientWind.x, -uniforms.ambientWind.w * ambientKindParams(kind).x, uniforms.ambientWind.z));
        let side = normalize(cross(dir, toCam) + vec3f(1e-5));
        let len = select(0.6, 0.35, kind == 10);
        wp = d.pos + dir * corner.y * len + side * corner.x * d.size;
    } else if (kind == 1 || kind == 2 || kind == 7 || kind == 8) {
        // a card tumbling about its axis
        let tangent = normalize(cross(d.axis, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4));
        let bit = cross(d.axis, tangent);
        let across = tangent * cos(d.angle) + bit * sin(d.angle);
        let nrm = normalize(cross(d.axis, across));
        wp = d.pos + d.axis * corner.y * d.size + across * corner.x * d.size;
        facing = abs(dot(nrm, toCam));
        toSun = dot(nrm, normalize(uniforms.sunDir)) * sign(dot(nrm, toCam));
    } else {
        // round things face the camera
        var size = d.size;
        // near snowflakes are larger (and drawn softer)
        if (kind == 3) {
            size = size * (1.0 + (1.0 - smoothstep(0.0, 4.0, length(cam - d.pos))) * 2.0);
        }
        wp = d.pos + (camRight * corner.x + camUp * corner.y) * size;
    }
    // only the fraction the density asks for
    if (d.seed > uniforms.ambientParams.w) {
        wp = vec3f(0.0, -1000.0, 0.0);
    }
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vUV = corner + 0.5;
    let distFade = 1.0 - smoothstep(box * 0.3, box * 0.5, length(d.pos.xz - cam.xz));
    vertexOutputs.vInfo = vec4f(f32(kind), d.seed, distFade, d.splash);
    vertexOutputs.vInfo2 = vec4f(facing, toSun, d.seed2, 0.0);
}
