import { ARENA_HALF_Z, resolveArenaSphere } from './arena';
import {
  addV3, dotV3, lenV3, lerpV3, normV3, quatFromUnitVectors, quatIdentity,
  rotateVecByQuat, scaleV3, slerpQuat, subV3, v3,
} from './math3d';
import type { CarState, Vec3 } from './types';

const CAMERA_RADIUS = 0.45;

/** Sweep from the car toward the camera so neither walls nor goal posts hide the car. */
export function constrainCamera(pivot: Vec3, desired: Vec3): Vec3 {
  let start = { ...pivot };
  for (let i = 0; i < 4; i++) {
    const hit = resolveArenaSphere(start, CAMERA_RADIUS);
    if (!hit.hit) break;
    start = addV3(start, scaleV3(hit.normal, hit.penetration + 0.02));
  }
  // The main arena is convex. Safe endpoints guarantee a safe segment away from goal posts.
  if (Math.abs(start.z) < ARENA_HALF_Z - 2 && Math.abs(desired.z) < ARENA_HALF_Z - 2 &&
      !resolveArenaSphere(desired, CAMERA_RADIUS).hit) return desired;
  const distance = lenV3(subV3(desired, start));
  const steps = Math.max(1, Math.ceil(distance / 0.25));
  let previous = start;
  for (let step = 1; step <= steps; step++) {
    const candidate = lerpV3(start, desired, step / steps);
    if (resolveArenaSphere(candidate, CAMERA_RADIUS).hit) {
      let low = previous;
      let high = candidate;
      for (let i = 0; i < 8; i++) {
        const middle = lerpV3(low, high, 0.5);
        if (resolveArenaSphere(middle, CAMERA_RADIUS).hit) high = middle;
        else low = middle;
      }
      return low;
    }
    previous = candidate;
  }
  return desired;
}

export function smoothCameraUp(current: Vec3, target: Vec3, dt: number, grounded: boolean): Vec3 {
  const rotation = quatFromUnitVectors(current, target);
  const blended = slerpQuat(quatIdentity(), rotation, 1 - Math.exp(-(grounded ? 10 : 4) * dt));
  return normV3(rotateVecByQuat(current, blended));
}

export function buildFollowCamera(car: Pick<CarState, 'pos' | 'quat' | 'onGround' | 'groundNormal'>, ball: Vec3, ballCam: boolean) {
  const up = car.onGround ? normV3(car.groundNormal) : v3(0, 1, 0);
  const tangent = (direction: Vec3) => subV3(direction, scaleV3(up, dotV3(direction, up)));
  const heading = tangent(rotateVecByQuat(v3(0, 0, 1), car.quat));
  const fallback = Math.abs(up.z) < 0.9 ? tangent(v3(0, 0, 1)) : tangent(v3(1, 0, 0));
  const forward = normV3(heading, normV3(fallback));

  const toBall = subV3(ball, car.pos);
  const toBallHoriz = tangent(toBall);
  const horizDist = lenV3(toBallHoriz);

  // Rocket League Ball Cam stability: when the ball is directly overhead or being dribbled
  // on the roof (horizDist < ~7.5m), blend azimuth smoothly toward the car's driving heading
  // instead of snapping 180 degrees as the ball crosses the car's center.
  const t = Math.max(0, Math.min(1, (horizDist - 1.5) / 6.0));
  const ballHeadingWeight = t * t * (3 - 2 * t);
  const ballForwardDir = normV3(toBallHoriz, forward);
  const camForward = ballCam
    ? normV3(lerpV3(forward, ballForwardDir, ballHeadingWeight), forward)
    : forward;
  const backward = scaleV3(camForward, -1);

  const pivot = addV3(car.pos, scaleV3(up, 0.85));
  const position = constrainCamera(pivot, addV3(addV3(car.pos, scaleV3(backward, ballCam ? 10.6 : 10.8)), scaleV3(up, ballCam ? 3.85 : 3.6)));

  let lookAt: Vec3;
  if (ballCam) {
    const rawTarget = addV3(lerpV3(ball, car.pos, 0.34), scaleV3(up, 0.65));
    // Clamp overhead pitch so the horizon and pitch stay readable when dribbling under a high ball
    const delta = subV3(rawTarget, car.pos);
    const upOffset = dotV3(delta, up);
    const maxUpOffset = Math.max(4.5, horizDist * 0.72);
    const clampedTarget = upOffset > maxUpOffset
      ? subV3(rawTarget, scaleV3(up, upOffset - maxUpOffset))
      : rawTarget;
    const carCamLook = addV3(addV3(car.pos, scaleV3(forward, 9)), scaleV3(up, 1.4));
    lookAt = lerpV3(carCamLook, clampedTarget, 0.35 + 0.65 * ballHeadingWeight);
  } else {
    lookAt = addV3(addV3(car.pos, scaleV3(forward, 9)), scaleV3(up, 1.4));
  }

  return { position, lookAt, up, pivot };
}
