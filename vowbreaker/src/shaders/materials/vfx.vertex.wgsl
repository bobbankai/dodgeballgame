// Mesh effects (src/render/Vfx.ts): vertex stage.
// Unit shapes are placed by the mesh's world matrix, optionally turned to face the camera, and
// reshaped per effect kind (a dome becomes a bell, a cylinder a tapering flame, a cone of wind or
// a water crown, a sphere a lumpy puff of smoke). Kind numbers match VK in Vfx.ts.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute normal: vec3f;
attribute uv: vec2f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;
uniform vfxTime: vec4f;     // time, screen width, screen height, blend (0 add, 1 alpha)
uniform vfxA: vec4f;        // kind, age 0..1, seed, intensity
uniform vfxB: vec4f;        // kind parameters
uniform vfxC: vec4f;        // more kind parameters
uniform vfxD: vec4f;        // billboard (0 mesh, 1 camera-facing quad, 2 axial ribbon), soft depth, shape flare, roll

varying vUV: vec2f;
varying vLocal: vec3f;
varying vNormalW: vec3f;
varying vWorld: vec3f;
varying vViewZ: f32;

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>

fn colLen(m: mat4x4f, c: i32) -> f32 {
    return length(m[c].xyz);
}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let kind = i32(uniforms.vfxA.x + 0.5);
    let age = uniforms.vfxA.y;
    let seed = uniforms.vfxA.z;
    let time = uniforms.vfxTime.x;
    var p = vertexInputs.position;
    var n = vertexInputs.normal;
    let uv = vertexInputs.uv;

    // --- reshape the unit shape for the kind ----------------------------------------------------------
    switch kind {
        case 4: {
            // bell: the dome pulled into a bell's silhouette, a little taller than wide
            // (the dome's uv: x = azimuth, y = 0 at the rim .. 1 at the pole)
            let v = uv.y;
            let a = uv.x * TAU;
            let skirt = 1.0 - smoothstep(0.0, 0.18, v) * 0.18;
            let body = mix(1.0, 0.72, smoothstep(0.1, 0.82, v));
            let c = clamp((v - 0.82) / 0.18, 0.0, 1.0);
            let crown = sqrt(max(1.0 - c * c, 0.0));
            let r = skirt * body * crown;
            p = vec3f(cos(a) * r, 1.35 * select(v, 0.82 + 0.18 * sin(c * 1.5708), v > 0.82), sin(a) * r);
            n = normalize(vec3f(cos(a), 0.25 + c, sin(a)));
        }
        case 5: {
            // flame: tapering, the top sways and wobbles on twos
            let v = uv.y;
            let st = floor(time * 12.0) / 12.0;
            let taper = mix(1.0, 0.25, pow(v, 1.4)) * (1.0 + (valueNoise2(vec2f(uv.x * 6.0, v * 3.0 - st * 2.0 + seed * 9.0)) - 0.5) * 0.35 * v);
            let sway = vec2f(sin(st * 3.0 + seed * 6.0), cos(st * 2.3 + seed * 4.0)) * 0.12 * v * v;
            p = vec3f(p.x * taper + sway.x, p.y, p.z * taper + sway.y);
        }
        case 6: {
            // aura: licks pushed out at the top of the shell
            let v = uv.y;
            let st = floor(time * 12.0) / 12.0;
            let lick = valueNoise2(vec2f(uv.x * 9.0, v * 4.0 - st * 3.0 + seed * 5.0));
            p = p + n * smoothstep(0.55, 1.0, v) * lick * 0.18;
        }
        case 7: {
            // fire tornado: a cone, narrow at the floor, swaying higher up
            let v = uv.y;
            let r = mix(0.22, 1.0, pow(v, 1.3));
            let sway = vec2f(sin(time * 2.0 + v * 4.0 + seed * 6.0), cos(time * 1.7 + v * 3.0)) * 0.15 * v;
            p = vec3f(p.x * r + sway.x, p.y, p.z * r + sway.y);
        }
        case 13: {
            // smoke: lumps of noise grown with age
            let lumps = fbm3(p * 1.8 + vec3f(seed * 10.0, 0.0, 0.0), 3, 2.0, 0.5);
            p = p * (1.0 + lumps * 0.35) * (0.6 + 0.4 * easeOutCubic(clamp(age * 2.0, 0.0, 1.0)));
        }
        case 15: {
            // paper storm: the cylinder breathes and leans
            let v = uv.y;
            p = vec3f(p.x * (1.0 + 0.15 * sin(time * 3.0 + v * 6.0)), p.y, p.z * (1.0 + 0.15 * sin(time * 3.0 + v * 6.0)));
        }
        case 16: {
            // water crown: flared out toward the rim
            let v = uv.y;
            let flare = 1.0 + v * v * max(uniforms.vfxD.z, 0.6);
            p = vec3f(p.x * flare, p.y, p.z * flare);
            n = normalize(vec3f(n.x, -v * 0.8, n.z));
        }
        default: {}
    }

    // --- place it -------------------------------------------------------------------------------------------
    let m = uniforms.world;
    var wp: vec3f;
    var nw = normalize((m * vec4f(n, 0.0)).xyz);
    let mode = i32(uniforms.vfxD.x + 0.5);
    let origin = (m * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    if (mode == 1) {
        // a quad turned to the camera, rolled by vfxD.w, sized by the world matrix's x and y scales
        let right = vec3f(uniforms.view[0].x, uniforms.view[1].x, uniforms.view[2].x);
        let up = vec3f(uniforms.view[0].y, uniforms.view[1].y, uniforms.view[2].y);
        let q = rotate2(p.xy, uniforms.vfxD.w);
        wp = origin + right * q.x * colLen(m, 0) + up * q.y * colLen(m, 1);
        nw = normalize(uniforms.cameraPosition - origin);
    } else if (mode == 2) {
        // a ribbon along the local z axis, turned about it to face the camera
        let axisFull = (m * vec4f(0.0, 0.0, 1.0, 0.0)).xyz;
        let axis = normalize(axisFull);
        let alongP = origin + axisFull * p.z;
        let toCam = normalize(uniforms.cameraPosition - alongP);
        var side = cross(axis, toCam);
        if (length(side) < 1e-4) {
            side = vec3f(1.0, 0.0, 0.0);
        }
        side = normalize(side);
        wp = alongP + side * p.x * colLen(m, 0);
        nw = toCam;
    } else {
        wp = (m * vec4f(p, 1.0)).xyz;
    }

    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vUV = uv;
    vertexOutputs.vLocal = p;
    vertexOutputs.vNormalW = nw;
    vertexOutputs.vWorld = wp;
    vertexOutputs.vViewZ = (uniforms.view * vec4f(wp, 1.0)).z;
}
