// FXAA (after Timothy Lottes' FXAA 3.11, quality preset ~12) on the final sRGB image: cleans up the
// stair-steps that post effects add after the multisampled scene (ink lines, impact frames).
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_color>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;

uniform rcpFrame: vec2f;
uniform fxaaParams: vec4f;   // subpix, edge threshold, edge threshold min, enabled

fn lumaS(uv: vec2f) -> f32 {
    return lumaRec601(textureSampleLevel(source, sourceSampler, uv, 0.0).rgb);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let rgbM = textureSampleLevel(source, sourceSampler, uv, 0.0);
    if (uniforms.fxaaParams.w < 0.5) {
        fragmentOutputs.color = rgbM;
        return fragmentOutputs;
    }
    let f = uniforms.rcpFrame;
    let lumaM = lumaRec601(rgbM.rgb);
    let lumaN = lumaS(uv + vec2f(0.0, -f.y));
    let lumaS_ = lumaS(uv + vec2f(0.0, f.y));
    let lumaE = lumaS(uv + vec2f(f.x, 0.0));
    let lumaW = lumaS(uv + vec2f(-f.x, 0.0));
    let maxL = max(max(lumaN, lumaS_), max(lumaE, max(lumaW, lumaM)));
    let minL = min(min(lumaN, lumaS_), min(lumaE, min(lumaW, lumaM)));
    let range = maxL - minL;
    if (range < max(uniforms.fxaaParams.z, maxL * uniforms.fxaaParams.y)) {
        fragmentOutputs.color = rgbM;
        return fragmentOutputs;
    }
    let lumaNW = lumaS(uv + vec2f(-f.x, -f.y));
    let lumaNE = lumaS(uv + vec2f(f.x, -f.y));
    let lumaSW = lumaS(uv + vec2f(-f.x, f.y));
    let lumaSE = lumaS(uv + vec2f(f.x, f.y));
    let lumaNS = lumaN + lumaS_;
    let lumaWE = lumaW + lumaE;
    let subpixA = (2.0 * (lumaNS + lumaWE) + (lumaNW + lumaNE + lumaSW + lumaSE)) / 12.0;
    let subpixB = clamp(abs(subpixA - lumaM) / range, 0.0, 1.0);
    let subpixC = (-2.0 * subpixB + 3.0) * subpixB * subpixB;
    let subpix = subpixC * subpixC * uniforms.fxaaParams.x;
    let edgeHorz = abs(-2.0 * lumaW + lumaNW + lumaSW) + 2.0 * abs(-2.0 * lumaM + lumaN + lumaS_) + abs(-2.0 * lumaE + lumaNE + lumaSE);
    let edgeVert = abs(-2.0 * lumaS_ + lumaSW + lumaSE) + 2.0 * abs(-2.0 * lumaM + lumaW + lumaE) + abs(-2.0 * lumaN + lumaNW + lumaNE);
    let horzSpan = edgeHorz >= edgeVert;
    var lengthSign = select(f.x, f.y, horzSpan);
    let lumaA = select(lumaW, lumaN, horzSpan);
    let lumaB = select(lumaE, lumaS_, horzSpan);
    let gradA = abs(lumaA - lumaM);
    let gradB = abs(lumaB - lumaM);
    let pairN = gradA >= gradB;
    if (pairN) {
        lengthSign = -lengthSign;
    }
    let gradient = max(gradA, gradB);
    let lumaLocal = select((lumaB + lumaM) * 0.5, (lumaA + lumaM) * 0.5, pairN);
    var posB = uv;
    if (horzSpan) {
        posB.y = posB.y + lengthSign * 0.5;
    } else {
        posB.x = posB.x + lengthSign * 0.5;
    }
    let offNP = select(vec2f(0.0, f.y), vec2f(f.x, 0.0), horzSpan);
    var posN = posB - offNP;
    var posP = posB + offNP;
    var lumaEndN = lumaS(posN) - lumaLocal;
    var lumaEndP = lumaS(posP) - lumaLocal;
    let gradScaled = gradient * 0.25;
    var doneN = abs(lumaEndN) >= gradScaled;
    var doneP = abs(lumaEndP) >= gradScaled;
    var steps = array<f32, 8>(1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0);
    for (var i = 0; i < 8; i++) {
        if (doneN && doneP) {
            break;
        }
        if (!doneN) {
            posN = posN - offNP * steps[i];
            lumaEndN = lumaS(posN) - lumaLocal;
            doneN = abs(lumaEndN) >= gradScaled;
        }
        if (!doneP) {
            posP = posP + offNP * steps[i];
            lumaEndP = lumaS(posP) - lumaLocal;
            doneP = abs(lumaEndP) >= gradScaled;
        }
    }
    let dstN = select(uv.y - posN.y, uv.x - posN.x, horzSpan);
    let dstP = select(posP.y - uv.y, posP.x - uv.x, horzSpan);
    let directionN = dstN < dstP;
    let lumaEnd = select(lumaEndP, lumaEndN, directionN);
    let spanLength = dstP + dstN;
    let dst = min(dstN, dstP);
    let goodSpan = ((lumaEnd < 0.0) != ((lumaM - lumaLocal) < 0.0));
    let pixelOffset = select(0.0, -dst / spanLength + 0.5, goodSpan);
    let finalOffset = max(pixelOffset, subpix);
    var fuv = uv;
    if (horzSpan) {
        fuv.y = fuv.y + finalOffset * lengthSign;
    } else {
        fuv.x = fuv.x + finalOffset * lengthSign;
    }
    fragmentOutputs.color = vec4f(textureSampleLevel(source, sourceSampler, fuv, 0.0).rgb, 1.0);
}
