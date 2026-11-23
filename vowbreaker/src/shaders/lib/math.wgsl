// ============================================================================================
// vb_math: rotations, quaternions, bases, coordinate mappings, depth and ray helpers.
// Depends on vb_common.
// ============================================================================================

fn rot2(a: f32) -> mat2x2f {
    let c = cos(a);
    let s = sin(a);
    return mat2x2f(c, s, -s, c);
}

fn rotate2(p: vec2f, a: f32) -> vec2f {
    let c = cos(a);
    let s = sin(a);
    return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn rotX(a: f32) -> mat3x3f {
    let c = cos(a);
    let s = sin(a);
    return mat3x3f(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

fn rotY(a: f32) -> mat3x3f {
    let c = cos(a);
    let s = sin(a);
    return mat3x3f(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

fn rotZ(a: f32) -> mat3x3f {
    let c = cos(a);
    let s = sin(a);
    return mat3x3f(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

fn rotAxis(axis: vec3f, a: f32) -> mat3x3f {
    let n = normalize(axis);
    let c = cos(a);
    let s = sin(a);
    let t = 1.0 - c;
    return mat3x3f(
        t * n.x * n.x + c, t * n.x * n.y + s * n.z, t * n.x * n.z - s * n.y,
        t * n.x * n.y - s * n.z, t * n.y * n.y + c, t * n.y * n.z + s * n.x,
        t * n.x * n.z + s * n.y, t * n.y * n.z - s * n.x, t * n.z * n.z + c);
}

fn rotEuler(e: vec3f) -> mat3x3f {
    return rotZ(e.z) * rotY(e.y) * rotX(e.x);
}

// --- quaternions (x, y, z, w) -------------------------------------------------------------------------

fn quatAxisAngle(axis: vec3f, a: f32) -> vec4f {
    let h = a * 0.5;
    return vec4f(normalize(axis) * sin(h), cos(h));
}

fn quatMul(a: vec4f, b: vec4f) -> vec4f {
    return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}

fn quatRotate(q: vec4f, v: vec3f) -> vec3f {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn quatConj(q: vec4f) -> vec4f { return vec4f(-q.xyz, q.w); }

fn quatSlerp(a: vec4f, b0: vec4f, t: f32) -> vec4f {
    var b = b0;
    var d = dot(a, b);
    if (d < 0.0) {
        b = -b;
        d = -d;
    }
    if (d > 0.9995) {
        return normalize(mix(a, b, t));
    }
    let th = acos(d);
    let s = sin(th);
    return (sin((1.0 - t) * th) * a + sin(t * th) * b) / s;
}

fn quatToMat3(q: vec4f) -> mat3x3f {
    let x2 = q.x + q.x;
    let y2 = q.y + q.y;
    let z2 = q.z + q.z;
    let xx = q.x * x2;
    let xy = q.x * y2;
    let xz = q.x * z2;
    let yy = q.y * y2;
    let yz = q.y * z2;
    let zz = q.z * z2;
    let wx = q.w * x2;
    let wy = q.w * y2;
    let wz = q.w * z2;
    return mat3x3f(1.0 - (yy + zz), xy + wz, xz - wy, xy - wz, 1.0 - (xx + zz), yz + wx, xz + wy, yz - wx, 1.0 - (xx + yy));
}

// --- bases -------------------------------------------------------------------------------------------------

// Duff et al. 2017: a branchless orthonormal basis around n
fn basisFromNormal(n: vec3f) -> mat3x3f {
    let s = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (s + n.z);
    let b = n.x * n.y * a;
    let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
    let bt = vec3f(b, s + n.y * n.y * a, -n.y);
    return mat3x3f(t, bt, n);
}

fn lookAtBasis(forward: vec3f, up: vec3f) -> mat3x3f {
    let f = normalize(forward);
    let r = normalize(cross(up, f));
    let u = cross(f, r);
    return mat3x3f(r, u, f);
}

// --- coordinate mappings --------------------------------------------------------------------------------

fn toPolar(p: vec2f) -> vec2f {
    return vec2f(length(p), atan2(p.y, p.x));
}

fn fromPolar(rp: vec2f) -> vec2f {
    return vec2f(cos(rp.y), sin(rp.y)) * rp.x;
}

// direction to equirectangular uv (u around Y, v from the zenith)
fn dirToEquirect(d: vec3f) -> vec2f {
    return vec2f(atan2(d.z, d.x) * INV_TAU + 0.5, safeAcos(d.y) * INV_PI);
}

fn equirectToDir(uv: vec2f) -> vec3f {
    let phi = (uv.x - 0.5) * TAU;
    let theta = uv.y * PI;
    return vec3f(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
}

// octahedral normal encoding (Cigolle et al.): unit vector <-> [-1, 1]^2
fn octWrap(v: vec2f) -> vec2f {
    return (1.0 - abs(v.yx)) * select(vec2f(-1.0), vec2f(1.0), v >= vec2f(0.0));
}

fn octEncode(n0: vec3f) -> vec2f {
    let n = n0 / (abs(n0.x) + abs(n0.y) + abs(n0.z));
    return select(octWrap(n.xy), n.xy, n.z >= 0.0);
}

fn octDecode(f: vec2f) -> vec3f {
    var n = vec3f(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    let t = clamp(-n.z, 0.0, 1.0);
    n = vec3f(n.x + select(t, -t, n.x >= 0.0), n.y + select(t, -t, n.y >= 0.0), n.z);
    return normalize(n);
}

// hemispherical (for a dome sky): direction with y >= 0 to a disk uv in [0, 1]^2
fn hemiToDisk(d: vec3f) -> vec2f {
    let r = safeAcos(d.y) / HALF_PI;
    let a = atan2(d.z, d.x);
    return vec2f(cos(a), sin(a)) * r * 0.5 + 0.5;
}

// cylindrical projection for wrapping patterns round a pillar or a lantern
fn cylindricalUV(p: vec3f, radius: f32) -> vec2f {
    return vec2f(atan2(p.z, p.x) * radius, p.y);
}

// --- depth and view-space reconstruction --------------------------------------------------------------------

// WebGPU depth is 0 at the near plane, 1 at the far plane (Babylon's default for perspective)
fn linearizeDepth(d: f32, near: f32, far: f32) -> f32 {
    return near * far / (far - d * (far - near));
}

// reversed-z variant
fn linearizeDepthReversed(d: f32, near: f32, far: f32) -> f32 {
    return near * far / (near + d * (far - near));
}

// view position from screen uv (0..1, y down) and linear view depth, given tan(fov/2) and aspect
fn viewPosFromDepth(uv: vec2f, viewZ: f32, tanHalfFov: f32, aspect: f32) -> vec3f {
    let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    return vec3f(ndc.x * tanHalfFov * aspect * viewZ, ndc.y * tanHalfFov * viewZ, viewZ);
}

// full reconstruction with an inverse projection (left-handed, Babylon convention)
fn viewPosFromNdc(uv: vec2f, depth: f32, invProj: mat4x4f) -> vec3f {
    let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
    let v = invProj * ndc;
    return v.xyz / v.w;
}

fn projectToUv(viewPos: vec3f, proj: mat4x4f) -> vec3f {
    let c = proj * vec4f(viewPos, 1.0);
    let ndc = c.xyz / c.w;
    return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z);
}

// --- ray intersections ---------------------------------------------------------------------------------------

// returns (tNear, tFar); tNear > tFar means a miss
fn raySphere(ro: vec3f, rd: vec3f, center: vec3f, radius: f32) -> vec2f {
    let oc = ro - center;
    let b = dot(oc, rd);
    let c = dot(oc, oc) - radius * radius;
    let h = b * b - c;
    if (h < 0.0) {
        return vec2f(1.0, -1.0);
    }
    let s = sqrt(h);
    return vec2f(-b - s, -b + s);
}

fn rayPlane(ro: vec3f, rd: vec3f, n: vec3f, d: f32) -> f32 {
    let denom = dot(rd, n);
    if (abs(denom) < 1e-6) {
        return -1.0;
    }
    return -(dot(ro, n) + d) / denom;
}

fn rayBox(ro: vec3f, rd: vec3f, bmin: vec3f, bmax: vec3f) -> vec2f {
    let inv = 1.0 / rd;
    let t0 = (bmin - ro) * inv;
    let t1 = (bmax - ro) * inv;
    let tmin = min(t0, t1);
    let tmax = max(t0, t1);
    return vec2f(maxc3(tmin), minc3(tmax));
}

fn rayCylinderY(ro: vec3f, rd: vec3f, radius: f32) -> vec2f {
    let a = dot(rd.xz, rd.xz);
    let b = dot(ro.xz, rd.xz);
    let c = dot(ro.xz, ro.xz) - radius * radius;
    let h = b * b - a * c;
    if (h < 0.0 || a < 1e-8) {
        return vec2f(1.0, -1.0);
    }
    let s = sqrt(h);
    return vec2f((-b - s) / a, (-b + s) / a);
}

// --- misc geometry ------------------------------------------------------------------------------------------------

fn distToSegment(p: vec3f, a: vec3f, b: vec3f) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

fn distToSegment2(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

fn barycentric2(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> vec3f {
    let v0 = b - a;
    let v1 = c - a;
    let v2 = p - a;
    let d00 = dot(v0, v0);
    let d01 = dot(v0, v1);
    let d11 = dot(v1, v1);
    let d20 = dot(v2, v0);
    let d21 = dot(v2, v1);
    let denom = d00 * d11 - d01 * d01;
    let v = (d11 * d20 - d01 * d21) / denom;
    let w = (d00 * d21 - d01 * d20) / denom;
    return vec3f(1.0 - v - w, v, w);
}

// screen-space aspect-correct coordinates centred on a point (for radial effects)
fn aspectCentered(uv: vec2f, center: vec2f, aspect: f32) -> vec2f {
    return vec2f((uv.x - center.x) * aspect, uv.y - center.y);
}

// reflect a direction about a plane with normal n through the origin (for planar mirrors)
fn reflectPoint(p: vec3f, n: vec3f, d: f32) -> vec3f {
    return p - 2.0 * (dot(p, n) + d) * n;
}

// a soft, rotating 2D wobble for hand-drawn jitter of lines and screen effects
fn handJitter(p: vec2f, t: f32, amp: f32, fps: f32) -> vec2f {
    let st = floor(t * fps);
    let a = vec2f(sin(st * 12.9898 + p.y * 3.1), cos(st * 78.233 + p.x * 2.7));
    return a * amp;
}
