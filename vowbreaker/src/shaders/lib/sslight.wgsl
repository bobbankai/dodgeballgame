// Screen-space lighting (vbContact, vbGi), read from the G-buffer (octahedral view normal in rg,
// linear view depth in b) at half resolution, applied in vbComposite.
//
//   contact shadows   a short march from each pixel toward the sun through the depth buffer: where
//                     the ray passes behind something close (a foot, a hand, a step, a prop) the
//                     pixel is in its shadow. The shadow map is too coarse for these; they are what
//                     makes a character stand on the floor instead of floating over it
//   bounce light      one bounce of colour from the pixels round each point (screen-space indirect):
//                     a lantern-red wall tints the shadowed side of a fighter beside it, a sunlit
//                     floor lifts the underside of a chin. Cheap and approximate, by design

fn sslViewPos(uv: vec2f, z: f32, proj: vec4f) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    return vec3f(ndc.x * proj.x * proj.y * z, ndc.y * proj.x * z, z);
}

fn sslUv(p: vec3f, proj: vec4f) -> vec2f {
    let ndc = vec2f(p.x / (p.z * proj.x * proj.y), p.y / (p.z * proj.x));
    return ndc * 0.5 + 0.5;
}

// march toward the light in view space; 1 = lit, 0 = in a contact shadow
fn sslContactShadow(gbuf: texture_2d<f32>, smp: sampler, uv: vec2f, proj: vec4f, lightV: vec3f, len: f32, thickness: f32, jitter: f32) -> f32 {
    let g = textureSampleLevel(gbuf, smp, uv, 0.0);
    let z = g.b;
    if (z > 400.0) {
        return 1.0;
    }
    let n = octDecode(g.rg);
    // surfaces facing away from the light are already dark in the cel shading
    if (dot(n, lightV) <= 0.0) {
        return 1.0;
    }
    let p0 = sslViewPos(uv, z, proj) + n * 0.02 * z * 0.05;
    let steps = 12;
    var shadow = 0.0;
    for (var i = 0; i < steps; i++) {
        let t = (f32(i) + jitter) / f32(steps);
        let p = p0 + lightV * len * t * t;
        let suv = sslUv(p, proj);
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 || p.z < 0.1) {
            break;
        }
        let sz = textureSampleLevel(gbuf, smp, suv, 0.0).b;
        let dz = p.z - sz;
        if (dz > 0.01 && dz < thickness) {
            // softer the further along the ray the blocker is
            shadow = max(shadow, 1.0 - t * 0.6);
        }
    }
    // contact shadows belong to things near the eye; far away they would only speckle edges
    return 1.0 - shadow * (1.0 - smoothstep(18.0, 30.0, z));
}

// one bounce from a disc of samples round the pixel (scene colour, view positions and normals)
fn sslBounce(scene: texture_2d<f32>, sceneSmp: sampler, gbuf: texture_2d<f32>, smp: sampler, uv: vec2f, proj: vec4f, radius: f32, rot: f32) -> vec3f {
    let g = textureSampleLevel(gbuf, smp, uv, 0.0);
    let z = g.b;
    if (z > 400.0) {
        return vec3f(0.0);
    }
    let n = octDecode(g.rg);
    let p = sslViewPos(uv, z, proj);
    // the disc shrinks with distance (radius is in metres)
    let r = radius / max(z * proj.x * 2.0, 0.05);
    var acc = vec3f(0.0);
    var wsum = 0.0;
    for (var i = 0; i < 10; i++) {
        let fi = f32(i);
        let a = fi * 2.39996 + rot;
        let rr = sqrt((fi + 0.5) / 10.0) * r;
        let suv = uv + vec2f(cos(a), sin(a)) * rr * vec2f(1.0 / proj.y, 1.0);
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
            continue;
        }
        let gs = textureSampleLevel(gbuf, smp, suv, 0.0);
        if (gs.b > 400.0) {
            continue;
        }
        let ps = sslViewPos(suv, gs.b, proj);
        let d = ps - p;
        let dist = length(d);
        if (dist < 0.02 || dist > radius * 2.0) {
            continue;
        }
        let dir = d / dist;
        let ns = octDecode(gs.rg);
        // light leaves the sample's surface toward us and arrives on ours
        let geo = max(dot(n, dir), 0.0) * max(dot(ns, -dir), 0.0);
        let fall = 1.0 / (1.0 + dist * dist * 2.0);
        let c = textureSampleLevel(scene, sceneSmp, suv, 0.0).rgb;
        acc = acc + c * geo * fall;
        wsum = wsum + 1.0;
    }
    return acc / max(wsum, 1.0) * 2.0;
}
