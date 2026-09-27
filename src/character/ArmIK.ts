/**
 * Arm parameterisation used by clips and procedural animation.
 *   raise: 0 = hanging down, 90 = horizontal, 180 = straight up (degrees)
 *   swing: azimuth of the raise plane. 0 = forward, 90 = out to the side, 180 = behind, <0 = across body.
 *   twist: roll about the arm's own axis; rotates the elbow-flexion direction. Mirrored per side so
 *          identical numbers read the same on either arm.
 * Interpolating in this space produces natural swinging arcs instead of Euler wobble.
 */
export function armQuat(side: 1 | -1, raiseDeg: number, swingDeg: number, twistDeg: number, out: Float32Array, o: number) {
  const r = (raiseDeg * Math.PI) / 180;
  const s = (swingDeg * Math.PI) / 180;
  const sr = Math.sin(r), cr = Math.cos(r);
  const dx = sr * Math.sin(s) * side;
  const dy = -cr;
  const dz = sr * Math.cos(s);
  // shortest arc from (0,-1,0) to d: axis = (-dz, 0, dx), w = 1 + cr
  let qx = -dz, qy = 0, qz = dx, qw = 1 + cr;
  let l = Math.hypot(qx, qy, qz, qw);
  if (l < 1e-6) {
    // straight up: rotate about X by -180 (via forward)
    qx = -1; qy = 0; qz = 0; qw = 0;
    l = 1;
  }
  qx /= l; qy /= l; qz /= l; qw /= l;
  // twist about d (parent frame): q = qt * qa
  const t = ((twistDeg * Math.PI) / 180) * (side === -1 ? 1 : -1) * 0.5;
  const st = Math.sin(t), ct = Math.cos(t);
  const tx = dx * st, ty = dy * st, tz = dz * st, tw = ct;
  out[o] = tw * qx + tx * qw + ty * qz - tz * qy;
  out[o + 1] = tw * qy + ty * qw + tz * qx - tx * qz;
  out[o + 2] = tw * qz + tz * qw + tx * qy - ty * qx;
  out[o + 3] = tw * qw - tx * qx - ty * qy - tz * qz;
}
