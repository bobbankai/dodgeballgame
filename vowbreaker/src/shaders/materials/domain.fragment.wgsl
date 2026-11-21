// Domain dome: a raymarched world behind the fighters, one scene per technique.
//   0 Temple of the Unrung Bell   giant bronze bells hanging on chains in a gold dusk over an ash sea
//   1 Garden of Folded Prayers    white paper torii and floating cranes in an ink-wash sky
//   2 Mirror Lake of Ten Thousand Moons   moons in a night sky, reflected in still water
//   3 Night Parade Without End    an endless avenue of torii and red lanterns under a bleeding sky
//   4 The burning memory          a corridor of burning apartment doors, ash falling upward
// The dome is revealed outward from the caster (reveal 0..1); fragments beyond the front are cut.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_sdf3d>
#include<vb_atmosphere>
#include<vb_toon>
#include<vb_water>
#include<vb_vfx>

varying vWorld: vec3f;

uniform cameraPosition: vec3f;
uniform domainParams: vec4f;   // id, reveal (0..1), time, intensity
uniform domainCenter: vec3f;

const MAX_STEPS: i32 = 64;
const MAX_DIST: f32 = 140.0;

// --- scene SDFs (returns distance and a material id) ----------------------------------------------

fn mapBells(p: vec3f, t: f32) -> vec2f {
    // a grid of bells hanging at different heights, swaying
    let cell = 14.0;
    let id = floor(p.xz / cell + 0.5);
    let h = hash22(id);
    var q = p;
    q = vec3f(p.x - id.x * cell, p.y, p.z - id.y * cell);
    let topY = 26.0 + h.x * 10.0;
    let sway = sin(t * 0.6 + h.y * 6.0) * 0.12;
    q = vec3f(q.x + sway * (topY - q.y) * 0.1, q.y, q.z);
    let bellY = 8.0 + h.y * 12.0;
    let bh = 4.0 + h.x * 3.0;
    let bell = sdBonsho(q - vec3f(0.0, bellY + bh, 0.0), bh);
    let chain = sdCapsule(q, vec3f(0.0, bellY + bh, 0.0), vec3f(0.0, 60.0, 0.0), 0.12);
    let near = length(id) < 1.5;
    var d = select(min(bell, chain), 1e5, near);
    var res = vec2f(d, 1.0);
    // the ash sea: a slow-heaving floor far below the arena line
    let sea = p.y + 1.5 + sin(p.x * 0.08 + t * 0.3) * 0.4 + cos(p.z * 0.07 - t * 0.25) * 0.4;
    res = opUnionId(res, vec2f(sea, 2.0));
    return res;
}

fn mapGarden(p: vec3f, t: f32) -> vec2f {
    // paper torii marching away in rings, cranes drifting between them
    let pr = opPolarRepeatY(p, 14.0);
    let q = vec3f(pr.x - 30.0, pr.y, pr.z);
    let torii = sdTorii3(q.zyx, 6.0, 9.0);
    var res = vec2f(torii, 3.0);
    let cell = vec3f(9.0, 7.0, 9.0);
    let cid = floor((p + vec3f(t * 0.6, 0.0, 0.0)) / cell);
    let cq = fmod3(p + vec3f(t * 0.6, 0.0, 0.0), cell) - cell * 0.5;
    let h = hash33(cid);
    let flap = sin(t * 4.0 + h.x * 10.0) * 0.4;
    let wing = sdBox3(rotZ(flap) * (cq - vec3f(0.0, h.y * 2.0, 0.0)), vec3f(1.1, 0.05, 0.5));
    let body = sdOctahedron(cq - vec3f(0.0, h.y * 2.0, 0.0), 0.5);
    let crane = select(min(wing, body), 1e5, length(cid.xz) < 2.0 || p.y < 3.0 || h.z < 0.5);
    res = opUnionId(res, vec2f(crane, 4.0));
    return res;
}

fn mapLake(p: vec3f, t: f32) -> vec2f {
    // stones standing in the water far away; the moons are painted in the sky
    let pr = opPolarRepeatY(p, 9.0);
    let q = vec3f(pr.x - 42.0, pr.y, pr.z);
    let stone = sdRoundBox3(q - vec3f(0.0, 2.0, 0.0), vec3f(1.2, 4.0 + hash11(pr.w) * 4.0, 1.0), 0.6);
    var res = vec2f(stone, 5.0);
    let water = p.y + 0.3;
    res = opUnionId(res, vec2f(water, 6.0));
    _ = t;
    return res;
}

