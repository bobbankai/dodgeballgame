// The passing train (vb_train): boxes for the cars, placed by the world matrix (the train moves).
// uv carries the position along the car (x) and up its side (y); the car's index comes from the
// mesh's own uniform.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute normal: vec3f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform carSize: vec4f;      // length, height, width, index

varying vWorldPos: vec3f;
varying vNormalW: vec3f;
varying vLocal: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let wp = (uniforms.world * vec4f(vertexInputs.position, 1.0)).xyz;
    vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
    vertexOutputs.vWorldPos = wp;
    vertexOutputs.vNormalW = normalize((uniforms.world * vec4f(vertexInputs.normal, 0.0)).xyz);
    // 0..1 along the car, 0..1 up it, -0.5..0.5 across
    vertexOutputs.vLocal = vec3f(vertexInputs.position.x / uniforms.carSize.x + 0.5, vertexInputs.position.y / uniforms.carSize.y + 0.5,
                                 vertexInputs.position.z / uniforms.carSize.z);
}
