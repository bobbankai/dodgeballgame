// Fluid helpers for the 2D stable-fluids solver (compute/fluid.wgsl) and for reading its result in
// the post chain (vbStylize). Grids are rgba16float textures addressed in texels; sampling is done
// by hand with textureLoad (bilinear, clamped) so the compute passes need no samplers.
//
// The fluid is ink in water seen from above the screen: techniques, domains and the Vow pour dye
// and push it around, the dye drifts, curls (vorticity confinement keeps the curls alive) and
// fades. vbStylize lays the dye over the image as ink and lets the velocity bend the image.

struct FluidParams {
    texel: vec2f,        // 1 / grid size
    size: vec2f,         // grid size
    dt: f32,
    velDissipation: f32, // per second
    dyeDissipation: f32,
    vorticity: f32,
    splatPos: vec2f,     // uv
    splatDir: vec2f,     // velocity added (grid units per second)
    splatColor: vec4f,   // rgb dye, a = amount
    splatRadius: f32,
    time: f32,
    pad0: f32,
    pad1: f32,
}

fn fluidClampCoord(c: vec2i, size: vec2f) -> vec2i {
    return clamp(c, vec2i(0), vec2i(size) - vec2i(1));
}

// bilinear sample of a grid texture at a position in texel units (0.5 = centre of texel 0)
fn fluidSample(tex: texture_2d<f32>, pos: vec2f, size: vec2f) -> vec4f {
    let st = pos - 0.5;
    let i = vec2i(floor(st));
    let f = fract(st);
    let a = textureLoad(tex, fluidClampCoord(i, size), 0);
    let b = textureLoad(tex, fluidClampCoord(i + vec2i(1, 0), size), 0);
    let c = textureLoad(tex, fluidClampCoord(i + vec2i(0, 1), size), 0);
    let d = textureLoad(tex, fluidClampCoord(i + vec2i(1, 1), size), 0);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn fluidLoad(tex: texture_2d<f32>, c: vec2i, size: vec2f) -> vec4f {
    return textureLoad(tex, fluidClampCoord(c, size), 0);
}

// a splat: a gaussian blob of dye or velocity (aspect-corrected so it is round on screen)
fn fluidSplat(uv: vec2f, center: vec2f, radius: f32, aspect: f32) -> f32 {
    var d = uv - center;
    d.x = d.x * aspect;
    return exp(-dot(d, d) / max(radius, 1e-5));
}

// edge walls: the velocity's normal component is cancelled at the border of the grid
fn fluidWall(v: vec2f, c: vec2i, size: vec2f) -> vec2f {
    var o = v;
    if (c.x <= 0 || c.x >= i32(size.x) - 1) {
        o.x = -o.x * 0.5;
    }
    if (c.y <= 0 || c.y >= i32(size.y) - 1) {
        o.y = -o.y * 0.5;
    }
    return o;
}

// --- reading the result in the post chain ------------------------------------------------------------

// ink from the dye: rgb is the dye's colour, a its density (posterised into wash bands so it reads
// as brushed ink rather than smoke)
fn fluidInk(dye: vec4f, bands: f32) -> vec4f {
    let dens = clamp(max(max(dye.r, dye.g), max(dye.b, dye.a)), 0.0, 1.0);
    let q = floor(dens * bands + 0.5) / bands;
    let stepped = mix(dens, q, 0.6);
    let col = dye.rgb / max(dens, 1e-3);
    return vec4f(col, stepped);
}