fn mapParade(p: vec3f, t: f32) -> vec2f {
    // an avenue of torii along z, lanterns strung between them, endless in both directions
    let rep = 8.0;
    let z = fmod1(p.z + t * 1.5, rep) - rep * 0.5;
    let q = vec3f(p.x, p.y, z);
    let side = vec3f(abs(q.x) - 12.0, q.y, q.z);
    let torii = sdTorii3(vec3f(q.x, q.y, q.z), 26.0, 12.0);
    var res = vec2f(torii, 3.0);
    let lanternRow = sdChochin(vec3f(side.x, q.y - 7.0, q.z - 4.0), 0.8, 1.1);
    res = opUnionId(res, vec2f(lanternRow, 7.0));
    let ground = p.y + 0.2;
    res = opUnionId(res, vec2f(ground, 8.0));
    return res;
}

fn mapMemory(p: vec3f, t: f32) -> vec2f {
    // a corridor of apartment doors that never ends, burning
    let rep = 5.0;
    let x = fmod1(p.x, rep) - rep * 0.5;
    let walls = 9.0 - abs(p.z);
    let doors = sdBox3(vec3f(x, p.y - 2.0, abs(p.z) - 8.9), vec3f(1.0, 2.1, 0.2));
    var res = vec2f(-walls, 9.0);
    res = opUnionId(res, vec2f(doors, 10.0));
    let ceiling = 7.0 - p.y;
    res = opUnionId(res, vec2f(ceiling, 9.0));
    _ = t;
    return res;
}

fn mapScene(id: i32, p: vec3f, t: f32) -> vec2f {
    switch id {
        case 0: { return mapBells(p, t); }
        case 1: { return mapGarden(p, t); }
        case 2: { return mapLake(p, t); }
        case 3: { return mapParade(p, t); }
        default: { return mapMemory(p, t); }
    }
}

fn sceneNormal(id: i32, p: vec3f, t: f32) -> vec3f {
    let e = vec2f(0.02, 0.0);
    return normalize(vec3f(
        mapScene(id, p + e.xyy, t).x - mapScene(id, p - e.xyy, t).x,
        mapScene(id, p + e.yxy, t).x - mapScene(id, p - e.yxy, t).x,
        mapScene(id, p + e.yyx, t).x - mapScene(id, p - e.yyx, t).x));
}

// --- skies ------------------------------------------------------------------------------------------

fn domainSky(id: i32, d: vec3f, t: f32) -> vec3f {
    let up = clamp(d.y, -0.2, 1.0);
    switch id {
        case 0: {
            var c = mix(vec3f(1.6, 0.75, 0.25), vec3f(0.25, 0.08, 0.05), pow(max(up, 0.0), 0.5));
            let sun = pow(max(dot(d, normalize(vec3f(0.0, 0.15, 1.0))), 0.0), 60.0);
            c = c + vec3f(2.0, 1.2, 0.5) * sun;
            let rings = 0.5 + 0.5 * sin(length(d.xz / max(d.y + 0.3, 0.1)) * 3.0 - t * 0.5);
            return c * (0.85 + 0.15 * rings);
        }
        case 1: {
            let wash = vfbm2(d.xz / max(d.y + 0.4, 0.1) * 1.5 + vec2f(t * 0.02, 0.0), 4);
            var c = mix(vec3f(0.95, 0.93, 0.88), vec3f(0.55, 0.55, 0.6), smoothstep(0.4, 0.8, wash) * up);
            let ink = smoothstep(0.62, 0.66, wash) * 0.4;
            return c * (1.0 - ink);
        }
        case 2: {
            var c = mix(vec3f(0.05, 0.1, 0.22), vec3f(0.005, 0.01, 0.04), pow(max(up, 0.0), 0.6));
            // ten thousand moons: a field of crescents of every size
            let pr = d.xz / max(d.y + 0.15, 0.05);
            let cell = floor(pr * 1.3);
            let h = hash22(cell);
            let f = fract(pr * 1.3) - h;
            let moon = sdMoon(f * vec2f(3.0, 3.0), 0.25 + h.x * 0.3, 0.3 * (0.5 + h.y), 0.28 * (0.5 + h.y));
            let m = (1.0 - smoothstep(0.0, 0.03, moon)) * step(0.55, h.y) * smoothstep(0.0, 0.2, d.y);
            c = c + vec3f(1.2, 1.25, 1.4) * m + skyStars(d, t, 0.8);
            return c;
        }
        case 3: {
            var c = mix(vec3f(0.9, 0.12, 0.06), vec3f(0.08, 0.0, 0.02), pow(max(up, 0.0), 0.5));
            c = c * (0.7 + 0.5 * warpedFbm2(d.xz / max(d.y + 0.3, 0.1) * 0.6, t * 0.3));
            c = c + skyRibbons(d, t, vec3f(1.0, 0.25, 0.1));
            return c;
        }
        default: {
            let fire = fbm2(vec2f(atan2(d.z, d.x) * 3.0, d.y * 4.0 - t * 1.5), 4, 2.0, 0.5) * 0.5 + 0.5;
            return blackbody(1200.0 + fire * 1600.0) * (1.5 + fire) * smoothstep(-0.2, 0.4, d.y + fire * 0.3);
        }
    }
}

