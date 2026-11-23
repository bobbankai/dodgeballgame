// The festival crowd (crowd.vertex / crowd.fragment, src/render/Crowd.ts): background people built
// from one jointed low-poly body and animated entirely in the vertex shader, so a stage can be full
// of life for the cost of one draw.
//
// The body mesh carries a part id per vertex (torso, head, legs, arms, the prop) and every part is
// rotated about its own joint: legs swing about the hips, arms counter-swing about the shoulders,
// the body bobs twice per stride and leans into the walk. Behaviours (per instance):
//   0 stroll   walking a slow loop round the square, stopping now and then at a stall
//   1 idle     standing, weight shifting, head turning to look about
//   2 cheer    standing, arms raised and waving (round the arena when a fight is on)
//   3 flee     running, arms pumping (the burning village)
// Props: 0 none, 1 a paper lantern held up on a stick (it glows), 2 an uchiwa fan being waved,
// 3 a child on the shoulders, 4 a wagasa umbrella. Each prop is its own part (6..9) in the body
// mesh; the vertex stage collapses the ones an instance does not carry.

const CROWD_TORSO: i32 = 0;
const CROWD_HEAD: i32 = 1;
const CROWD_LEG_L: i32 = 2;
const CROWD_LEG_R: i32 = 3;
const CROWD_ARM_L: i32 = 4;
const CROWD_ARM_R: i32 = 5;
const CROWD_PROP: i32 = 6;

struct CrowdPose {
    legL: f32,
    legR: f32,
    armL: vec2f,     // (swing forward/back, raise sideways)
    armR: vec2f,
    bob: f32,
    lean: f32,
    headYaw: f32,
    propWave: f32,
}

fn crowdPose(behaviour: i32, phase: f32, time: f32, seed: f32, moving: f32) -> CrowdPose {
    var p: CrowdPose;
    let s = sin(phase);
    let c = cos(phase);
    switch behaviour {
        case 1: {
            // idle: weight shifts, the head looks about, arms hang
            let shift = sin(time * 0.6 + seed * 10.0);
            p.legL = shift * 0.05;
            p.legR = -shift * 0.05;
            p.armL = vec2f(0.05 * shift, 0.05);
            p.armR = vec2f(-0.05 * shift, 0.05);
            p.bob = abs(shift) * 0.01;
            p.lean = 0.0;
            p.headYaw = sin(time * 0.37 + seed * 20.0) * 0.7;
            p.propWave = sin(time * 3.0 + seed * 5.0);
        }
        case 2: {
            // cheering: arms up and waving, bouncing on the toes
            let wave = sin(time * 6.0 + seed * 7.0);
            p.legL = 0.0;
            p.legR = 0.0;
            p.armL = vec2f(0.2, 2.4 + wave * 0.3);
            p.armR = vec2f(0.2, 2.4 - wave * 0.3);
            p.bob = abs(sin(time * 6.0 + seed)) * 0.06;
            p.lean = -0.05;
            p.headYaw = sin(time * 0.9 + seed) * 0.3;
            p.propWave = wave;
        }
        case 3: {
            // fleeing: a long running stride, arms pumping
            p.legL = s * 0.9;
            p.legR = -s * 0.9;
            p.armL = vec2f(-s * 1.1, 0.25);
            p.armR = vec2f(s * 1.1, 0.25);
            p.bob = abs(c) * 0.09;
            p.lean = 0.3;
            p.headYaw = 0.0;
            p.propWave = 0.0;
        }
        default: {
            // strolling (or paused at a stall when not moving)
            p.legL = s * 0.45 * moving;
            p.legR = -s * 0.45 * moving;
            p.armL = vec2f(-s * 0.35 * moving, 0.08);
            p.armR = vec2f(s * 0.35 * moving, 0.08);
            p.bob = abs(c) * 0.035 * moving;
            p.lean = 0.06 * moving;
            p.headYaw = sin(time * 0.3 + seed * 13.0) * 0.4 * (1.0 - moving * 0.6);
            p.propWave = sin(time * 4.0 + seed * 3.0);
        }
    }
    return p;
}

// rotate a point about a pivot, about the body's x axis (swing) then z axis (raise)
fn crowdSwing(p: vec3f, pivot: vec3f, swing: f32, raise: f32, side: f32) -> vec3f {
    var q = p - pivot;
    q = rotX(swing) * q;
    q = rotZ(raise * side) * q;
    return q + pivot;
}

// pose one vertex of the body (local space, character facing +z, feet at y = 0, height 1)
fn crowdPoseVertex(p0: vec3f, part: i32, pose: CrowdPose) -> vec3f {
    var p = p0;
    let hipY = 0.48;
    let shoulderY = 0.8;
    switch part {
        case 2: { p = crowdSwing(p, vec3f(0.06, hipY, 0.0), pose.legL, 0.0, 1.0); }
        case 3: { p = crowdSwing(p, vec3f(-0.06, hipY, 0.0), pose.legR, 0.0, 1.0); }
        case 4: { p = crowdSwing(p, vec3f(0.14, shoulderY, 0.0), pose.armL.x, pose.armL.y, 1.0); }
        case 5: { p = crowdSwing(p, vec3f(-0.14, shoulderY, 0.0), pose.armR.x, pose.armR.y, -1.0); }
        case 1: { p = rotY(pose.headYaw) * (p - vec3f(0.0, 0.86, 0.0)) + vec3f(0.0, 0.86, 0.0); }
        case 6, 9: { p = crowdSwing(p, vec3f(-0.14, shoulderY, 0.0), pose.armR.x * 0.4, pose.armR.y * 0.4, -1.0); }
        case 7: { p = crowdSwing(p, vec3f(-0.14, shoulderY, 0.0), pose.armR.x * 0.5, pose.armR.y * 0.5 + pose.propWave * 0.35, -1.0); }
        default: {}
    }
    // the upper body leans into the walk and the whole figure bobs
    if (part != CROWD_LEG_L && part != CROWD_LEG_R && p.y > hipY) {
        p = rotX(pose.lean) * (p - vec3f(0.0, hipY, 0.0)) + vec3f(0.0, hipY, 0.0);
    }
    p.y = p.y + pose.bob;
    return p;
}

// yukata patterns by palette: stripes, dots, asanoha-ish lattice, flowers (uv on the body)
fn crowdFabric(uv: vec2f, kind: i32, base: vec3f, accent: vec3f) -> vec3f {
    switch kind {
        case 1: {
            let s = step(0.5, fract(uv.x * 18.0));
            return mix(base, accent, s * 0.6);
        }
        case 2: {
            let d = length(fract(uv * vec2f(14.0, 22.0)) - 0.5);
            return mix(base, accent, 1.0 - smoothstep(0.18, 0.24, d));
        }
        case 3: {
            let g = abs(fract(uv * vec2f(10.0, 16.0)) - 0.5);
            let l = 1.0 - smoothstep(0.0, 0.06, min(abs(g.x - g.y), min(g.x, g.y)));
            return mix(base, accent, l * 0.7);
        }
        case 4: {
            let rep = opPolarRepeat((fract(uv * vec2f(6.0, 9.0)) - 0.5) * 2.0, 5.0);
            let petal = sdVesica(rep.xy - vec2f(0.3, 0.0), 0.3, 0.16);
            return mix(base, accent, 1.0 - smoothstep(0.0, 0.03, petal));
        }
        default: {
            return base;
        }
    }
}
