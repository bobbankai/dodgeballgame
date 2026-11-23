// tbOutline — inverted-hull ink lines for characters and hero props.
// Back faces pushed out along the normal in clip space, so lines keep a stable pixel width that thins
// with distance and in creases (baked AO), thickens on hair.
attribute position: vec3f;
attribute normal: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
attribute uv2: vec2f;
#include<bonesDeclaration>
#include<instancesDeclaration>
#include<tbGlobals>
uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform fx: vec4f;      // y = width in pixels (at 1080p), w object id
varying vColor: vec3f;
varying vViewZ: f32;
varying vNormalV: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
#include<bonesVertex>
  let wp = finalWorld * vec4f(vertexInputs.position, 1.0);
  let nw = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
  var clip = uniforms.viewProjection * wp;
  let nc = (uniforms.viewProjection * vec4f(nw, 0.0)).xy;
  let len = max(length(nc), 1e-5);
  let cls = i32(round((1.0 - vertexInputs.uv2.y) * 10.0));
  var w = uniforms.fx.y * (globals.viewport.y / 1080.0);
  w = w * mix(0.35, 1.0, smoothstep(0.35, 0.85, vertexInputs.uv2.x));
  if (cls == 2) { w = w * 1.25; }
  if (cls == 5) { w = w * 0.4; }
  // distance attenuation: lines thin out far away but never vanish
  let dist = clip.w;
  w = w * clamp(3.5 / max(dist, 0.1), 0.35, 1.0);
  let off = (nc / len) * w * 2.0 * globals.viewport.zw * clip.w;
  clip = vec4f(clip.xy + off, clip.z + 0.00002 * clip.w, clip.w);
  vertexOutputs.position = clip;
#ifdef VERTEXCOLOR
  vertexOutputs.vColor = vertexInputs.color.rgb;
#else
  vertexOutputs.vColor = vec3f(0.5);
#endif
  vertexOutputs.vViewZ = (uniforms.view * wp).z;
  vertexOutputs.vNormalV = normalize((uniforms.view * vec4f(nw, 0.0)).xyz);
}
