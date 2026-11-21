// ============================================================================================
// vb_common: constants, remapping, shaping and easing functions shared by every shader.
// Pure functions only (no bindings), so this file can be included anywhere, in any stage.
// ============================================================================================

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;
const HALF_PI: f32 = 1.57079632679490;
const INV_PI: f32 = 0.31830988618379;
const INV_TAU: f32 = 0.15915494309190;
const PHI: f32 = 1.61803398874989;
const GOLDEN_ANGLE: f32 = 2.39996322972865;
const SQRT2: f32 = 1.41421356237310;
const SQRT3: f32 = 1.73205080756888;
const EPSILON: f32 = 1e-5;
const BIG: f32 = 1e20;
const LUMA709: vec3f = vec3f(0.2126, 0.7152, 0.0722);

// --- small arithmetic -----------------------------------------------------------------------

fn sqr(x: f32) -> f32 { return x * x; }
fn sqr2(x: vec2f) -> vec2f { return x * x; }
fn sqr3(x: vec3f) -> vec3f { return x * x; }
fn cube(x: f32) -> f32 { return x * x * x; }
fn pow4f(x: f32) -> f32 { let x2 = x * x; return x2 * x2; }
fn pow5f(x: f32) -> f32 { let x2 = x * x; return x2 * x2 * x; }
fn pow8f(x: f32) -> f32 { let x2 = x * x; let x4 = x2 * x2; return x4 * x4; }

fn maxc2(v: vec2f) -> f32 { return max(v.x, v.y); }
fn maxc3(v: vec3f) -> f32 { return max(v.x, max(v.y, v.z)); }
fn maxc4(v: vec4f) -> f32 { return max(max(v.x, v.y), max(v.z, v.w)); }
fn minc2(v: vec2f) -> f32 { return min(v.x, v.y); }
fn minc3(v: vec3f) -> f32 { return min(v.x, min(v.y, v.z)); }
fn minc4(v: vec4f) -> f32 { return min(min(v.x, v.y), min(v.z, v.w)); }
fn sumc3(v: vec3f) -> f32 { return v.x + v.y + v.z; }
fn avgc3(v: vec3f) -> f32 { return (v.x + v.y + v.z) * (1.0 / 3.0); }

fn safeDiv(a: f32, b: f32) -> f32 {
    return a / select(b, select(-EPSILON, EPSILON, b >= 0.0), abs(b) < EPSILON);
}

fn safeRcp(x: f32) -> f32 {
    return 1.0 / max(abs(x), EPSILON) * select(-1.0, 1.0, x >= 0.0);
}

fn safeNormalize2(v: vec2f) -> vec2f {
    let l = length(v);
    return select(vec2f(0.0, 1.0), v / l, l > EPSILON);
}

fn safeNormalize3(v: vec3f) -> vec3f {
    let l = length(v);
    return select(vec3f(0.0, 1.0, 0.0), v / l, l > EPSILON);
}

fn safeSqrt(x: f32) -> f32 { return sqrt(max(x, 0.0)); }
fn safeAcos(x: f32) -> f32 { return acos(clamp(x, -1.0, 1.0)); }
fn safeAsin(x: f32) -> f32 { return asin(clamp(x, -1.0, 1.0)); }
fn safePow(x: f32, p: f32) -> f32 { return pow(max(x, 0.0), p); }
fn safePow3(x: vec3f, p: f32) -> vec3f { return pow(max(x, vec3f(0.0)), vec3f(p)); }

