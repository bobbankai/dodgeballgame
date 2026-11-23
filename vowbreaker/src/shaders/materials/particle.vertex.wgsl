// GPU particles: one quad per particle, read straight from the compute shader's storage buffer
// (bound as instanced vertex attributes, 20 floats each: see vb_psim). How a quad is oriented
// depends on the kind:
//   streaks   sparks, drops, rain and tears stretch along their velocity, turned to the camera
//   flat      petals, paper, leaves, feathers, snow and ash are cards with their own spin; when
//             they rest on the ground they lie flat on it
//   billboard everything else faces the camera, rotated by its spin
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute p0: vec4f;   // pos, life
attribute p1: vec4f;   // vel, maxLife
attribute p2: vec4f;   // colour
attribute p3: vec4f;   // size, kind, seed, drag
attribute p4: vec4f;   // rot, spin, state, extra

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vInfo: vec4f;   // kind, age (0..1), seed, speed
varying vInfo2: vec4f;  // state, extra, facing (flat cards: how much they face the camera), rot

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let life = vertexInputs.p0.w;
    let maxLife = max(vertexInputs.p1.w, 1e-3);
    let corner = vertexInputs.position.xy;
    var size = vertexInputs.p3.x;
    let kind = i32(vertexInputs.p3.y + 0.5);
    let seed = vertexInputs.p3.z;
    let rot = vertexInputs.p4.x;
    let state = vertexInputs.p4.z;
    if (life <= 0.0) {
        size = 0.0;
    }
    let age = 1.0 - clamp(life / maxLife, 0.0, 1.0);
    // most particles shrink at the end of their life; smoke grows (in the simulation); resting
    // things fade in the fragment stage instead
    let flatKind = kind == 3 || kind == 4 || kind == 6 || kind == 10 || kind == 14 || kind == 16;
    if (!flatKind && kind != 5 && kind != 12) {
        size = size * (1.0 - age * age * 0.7);
    }
    let center = vertexInputs.p0.xyz;
    let vel = vertexInputs.p1.xyz;
    let camRight = vec3f(uniforms.view[0][0], uniforms.view[1][0], uniforms.view[2][0]);
    let camUp = vec3f(uniforms.view[0][1], uniforms.view[1][1], uniforms.view[2][1]);
    let toCam = normalize(uniforms.cameraPosition - center);
    var wp: vec3f;
    var facing = 1.0;
    let speed = length(vel);
    let streak = kind == 0 || kind == 7 || kind == 11 || kind == 17;
    if (streak && speed > 0.5) {
        let d = vel / speed;
        let side = normalize(cross(d, toCam) + vec3f(1e-5));
        let stretch = select(1.0 + min(speed * 0.08, 3.0), 1.0 + min(speed * 0.25, 8.0), kind == 11);
        wp = center + d * corner.y * size * stretch + side * corner.x * size * select(0.35, 0.12, kind == 11);
    } else if (flatKind) {
        if (state > 0.5) {
            // lying on the ground
            let a = rot + seed * 6.28;
            let r2 = vec2f(corner.x * cos(a) - corner.y * sin(a), corner.x * sin(a) + corner.y * cos(a));
            wp = center + vec3f(r2.x, 0.0, r2.y) * size;
            facing = abs(toCam.y);
        } else {
            // a card spinning about an axis tilted by its seed: its width narrows edge-on
            let axis = normalize(vec3f(cos(seed * 6.28), 0.6, sin(seed * 6.28)));
            let tangent = normalize(cross(axis, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4));
            let bit = cross(axis, tangent);
            let across = tangent * cos(rot) + bit * sin(rot);
            wp = center + axis * corner.y * size + across * corner.x * size;
            facing = abs(dot(normalize(cross(axis, across)), toCam));
        }
    } else {
        let a = seed * 6.2831 + rot;
        let c = cos(a);
        let s = sin(a);
        let rc = vec2f(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
        wp = center + (camRight * rc.x + camUp * rc.y) * size;
    }
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vUV = corner + 0.5;
    vertexOutputs.vColor = vertexInputs.p2;
    vertexOutputs.vInfo = vec4f(f32(kind), age, seed, speed);
    vertexOutputs.vInfo2 = vec4f(state, vertexInputs.p4.w, facing, rot);
}
