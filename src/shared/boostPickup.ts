import { CAR_HALF_EXTENTS } from './arena';
import { clamp, dotV3, lerpV3, normV3, rotateVecByQuat, subV3, v3 } from './math3d';
import type { BoostPadState, CarState, Vec3 } from './types';

export const boostPadRadius = (isBig: boolean) => isBig ? 2.4 : 1.6;

/** Swept car footprint against a pad cylinder: bumpers and wheels can collect at its edge. */
export function carTouchesBoostPad(car: CarState, pad: BoostPadState, previousPosition: Vec3 = car.pos): boolean {
  const reach = boostPadRadius(pad.isBig) + 2.3;
  if (pad.pos.x < Math.min(car.pos.x, previousPosition.x) - reach || pad.pos.x > Math.max(car.pos.x, previousPosition.x) + reach ||
      pad.pos.z < Math.min(car.pos.z, previousPosition.z) - reach || pad.pos.z > Math.max(car.pos.z, previousPosition.z) + reach ||
      Math.min(car.pos.y, previousPosition.y) > (pad.isBig ? 2.4 : 1.2) + 2.3) return false;
  const axes = [rotateVecByQuat(v3(1, 0, 0), car.quat), rotateVecByQuat(v3(0, 1, 0), car.quat), rotateVecByQuat(v3(0, 0, 1), car.quat)];
  const extents = [CAR_HALF_EXTENTS.x, CAR_HALF_EXTENTS.y, CAR_HALF_EXTENTS.z];
  const forward = normV3(v3(axes[2].x, 0, axes[2].z), v3(0, 0, 1));
  const side = v3(forward.z, 0, -forward.x);
  const width = axes.reduce((sum, axis, i) => sum + Math.abs(dotV3(axis, side)) * extents[i], 0);
  const length = axes.reduce((sum, axis, i) => sum + Math.abs(dotV3(axis, forward)) * extents[i], 0);
  const height = axes.reduce((sum, axis, i) => sum + Math.abs(axis.y) * extents[i], 0);
  const top = (pad.isBig ? 2.4 : 1.2) + height;
  let from = previousPosition;
  let to = car.pos;
  if (Math.min(from.y, to.y) > top || Math.max(from.y, to.y) < -height) return false;
  const dy = to.y - from.y;
  if (Math.abs(dy) > 1e-8) {
    const first = (-height - from.y) / dy;
    const last = (top - from.y) / dy;
    const low = Math.max(0, Math.min(first, last));
    const high = Math.min(1, Math.max(first, last));
    const original = from;
    from = lerpV3(original, to, low);
    to = lerpV3(original, to, high);
  }
  const a = subV3(from, pad.pos);
  const b = subV3(to, pad.pos);
  const x = dotV3(a, side), z = dotV3(a, forward);
  const dx = dotV3(subV3(b, a), side), dz = dotV3(subV3(b, a), forward);
  // Squared distance to a rectangle is a piecewise quadratic along the swept path.
  const cuts = [0, 1];
  for (const [start, delta, extent] of [[x, dx, width], [z, dz, length]]) {
    if (Math.abs(delta) < 1e-8) continue;
    for (const edge of [-extent, extent]) {
      const t = (edge - start) / delta;
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  const radiusSq = boostPadRadius(pad.isBig) ** 2;
  for (let i = 0; i < cuts.length - 1; i++) {
    const middle = (cuts[i] + cuts[i + 1]) / 2;
    const outsideX = Math.abs(x + dx * middle) > width;
    const outsideZ = Math.abs(z + dz * middle) > length;
    const ax = outsideX ? x - Math.sign(x + dx * middle) * width : 0;
    const az = outsideZ ? z - Math.sign(z + dz * middle) * length : 0;
    const bx = outsideX ? dx : 0, bz = outsideZ ? dz : 0;
    const t = clamp(-(ax * bx + az * bz) / (bx * bx + bz * bz || 1), cuts[i], cuts[i + 1]);
    if ((ax + bx * t) ** 2 + (az + bz * t) ** 2 <= radiusSq) return true;
  }
  return false;
}
