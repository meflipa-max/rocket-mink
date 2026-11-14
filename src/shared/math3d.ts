import type { Quat, Vec3 } from './types';

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function cloneV3(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function addV3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subV3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleV3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dotV3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossV3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lenSqV3(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function lenV3(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function normV3(a: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
  const l = lenV3(a);
  if (l < 1e-6) return { x: fallback.x, y: fallback.y, z: fallback.z };
  const inv = 1 / l;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

export function lerpV3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function normQuat(q: Quat): Quat {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (l < 1e-6) return { x: 0, y: 0, z: 0, w: 1 };
  const inv = 1 / l;
  return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
}

export function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  const n = normV3(axis);
  return normQuat({
    x: n.x * s,
    y: n.y * s,
    z: n.z * s,
    w: Math.cos(half),
  });
}

export function quatFromYaw(yawRad: number): Quat {
  return quatFromAxisAngle({ x: 0, y: 1, z: 0 }, yawRad);
}

export function rotateVecByQuat(v: Vec3, q: Quat): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

export function rotateVecByInvQuat(v: Vec3, q: Quat): Vec3 {
  return rotateVecByQuat(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
}

/**
 * Shortest-arc quaternion rotating unit vector `from` to unit vector `to`.
 */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const f = normV3(from);
  const t = normV3(to);
  const d = clamp(dotV3(f, t), -1, 1);
  if (d > 0.999999) return quatIdentity();
  if (d < -0.999999) {
    let ortho = crossV3({ x: 1, y: 0, z: 0 }, f);
    if (lenSqV3(ortho) < 1e-5) {
      ortho = crossV3({ x: 0, y: 0, z: 1 }, f);
    }
    return quatFromAxisAngle(normV3(ortho), Math.PI);
  }
  const c = crossV3(f, t);
  return normQuat({
    x: c.x,
    y: c.y,
    z: c.z,
    w: 1 + d,
  });
}

export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cosHalfTheta = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalfTheta < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosHalfTheta = -cosHalfTheta;
  }
  if (cosHalfTheta >= 0.9995) {
    return normQuat({
      x: lerp(a.x, bx, t),
      y: lerp(a.y, by, t),
      z: lerp(a.z, bz, t),
      w: lerp(a.w, bw, t),
    });
  }
  const halfTheta = Math.acos(clamp(cosHalfTheta, -1, 1));
  const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
  return normQuat({
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB,
  });
}
