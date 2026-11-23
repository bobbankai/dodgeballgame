// ============================================================================================
// vb_color: colour spaces, grading operators and tone mapping curves.
// All grading happens in linear Rec.709 unless a function says otherwise.
// Depends on vb_common.
// ============================================================================================

// --- transfer functions ------------------------------------------------------------------------

fn srgbToLinear1(c: f32) -> f32 {
    return select(pow((c + 0.055) / 1.055, 2.4), c / 12.92, c <= 0.04045);
}

fn srgbToLinear(c: vec3f) -> vec3f {
    return vec3f(srgbToLinear1(c.r), srgbToLinear1(c.g), srgbToLinear1(c.b));
}

fn linearToSrgb1(c: f32) -> f32 {
    return select(1.055 * pow(max(c, 0.0), 1.0 / 2.4) - 0.055, c * 12.92, c <= 0.0031308);
}

fn linearToSrgb(c: vec3f) -> vec3f {
    return vec3f(linearToSrgb1(c.r), linearToSrgb1(c.g), linearToSrgb1(c.b));
}

fn gammaToLinear(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }
fn linearToGamma(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2)); }

fn luma(c: vec3f) -> f32 { return dot(c, LUMA709); }
fn lumaRec601(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

// hex-like helper: 0..255 integers to linear colour
fn rgb255(r: f32, g: f32, b: f32) -> vec3f {
    return srgbToLinear(vec3f(r, g, b) / 255.0);
}

// --- HSV / HSL ------------------------------------------------------------------------------------

fn rgbToHsv(c: vec3f) -> vec3f {
    let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
    let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsvToRgb(c: vec3f) -> vec3f {
    let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

fn hueToRgb(h: f32) -> vec3f {
    let r = abs(h * 6.0 - 3.0) - 1.0;
    let g = 2.0 - abs(h * 6.0 - 2.0);
    let b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3f(r, g, b), vec3f(0.0), vec3f(1.0));
}

fn rgbToHsl(c: vec3f) -> vec3f {
    let hsv = rgbToHsv(c);
    let l = hsv.z * (1.0 - hsv.y * 0.5);
    let s = select((hsv.z - l) / min(l, 1.0 - l), 0.0, l <= 0.0 || l >= 1.0);
    return vec3f(hsv.x, s, l);
}

fn hslToRgb(c: vec3f) -> vec3f {
    let rgb = hueToRgb(c.x);
    let k = (1.0 - abs(2.0 * c.z - 1.0)) * c.y;
    return (rgb - 0.5) * k + c.z;
}

// --- perceptual spaces: OKLab / OKLCh (Björn Ottosson) ----------------------------------------------

fn linearToOklab(c: vec3f) -> vec3f {
    let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    let l_ = pow(max(l, 0.0), 1.0 / 3.0);
    let m_ = pow(max(m, 0.0), 1.0 / 3.0);
    let s_ = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_);
}

fn oklabToLinear(c: vec3f) -> vec3f {
    let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;
    return vec3f(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

fn oklabToOklch(c: vec3f) -> vec3f {
    return vec3f(c.x, length(c.yz), atan2(c.z, c.y));
}

fn oklchToOklab(c: vec3f) -> vec3f {
    return vec3f(c.x, c.y * cos(c.z), c.y * sin(c.z));
}

// mix two colours perceptually (no muddy midpoints between complementary hues)
fn mixOklab(a: vec3f, b: vec3f, t: f32) -> vec3f {
    return oklabToLinear(mix(linearToOklab(a), linearToOklab(b), t));
}

// --- YCoCg (cheap, reversible; used for chroma operations) ---------------------------------------------

fn rgbToYCoCg(c: vec3f) -> vec3f {
    return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}

fn yCoCgToRgb(c: vec3f) -> vec3f {
    let t = c.x - c.z;
    return vec3f(t + c.y, c.x + c.z, t - c.y);
}

// --- grading operators --------------------------------------------------------------------------------

fn adjustSaturation(c: vec3f, s: f32) -> vec3f {
    let l = luma(c);
    return max(mix(vec3f(l), c, s), vec3f(0.0));
}

// vibrance: boosts muted colours more than already saturated ones (protects skin and the red accents)
fn adjustVibrance(c: vec3f, v: f32) -> vec3f {
    let mx = maxc3(c);
    let mn = minc3(c);
    let sat = (mx - mn) / max(mx, 1e-4);
    let l = luma(c);
    return max(mix(vec3f(l), c, 1.0 + v * (1.0 - sat)), vec3f(0.0));
}

fn adjustContrast(c: vec3f, contrast: f32, pivot: f32) -> vec3f {
    // in log space so the shadows don't crush
    let lc = log2(max(c, vec3f(1e-6)));
    let lp = log2(pivot);
    return exp2((lc - lp) * contrast + lp);
}

fn adjustExposure(c: vec3f, ev: f32) -> vec3f {
    return c * exp2(ev);
}

fn hueRotate(c: vec3f, angle: f32) -> vec3f {
    // Rodrigues rotation about the grey axis
    let k = vec3f(0.57735);
    let ca = cos(angle);
    return c * ca + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - ca);
}

// ASC CDL: out = (in * slope + offset) ^ power, then saturation
fn ascCdl(c: vec3f, slope: vec3f, offset: vec3f, power: vec3f, sat: f32) -> vec3f {
    let v = pow(max(c * slope + offset, vec3f(0.0)), power);
    return adjustSaturation(v, sat);
}

// lift / gamma / gain (DaVinci-like): lift moves the blacks, gain the whites, gamma the mids
fn liftGammaGain(c: vec3f, lift: vec3f, gamma: vec3f, gain: vec3f) -> vec3f {
    let lg = c * gain + lift * (1.0 - c);
    return pow(max(lg, vec3f(0.0)), 1.0 / max(gamma, vec3f(0.01)));
}

// shadows / midtones / highlights colour balance with smooth luminance masks
fn shadowsMidsHighs(c: vec3f, sh: vec3f, mid: vec3f, hi: vec3f, shStart: f32, shEnd: f32, hiStart: f32, hiEnd: f32) -> vec3f {
    let l = luma(c);
    let ws = 1.0 - smoothstep(shStart, shEnd, l);
    let wh = smoothstep(hiStart, hiEnd, l);
    let wm = 1.0 - ws - wh;
    return c * sh * ws + c * mid * wm + c * hi * wh;
}

// split toning: tint the shadows one hue and the highlights another, balanced around a pivot
fn splitTone(c: vec3f, shadowTint: vec3f, highlightTint: vec3f, balance: f32, strength: f32) -> vec3f {
    let l = clamp(luma(c), 0.0, 1.0);
    let t = smoothstep(0.0, 1.0, l + balance);
    let tint = mix(shadowTint, highlightTint, t);
    let soft = softLight3(c, tint);
    return mix(c, soft, strength);
}

fn softLight1(a: f32, b: f32) -> f32 {
    if (b < 0.5) {
        return 2.0 * a * b + a * a * (1.0 - 2.0 * b);
    }
    return sqrt(max(a, 0.0)) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b);
}

fn softLight3(a: vec3f, b: vec3f) -> vec3f {
    return vec3f(softLight1(a.r, b.r), softLight1(a.g, b.g), softLight1(a.b, b.b));
}

fn overlay1(a: f32, b: f32) -> f32 {
    return select(1.0 - 2.0 * (1.0 - a) * (1.0 - b), 2.0 * a * b, a < 0.5);
}

fn overlay3(a: vec3f, b: vec3f) -> vec3f {
    return vec3f(overlay1(a.r, b.r), overlay1(a.g, b.g), overlay1(a.b, b.b));
}

fn screen3(a: vec3f, b: vec3f) -> vec3f { return 1.0 - (1.0 - a) * (1.0 - b); }
fn colorDodge3(a: vec3f, b: vec3f) -> vec3f { return a / max(1.0 - b, vec3f(1e-3)); }
fn colorBurn3(a: vec3f, b: vec3f) -> vec3f { return 1.0 - (1.0 - a) / max(b, vec3f(1e-3)); }
fn linearLight3(a: vec3f, b: vec3f) -> vec3f { return a + 2.0 * b - 1.0; }
fn multiplyBlend(a: vec3f, b: vec3f, t: f32) -> vec3f { return mix(a, a * b, t); }

// channel mixer: each output channel a mix of the inputs
fn channelMix(c: vec3f, r: vec3f, g: vec3f, b: vec3f) -> vec3f {
    return vec3f(dot(c, r), dot(c, g), dot(c, b));
}

// Kelvin to a linear-sRGB white (Tanner Helland's fit, normalised to the green channel)
fn kelvinToRgb(k: f32) -> vec3f {
    let t = clamp(k, 1000.0, 40000.0) / 100.0;
    var r: f32;
    var g: f32;
    var b: f32;
    if (t <= 66.0) {
        r = 1.0;
        g = clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0);
    } else {
        r = clamp(1.29293618606 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
        g = clamp(1.12989086089 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
    }
    if (t >= 66.0) {
        b = 1.0;
    } else if (t <= 19.0) {
        b = 0.0;
    } else {
        b = clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0);
    }
    return srgbToLinear(vec3f(r, g, b));
}

// white balance in LMS space (Bradford-ish), temperature/tint in [-1, 1] like most grading tools
fn whiteBalance(c: vec3f, temperature: f32, tint: f32) -> vec3f {
    let t1 = temperature * 10.0 / 6.0;
    let t2 = tint * 10.0 / 6.0;
    let x = 0.31271 - t1 * select(0.05, 0.1, t1 < 0.0);
    let standardIlluminantY = 2.87 * x - 3.0 * x * x - 0.27509507;
    let y = standardIlluminantY + t2 * 0.05;
    let w1 = vec3f(0.949237, 1.03542, 1.08728);
    let Y = 1.0;
    let X = Y * x / y;
    let Z = Y * (1.0 - x - y) / y;
    let L = 0.7328 * X + 0.4296 * Y - 0.1624 * Z;
    let M = -0.7036 * X + 1.6975 * Y + 0.0061 * Z;
    let S = 0.0030 * X + 0.0136 * Y + 0.9834 * Z;
    let w2 = vec3f(L, M, S);
    let balance = w1 / w2;
    let toLms = mat3x3f(0.3904, 0.0708, 0.0232, 0.5499, 0.9631, 0.1361, 0.0089, 0.0013, 0.9361);
    let fromLms = mat3x3f(2.85847, -0.210182, -0.0418120, -1.62879, 1.15820, -0.118169, -0.0248910, 0.000324281, 1.06867);
    let lms = toLms * c;
    return fromLms * (lms * balance);
}

// blackbody radiation colour (normalised): fire, embers, heated metal
fn blackbody(tempK: f32) -> vec3f {
    let t = tempK / 1000.0;
    var col = vec3f(1.0);
    col.r = 1.0;
    col.g = clamp(0.1 + 0.39 * log(t) - 0.03 * t, 0.0, 1.0);
    col.b = clamp(-0.2 + 0.45 * log(max(t - 1.0, 0.01)), 0.0, 1.0);
    let k = clamp((t - 0.8) / 3.0, 0.0, 1.0);
    return col * col * k;
}

// iq cosine palette: a + b * cos(TAU * (c * t + d))
fn cosinePalette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
    return a + b * cos(TAU * (c * t + d));
}

