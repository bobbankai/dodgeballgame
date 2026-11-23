// tbFace — procedural anime faces.
//
// Characters carry "face space" coordinates in TEXCOORD_0: x across the face and height above the chin,
// both in reference head units (Kai's head = 0.245 m chin-to-crown). Eyes, brows, lids, lashes, irises,
// mouth, teeth, tongue, tears and blush are drawn here as 2D distance fields, antialiased with the
// screen-space footprint of the coordinates. Expressions are parameters, so blinks, gaze, emotions and
// lip-sync animate continuously instead of swapping textures.
//
// FaceParams (all vec4f):
//   a: x eye open L, y eye open R, z look x (-1..1), w look y
//   b: x brow tilt (-1 sad .. +1 angry), y brow raise, z mouth open, w mouth curve (-1 frown .. +1 smile)
//   c: x mouth width scale, y tears, z blush, w happy-eyes (closed upward arcs)
//   d: x eye style (0 round, 1 sharp, 2 soft/lashes, 3 old), y eye size, z iris size, w teeth show
//   irisA / irisB: iris colours (top dark / bottom light), w = pupil darkness
//   ink: line colour rgb, w = line weight scale
//   misc: x mouth shout (wide open), y eye shine, z squint (lower lids up), w pain (asymmetric squeeze)

struct FaceParams {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
  irisA: vec4f,
  irisB: vec4f,
  ink: vec4f,
  misc: vec4f,
};

struct FaceOut {
  col: vec3f,
  cover: f32,   // 0..1 how much of the skin is replaced
  unlit: f32,   // 0..1 how much the result should ignore shading (eye whites, highlights)
};

fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
  // returns (distance, t along the segment)
  let pa = p - a;
  let ba = b - a;
  let h = saturate(dot(pa, ba) / dot(ba, ba));
  return vec2f(length(pa - ba * h), h);
}
fn sdEllipse2(p: vec2f, r: vec2f) -> f32 {
  // cheap ellipse distance (good near the edge)
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

// A lid / mouth curve across t = 0..1 between two corners with a bulge.
fn arcY(t: f32, y0: f32, y1: f32, bulge: f32, skew: f32) -> f32 {
  let tt = saturate(t);
  let s = pow(tt, skew);
  return mix(y0, y1, tt) + bulge * 4.0 * s * (1.0 - s);
}

// over-composite helper
fn over(dst: vec4f, col: vec3f, a: f32) -> vec4f {
  // straight-alpha "over": dst holds colour and coverage so far
  let aa = saturate(a);
  let na = aa + dst.a * (1.0 - aa);
  let rgb = (col * aa + dst.rgb * dst.a * (1.0 - aa)) / max(na, 1e-5);
  return vec4f(rgb, na);
}

fn drawEye(q: vec2f, fw: f32, open: f32, side: f32, fp: FaceParams, skin: vec3f) -> vec4f {
  // q: eye-local coords, +x outward, +y up, in reference units
  var res = vec4f(0.0);
  let style = fp.d.x;
  let sz = fp.d.y;
  let p = q / sz;
  let w = fw / sz;
  let inkC = fp.ink.rgb;
  let lw = fp.ink.w;
  // corners and lid shapes by style
  var xin = -0.0172;
  var xout = 0.0205;
  var yin = -0.0015;
  var yout = 0.0035;
  var up = 0.0215;
  var lo = 0.0165;
  var skewU = 1.15;
  if (style > 0.5 && style < 1.5) { up = 0.016; lo = 0.011; yout = 0.007; skewU = 1.45; }       // sharp
  if (style > 1.5 && style < 2.5) { up = 0.0235; lo = 0.0185; skewU = 1.05; }                  // soft
  if (style > 2.5) { up = 0.012; lo = 0.009; yout = 0.0; skewU = 1.2; }                           // old
  let squint = fp.misc.z;
  let t = (p.x - xin) / (xout - xin);
  let base = mix(yin, yout, saturate(t));
  let happy = fp.c.w;
  let o = saturate(open) * (1.0 - happy);
  // lids
  let yU = arcY(t, yin, yout, up, skewU);
  let yL = arcY(t, yin, yout, -lo * (1.0 - squint * 0.55), 0.9);
  let yUo = mix(yL + 0.001, yU, o);  // the upper lid comes down when closing
  let inX = t > 0.0 && t < 1.0;
  let insideV = min(p.y - yL, yUo - p.y);       // >0 inside the opening (vertical slack)
  let edgeX = min(t, 1.0 - t) * (xout - xin);
  let insideD = min(insideV, edgeX);
  let opening = select(0.0, aastep(-insideD, w), inX && o > 0.02);
  // sclera with lid shadow
  let lidShadow = smoothstep(0.009, 0.0, yUo - p.y);
  let sclera = mix(vec3f(0.97, 0.97, 0.99), mix(vec3f(0.8, 0.84, 0.95), skin * 0.9, 0.3), lidShadow * 0.8);
  res = over(res, sclera, opening);
  // iris
  let look = vec2f(fp.a.z * 0.0062 * side, fp.a.w * 0.004);
  let irs = fp.d.z;
  let ic = vec2f(0.0012, 0.0005) + look;
  let ir = vec2f(0.0118, 0.0158) * irs;
  let ip = p - ic;
  let di = sdEllipse2(ip, ir);
  let irisMask = aastep(di, w) * opening;
  let gy = saturate((ip.y + ir.y) / (2.0 * ir.y));
  var irisCol = mix(fp.irisB.rgb, fp.irisA.rgb, smoothstep(0.15, 0.95, gy));
  // limbal ring and a lighter crescent at the bottom
  irisCol = mix(irisCol, fp.irisA.rgb * 0.55, smoothstep(-0.0028, 0.0, di) * 0.85);
  let cres = sdEllipse2(ip - vec2f(0.0, -0.0055), vec2f(0.0075, 0.0055) * irs);
  irisCol = mix(irisCol, fp.irisB.rgb * 1.35 + 0.08, aastep(cres, w) * 0.55 * (1.0 - smoothstep(0.0, 0.004, ip.y + 0.002)));
  // pupil
  let dp = sdEllipse2(ip - vec2f(0.0, 0.0012), vec2f(0.0042, 0.0066) * irs);
  irisCol = mix(irisCol, fp.irisA.rgb * (1.0 - fp.irisA.w) * 0.35, aastep(dp, w) * 0.92);
  // lid shadow over the iris
  irisCol = irisCol * mix(1.0, 0.55, lidShadow);
  res = over(res, irisCol, irisMask);
  // highlights (bigger and wetter with tears)
  let shine = fp.misc.y + fp.c.y * 0.6;
  let h1 = sdEllipse2(ip - vec2f(-0.0042, 0.0062) * irs, vec2f(0.0034, 0.0042) * irs * (1.0 + shine * 0.35));
  let h2 = sdEllipse2(ip - vec2f(0.0045, -0.0062) * irs, vec2f(0.0017, 0.0017) * irs * (1.0 + shine * 0.5));
  let hl = max(aastep(h1, w), aastep(h2, w) * 0.9) * irisMask;
  res = over(res, vec3f(1.0), hl);
  if (shine > 0.4) {
    let h3 = sdEllipse2(ip - vec2f(0.0062, 0.003) * irs, vec2f(0.0012, 0.0012) * irs);
    res = over(res, vec3f(1.0), aastep(h3, w) * irisMask * (shine - 0.4));
  }
  // welling tears along the lower lid
  let tears = fp.c.y;
  if (tears > 0.01) {
    let well = smoothstep(0.0045, 0.0, p.y - yL) * opening * tears;
    res = over(res, mix(res.rgb, vec3f(0.75, 0.9, 1.0), 0.6), well * 0.7);
    let glint = aastep(abs(p.y - yL - 0.0016) - 0.0006, w) * select(0.0, 1.0, t > 0.25 && t < 0.75) * opening * tears;
    res = over(res, vec3f(1.0), glint);
  }
  // upper lid line: thick toward the outer corner, with a lash flick past it
  let ulw = (0.0011 + 0.0027 * smoothstep(0.0, 0.7, t)) * lw;
  let dU = abs(p.y - yUo - ulw * 0.6) - ulw;
  var lidLine = select(0.0, aastep(dU, w), t > -0.04 && t < 1.06);
  // flick: a small tapered wedge beyond the outer corner
  let fa = vec2f(xout - 0.001, yout + 0.0015);
  let fb = fa + vec2f(0.0062, 0.0042 + select(0.0, 0.002, style > 0.5));
  let fs = sdSegment(p, fa, fb);
  lidLine = max(lidLine, aastep(fs.x - (0.0022 * (1.0 - fs.y) + 0.0003) * lw, w) * select(0.0, 1.0, o > 0.15));
  if (style > 1.5 && style < 2.5) {
    // soft style: two extra lashes
    for (var k = 0; k < 2; k++) {
      let kk = f32(k);
      let la = vec2f(mix(xin, xout, 0.62 + kk * 0.18), arcY(0.62 + kk * 0.18, yin, yout, up, skewU) * o + yL * (1.0 - o));
      let ls = sdSegment(p, la, la + vec2f(0.0032 + kk * 0.001, 0.0042));
      lidLine = max(lidLine, aastep(ls.x - 0.0007 * (1.0 - ls.y) * lw, w) * select(0.0, 1.0, o > 0.3));
    }
  }
  // closed eye / happy eye arcs
  let closedArc = (1.0 - saturate(open * 3.0)) * (1.0 - happy);
  if (closedArc > 0.01) {
    let yc = arcY(t, yin - 0.001, yout - 0.001, -0.004, 1.0);
    let dc = abs(p.y - yc) - (0.0012 + 0.0016 * smoothstep(0.0, 0.8, t)) * lw;
    lidLine = max(lidLine, aastep(dc, w) * select(0.0, 1.0, inX) * closedArc);
  }
  if (happy > 0.01) {
    let yh = arcY(t, yin - 0.002, yout - 0.002, 0.012, 1.0);
    let dh = abs(p.y - yh) - (0.0013 + 0.0013 * sin(saturate(t) * PI)) * lw;
    lidLine = max(lidLine, aastep(dh, w) * select(0.0, 1.0, inX) * happy);
  }
  // lower lid: a thin partial line toward the outer corner
  let dL = abs(p.y - yL + 0.0004) - 0.00075 * lw;
  let lowLine = aastep(dL, w) * smoothstep(0.35, 0.7, t) * select(0.0, 1.0, t < 1.0) * 0.75 * saturate(o * 4.0);
  // double eyelid crease
  let dCr = abs(p.y - (arcY(t, yin, yout, up, skewU) * mix(0.6, 1.0, o) + 0.0058)) - 0.00055 * lw;
  let crease = aastep(dCr, w) * smoothstep(0.25, 0.45, t) * smoothstep(0.98, 0.8, t) * 0.55 * saturate(o * 3.0);
  res = over(res, inkC, max(max(lidLine, lowLine), crease));
  // pain: an extra squeeze line
  if (fp.misc.w > 0.01) {
    let dp2 = abs(p.y - (yU + 0.004 + (1.0 - t) * 0.003)) - 0.0006;
    res = over(res, inkC, aastep(dp2, w) * select(0.0, 1.0, inX) * fp.misc.w * 0.8);
  }
  return res;
}

fn drawBrow(q: vec2f, fw: f32, fp: FaceParams, side: f32) -> f32 {
  let tilt = fp.b.x;
  let raise = fp.b.y;
  let style = fp.d.x;
  // inner end lower when angry, higher when sad; outer end the other way
  let yi = 0.034 + raise * 0.006 - tilt * 0.0065;
  let yo = 0.0385 + raise * 0.0045 + tilt * 0.0025 - max(-tilt, 0.0) * 0.003;
  let a = vec2f(-0.0165, yi);
  let b = vec2f(0.0235, yo);
  // gentle arch
  let mid = (a + b) * 0.5 + vec2f(0.0, 0.0025 - tilt * 0.0008);
  let s1 = sdSegment(q, a, mid);
  let s2 = sdSegment(q, mid, b);
  var thick = 0.0028;
  if (style > 0.5 && style < 1.5) { thick = 0.0024; }
  if (style > 1.5 && style < 2.5) { thick = 0.0016; }
  if (style > 2.5) { thick = 0.0034; }
  let r1 = mix(thick, thick * 0.85, s1.y);
  let r2 = mix(thick * 0.85, thick * 0.35, s2.y);
  let d = min(s1.x - r1, s2.x - r2) ;
  return aastep(d, fw);
}

fn drawMouth(q: vec2f, fw: f32, fp: FaceParams, skin: vec3f) -> vec4f {
  var res = vec4f(0.0);
  let openA = saturate(fp.b.z);
  let curve = fp.b.w;
  let shout = fp.misc.x;
  let hw = 0.0105 * fp.c.x * (1.0 + 0.25 * openA + 0.45 * shout) * (1.0 + max(curve, 0.0) * 0.15);
  let t = q.x / hw;                   // -1..1 across
  let inX = abs(t) < 1.0;
  let tc = saturate(1.0 - t * t);
  // corners lift with a smile, drop with a frown
  let cornerY = curve * 0.0042;
  let midY = -curve * 0.0012;
  let lipLine = mix(cornerY, midY, tc);
  let o = openA * (0.0105 + 0.012 * shout);
  let yTop = lipLine + o * 0.25 * pow(tc, 0.6);
  let yBot = lipLine - o * pow(tc, 0.55) - max(curve, 0.0) * o * 0.25;
  let inside = min(q.y - yBot, yTop - q.y);
  let interior = select(0.0, aastep(-min(inside, (1.0 - abs(t)) * hw), fw), inX && openA > 0.03);
  var mcol = vec3f(0.36, 0.08, 0.1);
  // tongue
  let tongue = aastep(sdEllipse2(q - vec2f(0.0, yBot + o * 0.25), vec2f(hw * 0.55, o * 0.4)), fw);
  mcol = mix(mcol, vec3f(0.85, 0.35, 0.38), tongue * 0.9);
  // teeth band under the upper lip
  let teeth = aastep(q.y - yTop + o * 0.28 * fp.d.w + 0.0004, fw) * step(0.3, openA) * fp.d.w;
  mcol = mix(mcol, vec3f(0.98, 0.97, 0.95), teeth);
  res = over(res, mcol, interior);
  // outline: thicker at the centre of the closed line, tapered toward the corners
  let lw = fp.ink.w;
  let closedW = (0.00055 + 0.00045 * tc) * lw;
  let dLine = abs(q.y - lipLine) - closedW;
  let lineA = aastep(dLine, fw) * smoothstep(1.0, 0.75, abs(t)) * (1.0 - saturate(openA * 6.0));
  let rim = abs(inside) - 0.0006 * lw;
  let rimA = select(0.0, aastep(rim, fw), inX && openA > 0.03) * saturate(openA * 6.0);
  let inkC = mix(fp.ink.rgb, vec3f(0.42, 0.12, 0.1), 0.45);
  res = over(res, inkC, max(lineA, rimA * 0.9));
  // a small lower-lip shadow
  let lip = aastep(abs(q.y - (yBot - 0.0032 - 0.0005)) - 0.0005, fw) * smoothstep(0.7, 0.2, abs(t)) * 0.25;
  res = over(res, skin * 0.75, lip);
  return res;
}

fn drawFace(uvIn: vec2f, fwIn: f32, fp: FaceParams, skin: vec3f, mask: f32) -> FaceOut {
  var out: FaceOut;
  out.col = skin;
  out.cover = 0.0;
  out.unlit = 0.0;
  if (mask < 0.05) { return out; }
  let x = uvIn.x;
  let h = 1.0 - uvIn.y;             // glTF flips V
  let side = sign(x + 1e-6);         // +1 character's left
  let ax = abs(x);
  var acc = vec4f(0.0);
  var unlit = 0.0;
  // blush (under everything): soft pink plus hatch strokes
  let blush = fp.c.z;
  if (blush > 0.01) {
    let bq = vec2f(ax - 0.046, h - 0.088);
    let bd = length(bq / vec2f(0.018, 0.009));
    acc = over(acc, vec3f(0.95, 0.42, 0.42), smoothstep(1.0, 0.2, bd) * 0.45 * blush);
    let hatch = abs(fract((bq.x * 0.8 + bq.y) * 420.0) - 0.5);
    acc = over(acc, vec3f(0.85, 0.25, 0.3), aastep(hatch - 0.12, fwIn * 420.0) * step(bd, 0.75) * blush * 0.7);
  }
  // eyes
  let eyeC = vec2f(0.037, 0.121);
  let q = vec2f(ax - eyeC.x, h - eyeC.y);
  if (abs(q.x) < 0.034 && abs(q.y) < 0.03) {
    let open = select(fp.a.y, fp.a.x, side > 0.0);
    let e = drawEye(q, fwIn, open, side, fp, skin);
    unlit = max(unlit, e.a * 0.7);
    acc = over(acc, e.rgb, e.a);
  }
  // brows
  let bA = drawBrow(q, fwIn, fp, side);
  acc = over(acc, mix(fp.ink.rgb, skin * 0.4, 0.15), bA);
  // mouth
  let mq = vec2f(x, h - 0.047);
  if (abs(mq.x) < 0.03 && abs(mq.y) < 0.03) {
    let m = drawMouth(mq, fwIn, fp, skin);
    acc = over(acc, m.rgb, m.a);
  }
  // nose hint: a tiny shadow tick under the tip
  let nq = vec2f(x + 0.0015, h - 0.084);
  let nd = sdSegment(nq, vec2f(-0.002, 0.0), vec2f(0.003, 0.0012));
  acc = over(acc, skin * 0.62, aastep(nd.x - 0.0006, fwIn) * 0.6);
  // tear streaks down the cheeks
  let tears = fp.c.y;
  if (tears > 0.01) {
    let tx = ax - 0.046 - sin(h * 260.0) * 0.0007;
    let top = 0.104;
    let len = 0.055 * tears;
    let ty = top - h;
    let streak = aastep(abs(tx) - 0.0018 * (1.0 - saturate(ty / max(len, 1e-4)) * 0.5), fwIn) * step(0.0, ty) * step(ty, len);
    acc = over(acc, vec3f(0.62, 0.84, 1.0), streak * 0.75);
    acc = over(acc, vec3f(1.0), aastep(abs(tx + 0.0007) - 0.0005, fwIn) * step(0.0, ty) * step(ty, len * 0.8) * 0.9);
    // drop at the end
    let dd = length(vec2f(tx, ty - len) / vec2f(0.0028, 0.0034)) - 1.0;
    acc = over(acc, vec3f(0.65, 0.86, 1.0), aastep(dd * 0.003, fwIn) * 0.85);
    unlit = max(unlit, streak * 0.5);
  }
  out.col = mix(skin, acc.rgb, saturate(acc.a));
  out.cover = saturate(acc.a) * mask;
  out.unlit = unlit * mask;
  return out;
}
