// ============================================================================================
// vb_brdf: reflectance models for the handful of materials that need more than a cel step:
// cloth sheen (velvet haori, the bride's silk), anisotropic metal (the temple bell, buckles),
// rough diffuse (stone, plaster), clear coat (lacquered torii), multi-scatter energy compensation.
// Results are meant to be stylized afterwards (stepped, tinted), so they return linear radiance
// factors for a unit light.
// Depends on vb_common, vb_lighting.
// ============================================================================================

// Burley / Disney diffuse: retro-reflection at grazing angles, darker rims for rough surfaces
fn disneyDiffuse(nl: f32, nv: f32, lh: f32, roughness: f32) -> f32 {
    let fd90 = 0.5 + 2.0 * roughness * lh * lh;
    let lightScatter = 1.0 + (fd90 - 1.0) * pow5f(1.0 - nl);
    let viewScatter = 1.0 + (fd90 - 1.0) * pow5f(1.0 - nv);
    return lightScatter * viewScatter * INV_PI;
}

// Oren-Nayar (qualitative): plaster, paper, cloth that is flat-looking in the light
fn orenNayar(n: vec3f, l: vec3f, v: vec3f, sigma: f32) -> f32 {
    let s2 = sigma * sigma;
    let A = 1.0 - 0.5 * s2 / (s2 + 0.33);
    let B = 0.45 * s2 / (s2 + 0.09);
    let nl = max(dot(n, l), 0.0);
    let nv = max(dot(n, v), 0.0);
    let thetaI = acos(clamp(nl, -1.0, 1.0));
    let thetaR = acos(clamp(nv, -1.0, 1.0));
    let alpha = max(thetaI, thetaR);
    let beta = min(thetaI, thetaR);
    let lp = normalize(l - n * nl + vec3f(1e-5));
    let vp = normalize(v - n * nv + vec3f(1e-5));
    let gamma = max(dot(lp, vp), 0.0);
    return nl * (A + B * gamma * sin(alpha) * tan(beta)) * INV_PI;
}

// Charlie sheen distribution (Estevez & Kulla 2017): soft velvet/silk highlight
fn charlieD(nh: f32, roughness: f32) -> f32 {
    let a = max(roughness * roughness, 0.0078125);
    let inv = 1.0 / a;
    let cos2 = nh * nh;
    let sin2 = 1.0 - cos2;
    return (2.0 + inv) * pow(max(sin2, 0.0), inv * 0.5) / (2.0 * PI);
}

// Ashikhmin's cloth visibility term, cheap and good enough under a sheen lobe
fn ashikhminV(nl: f32, nv: f32) -> f32 {
    return 1.0 / (4.0 * (nl + nv - nl * nv) + 1e-4);
}

fn sheen(n: vec3f, l: vec3f, v: vec3f, roughness: f32, color: vec3f) -> vec3f {
    let h = normalize(l + v);
    let nl = max(dot(n, l), 0.0);
    let nv = max(dot(n, v), 1e-4);
    let nh = max(dot(n, h), 0.0);
    return color * charlieD(nh, roughness) * ashikhminV(nl, nv) * nl;
}

// anisotropic GGX (Burley 2012): stretched highlights on brushed metal, along tangent t
fn ggxAnisoD(nh: f32, th: f32, bh: f32, ax: f32, ay: f32) -> f32 {
    let d = th * th / (ax * ax) + bh * bh / (ay * ay) + nh * nh;
    return 1.0 / (PI * ax * ay * d * d);
}

fn smithCorrelatedV(nl: f32, nv: f32, a: f32) -> f32 {
    let a2 = a * a;
    let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
    let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-5);
}

fn anisoSpecular(n: vec3f, t: vec3f, l: vec3f, v: vec3f, roughness: f32, anisotropy: f32, f0: vec3f) -> vec3f {
    let b = normalize(cross(n, t));
    let tt = cross(b, n);
    let h = normalize(l + v);
    let a = max(roughness * roughness, 0.002);
    let ax = max(a * (1.0 + anisotropy), 0.002);
    let ay = max(a * (1.0 - anisotropy), 0.002);
    let nl = max(dot(n, l), 0.0);
    let nv = max(dot(n, v), 1e-4);
    let D = ggxAnisoD(max(dot(n, h), 0.0), dot(tt, h), dot(b, h), ax, ay);
    let V = smithCorrelatedV(nl, nv, a);
    let F = fresnelSchlick3(max(dot(v, h), 0.0), f0);
    return D * V * F * nl;
}

// clear coat: a second, sharp lobe over a base (lacquer over red paint)
fn clearCoat(n: vec3f, l: vec3f, v: vec3f, coatRoughness: f32, strength: f32) -> f32 {
    let h = normalize(l + v);
    let nh = max(dot(n, h), 0.0);
    let nl = max(dot(n, l), 0.0);
    let D = ggxD(nh, coatRoughness);
    let V = 0.25 / max(dot(l, h) * dot(l, h), 1e-3);
    let F = fresnelSchlick(max(dot(v, h), 0.0), 0.04);
    return D * V * F * nl * strength;
}

// approximate directional albedo of GGX, used to add back the energy single scattering loses
fn ggxAlbedoApprox(nv: f32, roughness: f32) -> f32 {
    let r = roughness;
    return 1.0 - 1.4594 * r * nv * (-0.20277 + r * (2.772 + r * (-2.6175 + 0.4396 * r))) * (3.09507 + nv * (-9.11369 + nv * (15.8884 + nv * (-13.70343 + 4.47106 * nv))));
}

fn multiScatterCompensation(f0: vec3f, nv: f32, roughness: f32) -> vec3f {
    let e = clamp(ggxAlbedoApprox(nv, roughness), 0.2, 1.0);
    return 1.0 + f0 * (1.0 / e - 1.0);
}

// stylize any lobe into a crisp toon highlight shape with a soft halo
fn stylizeHighlight(x: f32, threshold: f32, halo: f32) -> f32 {
    return step(threshold, x) + smoothstep(threshold * 0.4, threshold, x) * halo;
}

// the bronze temple bell: warm metal, darker in the bands, a tight hot highlight
fn bronzeColor(base: vec3f, n: vec3f, v: vec3f, l: vec3f, lightCol: vec3f) -> vec3f {
    let f0 = vec3f(0.95, 0.64, 0.38);
    let spec = ggxSpecular(n, l, v, 0.35, f0);
    let env = mix(vec3f(0.12, 0.08, 0.05), vec3f(0.9, 0.6, 0.35), smoothstep(-0.3, 0.6, reflect(-v, n).y));
    return base * 0.25 + env * f0 * 0.6 + lightCol * stylizeHighlight(luma(spec), 0.6, 0.3) * 1.5;
}
