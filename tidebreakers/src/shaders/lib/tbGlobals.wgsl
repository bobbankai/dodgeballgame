// tbGlobals — the frame-wide uniform block shared by every Tidebreakers material and post pass.
// Layout is mirrored in src/render/Globals.ts (all members are vec4f / mat4x4f so there is no padding).

struct TBGlobals {
  time: vec4f,          // x seconds, y delta, z frame, w slow time (paused cutscenes keep it moving)
  sunDir: vec4f,        // xyz unit vector toward the sun, w intensity
  sunColor: vec4f,      // rgb, w = terminator softness (0 hard cel .. 1 soft)
  skyColor: vec4f,      // ambient from above
  groundColor: vec4f,   // ambient bounce from below
  shadowTint: vec4f,    // rgb multiplier painted into shadowed regions, w = shadow saturation boost
  rimColor: vec4f,      // rgb, w strength
  fogColor: vec4f,      // rgb, w density
  fogParams: vec4f,     // x height falloff, y fog base height, z start distance, w sun in-scatter
  camPos: vec4f,        // xyz camera position, w = time scale (slow motion)
  shadowMat: mat4x4f,   // world -> shadow clip space (cascade 0)
  shadowMat1: mat4x4f,  // world -> shadow clip space (cascade 1, wide)
  shadowParams: vec4f,  // x texel size, y depth bias, z normal bias, w strength (0 disables)
  shadowSplit: vec4f,   // x cascade-0 radius, y cascade-0 centre fade, z,w unused
  wind: vec4f,          // xy direction, z strength, w gust phase
  grade: vec4f,         // x exposure, y saturation, z contrast, w warmth
  flash: vec4f,         // rgb global flash colour, w amount (lightning, impacts)
  viewport: vec4f,      // width, height, 1/width, 1/height
  sea: vec4f,           // x sea level, y wave amplitude scale, z choppiness, w storm
  seaColor: vec4f,      // deep water colour, w = foam amount
  seaShallow: vec4f,    // shallow water colour, w = shore foam width
  counts: vec4f,        // x number of point lights, y debug view, z quality (0 low 1 med 2 high), w unused
  lightPos: array<vec4f, 12>, // xyz position, w radius
  lightCol: array<vec4f, 12>, // rgb colour, w intensity
};

var<uniform> globals: TBGlobals;