fn posterize(c: vec3f, levels: f32) -> vec3f {
    return floor(c * levels + 0.5) / levels;
}

// posterize luminance only, keeping hue: graphic-novel flats
fn posterizeLuma(c: vec3f, levels: f32) -> vec3f {
    let l = max(luma(c), 1e-4);
    let q = floor(l * levels + 0.5) / levels;
    return c * (q / l);
}

// keep one hue band in colour and drain the rest (flashbacks keep only red, say)
fn selectiveColor(c: vec3f, keepHue: f32, width: f32, drain: f32) -> vec3f {
    let hsv = rgbToHsv(c);
    var dh = abs(hsv.x - keepHue);
    dh = min(dh, 1.0 - dh);
    let keep = (1.0 - smoothstep(width * 0.5, width, dh)) * smoothstep(0.08, 0.25, hsv.y);
    return mix(mix(c, vec3f(luma(c)), drain), c, keep);
}

// --- tone mapping -------------------------------------------------------------------------------------------

fn tonemapReinhard(c: vec3f) -> vec3f { return c / (1.0 + c); }

fn tonemapReinhardExtended(c: vec3f, whitePoint: f32) -> vec3f {
    let l = luma(c);
    let ln = l * (1.0 + l / (whitePoint * whitePoint)) / (1.0 + l);
    return c * (ln / max(l, 1e-5));
}