// floored modulo (WGSL % truncates toward zero)
fn fmod1(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn fmod2(x: vec2f, y: vec2f) -> vec2f { return x - y * floor(x / y); }
fn fmod3(x: vec3f, y: vec3f) -> vec3f { return x - y * floor(x / y); }
fn wrapAngle(a: f32) -> f32 { return fmod1(a + PI, TAU) - PI; }

// --- remapping ------------------------------------------------------------------------------

fn remap(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
    return c + (x - a) * (d - c) / (b - a);
}

fn remapClamped(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
    return c + clamp((x - a) / (b - a), 0.0, 1.0) * (d - c);
}

fn remap01(x: f32, a: f32, b: f32) -> f32 {
    return clamp((x - a) / (b - a), 0.0, 1.0);
}

fn linstep(a: f32, b: f32, x: f32) -> f32 {
    return clamp((x - a) / (b - a), 0.0, 1.0);
}

fn smootherstep(a: f32, b: f32, x: f32) -> f32 {
    let t = clamp((x - a) / (b - a), 0.0, 1.0);
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn smoothstepSym(center: f32, width: f32, x: f32) -> f32 {
    return smoothstep(center - width, center + width, x);
}

// a bump that is 1 at c and 0 beyond c +- w (cubic falloff)
fn cubicPulse(c: f32, w: f32, x: f32) -> f32 {
    let d = abs(x - c);
    if (d > w) {
        return 0.0;
    }
    let t = d / w;
    return 1.0 - t * t * (3.0 - 2.0 * t);
}

// a window that rises over [a, b] and falls over [c, d]
fn trapezoid(a: f32, b: f32, c: f32, d: f32, x: f32) -> f32 {
    return linstep(a, b, x) * (1.0 - linstep(c, d, x));
}

fn quantize(x: f32, steps: f32) -> f32 {
    return floor(x * steps) / steps;
}

fn quantize3(x: vec3f, steps: f32) -> vec3f {
    return floor(x * steps) / steps;
}

fn quantizeSoft(x: f32, steps: f32, softness: f32) -> f32 {
    let s = x * steps;
    let f = fract(s);
    let k = smoothstep(0.5 - softness, 0.5 + softness, f);
    return (floor(s) + k) / steps;
}

// Schlick's bias and gain: cheap, controllable curves for artist-facing parameters
fn biasCurve(x: f32, b: f32) -> f32 {
    return x / ((1.0 / b - 2.0) * (1.0 - x) + 1.0);
}

fn gainCurve(x: f32, g: f32) -> f32 {
    if (x < 0.5) {
        return biasCurve(x * 2.0, g) * 0.5;
    }
    return 1.0 - biasCurve(2.0 - 2.0 * x, g) * 0.5;
}

fn expImpulse(x: f32, k: f32) -> f32 {
    let h = k * x;
    return h * exp(1.0 - h);
}

fn sustainedImpulse(x: f32, f: f32, k: f32) -> f32 {
    let s = max(x - f, 0.0);
    return min(x * x / (f * f), 1.0 + (2.0 / f) * s * exp(-k * s));
}

fn parabola(x: f32, k: f32) -> f32 {
    return pow(4.0 * x * (1.0 - x), k);
}

fn powerCurve(x: f32, a: f32, b: f32) -> f32 {
    let k = pow(a + b, a + b) / (pow(a, a) * pow(b, b));
    return k * pow(x, a) * pow(1.0 - x, b);
}

// --- smooth minimum / maximum ------------------------------------------------------------------

fn sminPoly(a: f32, b: f32, k: f32) -> f32 {
    let h = max(k - abs(a - b), 0.0) / max(k, EPSILON);
    return min(a, b) - h * h * k * 0.25;
}

fn smaxPoly(a: f32, b: f32, k: f32) -> f32 {
    return -sminPoly(-a, -b, k);
}

fn sminExp(a: f32, b: f32, k: f32) -> f32 {
    let r = exp2(-a / k) + exp2(-b / k);
    return -k * log2(r);
}

fn sminCubic(a: f32, b: f32, k: f32) -> f32 {
    let h = max(k - abs(a - b), 0.0) / max(k, EPSILON);
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

fn softClamp(x: f32, lo: f32, hi: f32, k: f32) -> f32 {
    return smaxPoly(lo, sminPoly(hi, x, k), k);
}

// --- periodic waves ---------------------------------------------------------------------------

fn triWave(x: f32) -> f32 { return 1.0 - abs(2.0 * fract(x) - 1.0); }
fn sawWave(x: f32) -> f32 { return fract(x); }
fn squareWave(x: f32) -> f32 { return step(0.5, fract(x)); }
fn sinWave01(x: f32) -> f32 { return 0.5 + 0.5 * sin(x * TAU); }
fn pulseWave(x: f32, duty: f32) -> f32 { return step(fract(x), duty); }
fn pingPong(x: f32, len: f32) -> f32 {
    let t = fmod1(x, len * 2.0);
    return len - abs(t - len);
}

// a smooth step function: the value rises in soft steps (good for stepped animation of noise)
fn stairs(x: f32, sharpness: f32) -> f32 {
    let f = fract(x);
    return floor(x) + smoothstep(0.5 - 0.5 / sharpness, 0.5 + 0.5 / sharpness, f);
}

// --- easing -----------------------------------------------------------------------------------

fn easeInQuad(t: f32) -> f32 { return t * t; }
fn easeOutQuad(t: f32) -> f32 { return t * (2.0 - t); }
fn easeInOutQuad(t: f32) -> f32 {
    return select(-1.0 + (4.0 - 2.0 * t) * t, 2.0 * t * t, t < 0.5);
}
fn easeInCubic(t: f32) -> f32 { return t * t * t; }
fn easeOutCubic(t: f32) -> f32 { let u = t - 1.0; return u * u * u + 1.0; }
fn easeInOutCubic(t: f32) -> f32 {
    return select((t - 1.0) * (2.0 * t - 2.0) * (2.0 * t - 2.0) + 1.0, 4.0 * t * t * t, t < 0.5);
}
fn easeInQuart(t: f32) -> f32 { return t * t * t * t; }
fn easeOutQuart(t: f32) -> f32 { let u = t - 1.0; return 1.0 - u * u * u * u; }
fn easeInExpo(t: f32) -> f32 { return select(exp2(10.0 * t - 10.0), 0.0, t <= 0.0); }
fn easeOutExpo(t: f32) -> f32 { return select(1.0 - exp2(-10.0 * t), 1.0, t >= 1.0); }
fn easeInOutExpo(t: f32) -> f32 {
    if (t <= 0.0) { return 0.0; }
    if (t >= 1.0) { return 1.0; }
    return select((2.0 - exp2(-20.0 * t + 10.0)) * 0.5, exp2(20.0 * t - 10.0) * 0.5, t < 0.5);
}
fn easeInCirc(t: f32) -> f32 { return 1.0 - sqrt(max(1.0 - t * t, 0.0)); }
fn easeOutCirc(t: f32) -> f32 { let u = t - 1.0; return sqrt(max(1.0 - u * u, 0.0)); }
fn easeOutBack(t: f32) -> f32 {
    let c1 = 1.70158;
    let c3 = c1 + 1.0;
    let u = t - 1.0;
    return 1.0 + c3 * u * u * u + c1 * u * u;
}
fn easeInBack(t: f32) -> f32 {
    let c1 = 1.70158;
    let c3 = c1 + 1.0;
    return c3 * t * t * t - c1 * t * t;
}
fn easeOutElastic(t: f32) -> f32 {
    if (t <= 0.0) { return 0.0; }
    if (t >= 1.0) { return 1.0; }
    return exp2(-10.0 * t) * sin((t * 10.0 - 0.75) * (TAU / 3.0)) + 1.0;
}
fn easeOutBounce(t0: f32) -> f32 {
    let n1 = 7.5625;
    let d1 = 2.75;
    var t = t0;
    if (t < 1.0 / d1) {
        return n1 * t * t;
    } else if (t < 2.0 / d1) {
        t = t - 1.5 / d1;
        return n1 * t * t + 0.75;
    } else if (t < 2.5 / d1) {
        t = t - 2.25 / d1;
        return n1 * t * t + 0.9375;
    }
    t = t - 2.625 / d1;
    return n1 * t * t + 0.984375;
}

// critically damped approach of x toward target over dt (frame-rate independent smoothing)
fn damp(x: f32, goal: f32, lambda: f32, dt: f32) -> f32 {
    return mix(x, goal, 1.0 - exp(-lambda * dt));
}

// --- antialiased thresholds (fragment stage only: they use derivatives) -------------------------

fn aastep(threshold: f32, x: f32) -> f32 {
    let w = max(fwidth(x), 1e-4) * 0.7;
    return smoothstep(threshold - w, threshold + w, x);
}

fn aastepWidth(threshold: f32, x: f32, widen: f32) -> f32 {
    let w = max(fwidth(x), 1e-4) * widen;
    return smoothstep(threshold - w, threshold + w, x);
}

fn aaband(lo: f32, hi: f32, x: f32) -> f32 {
    return aastep(lo, x) * (1.0 - aastep(hi, x));
}

// 1 on a thin line where x crosses an integer, line width in pixels
fn aagrid(x: f32, widthPx: f32) -> f32 {
    let d = abs(fract(x - 0.5) - 0.5) / max(fwidth(x), 1e-5);
    return 1.0 - clamp(d - widthPx * 0.5 + 0.5, 0.0, 1.0);
}
