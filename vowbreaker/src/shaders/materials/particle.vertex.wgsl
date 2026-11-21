// GPU particles: one quad per particle, read straight from the compute shader's storage buffer
// (bound as instanced vertex attributes). Sparks and streaks stretch along their velocity.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute p0: vec4f;   // pos, life
attribute p1: vec4f;   // vel, maxLife
attribute p2: vec4f;   // colour
attribute p3: vec4f;   // size, kind, seed, drag

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vInfo: vec4f;   // kind, age (0..1), seed, speed

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let life = vertexInputs.p0.w;
    let maxLife = max(vertexInputs.p1.w, 1e-3);
    let corner = vertexInputs.position.xy;
    var size = vertexInputs.p3.x;
    let kind = i32(vertexInputs.p3.y + 0.5);
    if (life <= 0.0) {
        size = 0.0;
    }
    let age = 1.0 - clamp(life / maxLife, 0.0, 1.0);
    // most particles shrink toward the end of their life
    if (kind != 5 && kind != 3 && kind != 4) {
        size = size * (1.0 - age * age * 0.7);
    } else if (kind == 5) {
        size = size * (1.0 + age * 1.5);
    }
    let center = vertexInputs.p0.xyz;
    let vel = vertexInputs.p1.xyz;
    let camRight = vec3f(uniforms.view[0][0], uniforms.view[1][0], uniforms.view[2][0]);
    let camUp = vec3f(uniforms.view[0][1], uniforms.view[1][1], uniforms.view[2][1]);
    var wp: vec3f;
    let speed = length(vel);
    if ((kind == 0 || kind == 7) && speed > 0.5) {
        // streak along the velocity, screen-facing
        let d = vel / speed;
        let toCam = normalize(uniforms.cameraPosition - center);
        let side = normalize(cross(d, toCam) + vec3f(1e-5));
        let len = size * (1.0 + min(speed * 0.08, 3.0));
        wp = center + d * corner.y * len + side * corner.x * size * 0.35;
    } else {
        let a = vertexInputs.p3.z * 6.2831 + age * select(0.0, 6.0, kind == 3 || kind == 4);
        let c = cos(a);
        let s = sin(a);
        let rc = vec2f(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
        wp = center + (camRight * rc.x + camUp * rc.y) * size;
    }
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vUV = corner + 0.5;
    vertexOutputs.vColor = vertexInputs.p2;
    vertexOutputs.vInfo = vec4f(f32(kind), age, vertexInputs.p3.z, speed);
}