// Narkowicz' fit of the ACES RRT+ODT
fn tonemapAcesFilm(c: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let cc = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((c * (a * c + b)) / (c * (cc * c + d) + e), vec3f(0.0), vec3f(1.0));
}

// Stephen Hill's fitted ACES (with the input/output matrices, hue-preserving-ish)
fn rrtAndOdtFit(v: vec3f) -> vec3f {
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

fn tonemapAcesFitted(c: vec3f) -> vec3f {
    let inMat = mat3x3f(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
    let outMat = mat3x3f(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
    var v = inMat * c;
    v = rrtAndOdtFit(v);
    v = outMat * v;
    return clamp(v, vec3f(0.0), vec3f(1.0));
}

fn hableCurve(x: vec3f) -> vec3f {
    let A = 0.15;
    let B = 0.50;
    let C = 0.10;
    let D = 0.20;
    let E = 0.02;
    let F = 0.30;
    return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

fn tonemapUncharted2(c: vec3f) -> vec3f {
    let W = 11.2;
    let curr = hableCurve(c * 2.0);
    let whiteScale = 1.0 / hableCurve(vec3f(W));
    return curr * whiteScale;
}

// Timothy Lottes' curve (GDC 2016), with contrast, shoulder, hdrMax, midIn, midOut
fn tonemapLottes(c: vec3f) -> vec3f {
    let a = 1.6;
    let d = 0.977;
    let hdrMax = 8.0;
    let midIn = 0.18;
    let midOut = 0.267;
    let b = (-pow(midIn, a) + pow(hdrMax, a) * midOut) / ((pow(hdrMax, a * d) - pow(midIn, a * d)) * midOut);
    let cc = (pow(hdrMax, a * d) * pow(midIn, a) - pow(hdrMax, a) * pow(midIn, a * d) * midOut) / ((pow(hdrMax, a * d) - pow(midIn, a * d)) * midOut);
    let x = max(c, vec3f(0.0));
    return pow(x, vec3f(a)) / (pow(x, vec3f(a * d)) * b + cc);
}

// Hajime Uchimura's Gran Turismo curve: linear mid section, controllable toe and shoulder
fn uchimura1(x: f32, P: f32, a: f32, m: f32, l: f32, c: f32, b: f32) -> f32 {
    let l0 = ((P - m) * l) / a;
    let S0 = m + l0;
    let S1 = m + a * l0;
    let C2 = (a * P) / (P - S1);
    let CP = -C2 / P;
    let w0 = 1.0 - smoothstep(0.0, m, x);
    let w2 = step(m + l0, x);
    let w1 = 1.0 - w0 - w2;
    let T = m * pow(x / m, c) + b;
    let S = P - (P - S1) * exp(CP * (x - S0));
    let L = m + a * (x - m);
    return T * w0 + L * w1 + S * w2;
}

fn tonemapUchimura(c: vec3f) -> vec3f {
    let P = 1.0;
    let a = 1.0;
    let m = 0.22;
    let l = 0.4;
    let cc = 1.33;
    let b = 0.0;
    return vec3f(uchimura1(c.r, P, a, m, l, cc, b), uchimura1(c.g, P, a, m, l, cc, b), uchimura1(c.b, P, a, m, l, cc, b));
}

// Khronos PBR Neutral: keeps base colours faithful up to a point, then desaturates the very bright
fn tonemapKhronosNeutral(cin: vec3f) -> vec3f {
    let startCompression = 0.8 - 0.04;
    let desaturation = 0.15;
    let x = minc3(cin);
    let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
    var c = cin - offset;
    let peak = maxc3(c);
    if (peak < startCompression) {
        return c;
    }
    let d = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    c = c * (newPeak / peak);
    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(c, vec3f(newPeak), g);
}

// AgX (Troy Sobotka), polynomial approximation of the default contrast curve (Benjamin Wrensch)
fn agxContrast(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn tonemapAgx(c: vec3f, punch: f32) -> vec3f {
    let agxMat = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    let agxInv = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
    let minEv = -12.47393;
    let maxEv = 4.026069;
    var v = agxMat * max(c, vec3f(1e-10));
    v = clamp(log2(v), vec3f(minEv), vec3f(maxEv));
    v = (v - minEv) / (maxEv - minEv);
    v = agxContrast(v);
    // "punchy" look: a little more saturation and contrast, as the format's own looks do
    let l = luma(v);
    v = pow(max(v, vec3f(0.0)), vec3f(1.0 + 0.35 * punch));
    v = vec3f(l) + (v - vec3f(l)) * (1.0 + 0.4 * punch);
    v = agxInv * v;
    return clamp(pow(max(v, vec3f(0.0)), vec3f(2.2)), vec3f(0.0), vec3f(1.0));
}

// the game's own curve: a filmic shoulder applied to luminance, with the hue carried through and
// saturated colours allowed to stay saturated (cursed energy reds and blues must not wash to white)
fn tonemapAnime(c: vec3f, shoulder: f32, desatBright: f32) -> vec3f {
    let l = luma(c);
    let lt = l / (1.0 + l * shoulder) * (1.0 + shoulder);
    let lm = 1.0 - exp(-lt * 1.15);
    var col = c * (lm / max(l, 1e-5));
    // colours whose channels exceed 1 bleed into white, but only gently
    let over = max(maxc3(col) - 1.0, 0.0);
    col = mix(col, vec3f(maxc3(col)), clamp(over * desatBright, 0.0, 1.0));
    return clamp(col, vec3f(0.0), vec3f(1.0));
}

// --- dithering --------------------------------------------------------------------------------------------------

// triangular-pdf dither of one 8-bit step: removes banding in dark gradients (night skies, fog)
fn ditherTriangular(c: vec3f, noise2: vec2f) -> vec3f {
    let n = noise2.x + noise2.y - 1.0;
    return c + vec3f(n / 255.0);
}
