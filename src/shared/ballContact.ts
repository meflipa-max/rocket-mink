import { CAR_HALF_EXTENTS } from './arena';
import { addV3, clamp, crossV3, dotV3, lenSqV3, lenV3, normV3, rotateVecByInvQuat, rotateVecByQuat, scaleV3, subV3, v3 } from './math3d';
import type { BallState, CarState } from './types';

/** Resolves a sphere against the actual oriented chassis, including contact velocity and friction. */
export function resolveBallContact(car: CarState, ball: BallState, maxBallSpeed: number): boolean {
  const localBall = rotateVecByInvQuat(subV3(ball.pos, car.pos), car.quat);
  const closest = v3(clamp(localBall.x, -CAR_HALF_EXTENTS.x, CAR_HALF_EXTENTS.x), clamp(localBall.y, -CAR_HALF_EXTENTS.y, CAR_HALF_EXTENTS.y), clamp(localBall.z, -CAR_HALF_EXTENTS.z, CAR_HALF_EXTENTS.z));
  const difference = subV3(localBall, closest);
  const distanceSq = lenSqV3(difference);
  if (distanceSq >= ball.radius ** 2) return false;
  const distance = Math.sqrt(distanceSq);
  let normal = distance > 1e-6 ? scaleV3(difference, 1 / distance) : v3();
  let penetration = ball.radius - distance;
  if (distance <= 1e-6) {
    // An embedded center exits through the nearest face, never an arbitrary diagonal.
    const axes = ['x', 'y', 'z'] as const;
    const axis = axes.reduce((best, candidate) => CAR_HALF_EXTENTS[candidate] - Math.abs(localBall[candidate]) < CAR_HALF_EXTENTS[best] - Math.abs(localBall[best]) ? candidate : best, 'y');
    normal[axis] = Math.sign(localBall[axis]) || 1;
    closest[axis] = normal[axis] * CAR_HALF_EXTENTS[axis];
    penetration += CAR_HALF_EXTENTS[axis] - Math.abs(localBall[axis]);
  }
  normal = normV3(rotateVecByQuat(normal, car.quat));
  const contactArm = rotateVecByQuat(closest, car.quat);
  ball.pos = addV3(ball.pos, scaleV3(normal, penetration + 0.02));
  // The chassis contact point (not the ball center) determines a rotating bumper's speed.
  let rotationalVelocity = crossV3(car.angVel, contactArm);
  rotationalVelocity = scaleV3(rotationalVelocity, Math.min(1, 8 / Math.max(lenV3(rotationalVelocity), 1e-6)));
  const carContactVelocity = addV3(car.vel, rotationalVelocity);
  const ballArm = scaleV3(normal, -ball.radius);
  const relativeVelocity = subV3(addV3(ball.vel, crossV3(ball.angVel, ballArm)), carContactVelocity);
  const closing = dotV3(relativeVelocity, normal);
  if (closing >= -1e-6) return false;

  const carInverseMass = 0.12;
  const impulse = -(1 + 0.55) * closing / (1 + carInverseMass);
  const normalImpulse = scaleV3(normal, impulse);
  ball.vel = addV3(ball.vel, normalImpulse);
  car.vel = subV3(car.vel, scaleV3(normalImpulse, carInverseMass));

  // Bounded surface friction transfers sideways motion and spin without a fake forward/upward kick.
  const tangent = subV3(relativeVelocity, scaleV3(normal, closing));
  const tangentSpeed = lenV3(tangent);
  if (tangentSpeed > 1e-6) {
    const frictionImpulse = scaleV3(tangent, -Math.min(tangentSpeed / (3.5 + carInverseMass), impulse * 0.22) / tangentSpeed);
    ball.vel = addV3(ball.vel, frictionImpulse);
    car.vel = subV3(car.vel, scaleV3(frictionImpulse, carInverseMass));
    ball.angVel = addV3(ball.angVel, scaleV3(crossV3(ballArm, frictionImpulse), 2.5 / (ball.radius ** 2)));
  }
  const speed = lenV3(ball.vel);
  if (speed > maxBallSpeed) ball.vel = scaleV3(ball.vel, maxBallSpeed / speed);
  const spin = lenV3(ball.angVel);
  if (spin > 40) ball.angVel = scaleV3(ball.angVel, 40 / spin);
  return true;
}