fn shadeHit(id: i32, mat: f32, p: vec3f, n: vec3f, rd: vec3f, t: f32) -> vec3f {
    let l = normalize(vec3f(0.3, 0.7, 0.6));
    let lit = smoothstep(0.45, 0.5, dot(n, l) * 0.5 + 0.5);
    let m = i32(mat + 0.5);
    var base = vec3f(0.5);
    var shadowC = vec3f(0.2);
    switch m {
        case 1: {
            base = vec3f(0.85, 0.55, 0.22);
            shadowC = vec3f(0.25, 0.1, 0.06);
            let bands = step(0.5, fract(p.y * 0.25));
            base = base * (0.85 + 0.15 * bands);
            let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
            return mix(shadowC, base, lit) + vec3f(1.5, 0.8, 0.3) * rim * 0.6;
        }
        case 2: {
            let ash = vfbm2(p.xz * 0.3 + t * 0.05, 3);
            return mix(vec3f(0.18, 0.12, 0.1), vec3f(0.45, 0.35, 0.3), ash) * (0.7 + 0.3 * lit);
        }
        case 3: {
            base = select(vec3f(0.95, 0.93, 0.9), vec3f(0.75, 0.08, 0.05), id == 3);
            shadowC = base * vec3f(0.5, 0.45, 0.6);
            return mix(shadowC, base, lit);
        }
        case 4: {
            return mix(vec3f(0.7, 0.68, 0.7), vec3f(1.0, 0.98, 0.95), lit) + vec3f(0.8, 0.1, 0.1) * step(0.97, fract(p.x * 3.0)) * 0.3;
        }
        case 5: {
            return mix(vec3f(0.02, 0.03, 0.06), vec3f(0.15, 0.2, 0.3), lit);
        }
        case 6: {
            // still water: mirror of the sky with ripples spreading from the moons
            let r = reflect(rd, vec3f(0.0, 1.0, 0.0));
            let rip = rainRipples(p.xz * 0.4, t * 0.3, 0.5);
            return domainSky(2, normalize(r + vec3f(rip.x, 0.0, rip.y) * 0.3), t) * 0.85;
        }
        case 7: {
            let flick = 0.8 + 0.2 * valueNoise2(vec2f(t * 6.0, floor(p.z * 0.2)));
            return vec3f(2.2, 0.6, 0.2) * flick;
        }
        case 8: {
            let tiles = step(0.06, fract(p.x * 0.5)) * step(0.06, fract(p.z * 0.5));
            return mix(vec3f(0.06, 0.02, 0.02), vec3f(0.25, 0.06, 0.05), tiles) * (0.6 + 0.4 * lit);
        }
        case 9: {
            let soot = vfbm2(p.xz * 0.4 + p.y, 3);
            return mix(vec3f(0.06, 0.03, 0.02), vec3f(0.3, 0.12, 0.06), soot) + blackbody(1500.0) * pow(soot, 6.0) * 4.0;
        }
        case 10: {
            return vec3f(0.12, 0.08, 0.06) + blackbody(1700.0) * smoothstep(0.6, 0.9, valueNoise2(p.xy * 2.0 + t)) * 2.0;
        }
        default: {
            return base * (0.5 + 0.5 * lit);
        }
    }
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let id = i32(uniforms.domainParams.x + 0.5);
    let reveal = uniforms.domainParams.y;
    let t = uniforms.domainParams.z;
    // the reveal: everything beyond the expanding front is still the real world
    let dFront = length(fragmentInputs.vWorld.xz - uniforms.domainCenter.xz);
    let front = reveal * 70.0;
    if (dFront > front && reveal < 0.999) {
        discard;
    }
    let ro = uniforms.cameraPosition;
    let rd = normalize(fragmentInputs.vWorld - ro);
    var col = domainSky(id, rd, t);
    var dist = 0.0;
    var hit = false;
    var mat = 0.0;
    for (var i = 0; i < MAX_STEPS; i++) {
        let p = ro + rd * dist;
        let r = mapScene(id, p, t);
        if (r.x < 0.01 * dist + 0.002) {
            hit = true;
            mat = r.y;
            break;
        }
        dist = dist + r.x * 0.9;
        if (dist > MAX_DIST) {
            break;
        }
    }
    if (hit) {
        let p = ro + rd * dist;
        let n = sceneNormal(id, p, t);
        let c = shadeHit(id, mat, p, n, rd, t);
        let fog = smoothstep(20.0, MAX_DIST, dist);
        col = mix(c, domainSky(id, rd, t) * 0.9, fog);
    }
    // the burning edge of the front as it sweeps outward
    let edge = smoothstep(front - 3.0, front, dFront) * step(reveal, 0.999);
    let pal = paletteFor(select(id, 0, id == 4));
    col = col + pal.body * edge * 3.0;
    fragmentOutputs.color = vec4f(col * uniforms.domainParams.w, 1.0);
}
