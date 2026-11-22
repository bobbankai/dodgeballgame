// Fire cards (vb_fire_sim): instanced quads standing on burning things, turned about their
// vertical axis to face the camera. Per instance: f0 = base position, card width; f1 = height,
// which slice of the simulation it shows (u offset), seed, intensity.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute f0: vec4f;
attribute f1: vec4f;

uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform cameraPosition: vec3f;

varying vUV: vec2f;
varying vCard: vec4f;     // u offset, seed, intensity, -
varying vViewZ: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let base = vertexInputs.f0.xyz;
    let w = vertexInputs.f0.w;
    let h = vertexInputs.f1.x;
    let toCam = uniforms.cameraPosition - base;
    let side = normalize(vec3f(toCam.z, 0.0, -toCam.x) + vec3f(1e-4, 0.0, 0.0));
    let corner = vertexInputs.position.xy + vec2f(0.0, 0.5);
    let wp = base + side * corner.x * w + vec3f(0.0, corner.y * h, 0.0);
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vUV = vec2f(corner.x + 0.5, corner.y);
    vertexOutputs.vCard = vec4f(vertexInputs.f1.y, vertexInputs.f1.z, vertexInputs.f1.w, 0.0);
    vertexOutputs.vViewZ = (uniforms.view * vec4f(wp, 1.0)).z;
}
