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
  let localNormal = distance > 1e-6 ? scaleV3(difference, 1 / distance) : v3();
  let penetration = ball.radius - distance;
  if (distance <= 1e-6) {
    // An embedded center exits through the nearest face, never an arbitrary diagonal.
    const axes = ['x', 'y', 'z'] as const;
    const axis = axes.reduce((best, candidate) => CAR_HALF_EXTENTS[candidate] - Math.abs(localBall[candidate]) < CAR_HALF_EXTENTS[best] - Math.abs(localBall[best]) ? candidate : best, 'y');
    localNormal[axis] = Math.sign(localBall[axis]) || 1;
    closest[axis] = localNormal[axis] * CAR_HALF_EXTENTS[axis];
    penetration += CAR_HALF_EXTENTS[axis] - Math.abs(localBall[axis]);
  } else {
    const horizLen = Math.hypot(difference.x, difference.z);
    // On ground, the ball center sits ~1.09m above the car center (0.56m vs 1.65m).
    // Adjusting the effective upper bumper reference prevents forward strikes from popping
    // the ball steeply over the car's roof while keeping aerial/roof contacts natural.
    if (horizLen > 0.25 && localBall.y > CAR_HALF_EXTENTS.y) {
      const bumperEffectiveTop = CAR_HALF_EXTENTS.y + 0.56;
      const hitDiffY = Math.max(0, localBall.y - bumperEffectiveTop) * 0.65;
      localNormal = normV3(v3(difference.x, hitDiffY, difference.z));
    }
  }
  let normal = normV3(rotateVecByQuat(localNormal, car.quat));

  // When pushing the ball during a dodge/flip, prevent steep vertical loft (passing over the car)
  // or downward slams into the turf (bouncing behind/over while the car flies over the ball).
  const toBallHoriz = v3(ball.pos.x - car.pos.x, 0, ball.pos.z - car.pos.z);
  const toBallHorizLen = Math.hypot(toBallHoriz.x, toBallHoriz.z);
  const carHorizSpeed = Math.hypot(car.vel.x, car.vel.z);
  let flipPushDrive = false;
  if (car.isFlipping && toBallHorizLen > 0.15 && carHorizSpeed > 3.5) {
    const pushDir = scaleV3(toBallHoriz, 1 / toBallHorizLen);
    const velHorizDir = scaleV3(v3(car.vel.x, 0, car.vel.z), 1 / carHorizSpeed);
    if (dotV3(pushDir, velHorizDir) > 0.15 && ball.pos.y < 4.5) {
      flipPushDrive = true;
      const clampedY = clamp(normal.y, 0.06, 0.22);
      const horizScale = Math.sqrt(Math.max(0.01, 1 - clampedY * clampedY));
      normal = normV3(v3(pushDir.x * horizScale, clampedY, pushDir.z * horizScale));
    }
  }

  const contactArm = rotateVecByQuat(closest, car.quat);
  ball.pos = addV3(ball.pos, scaleV3(normal, penetration + (flipPushDrive ? 0.12 : 0.02)));
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

  // On a flip push, keep the ball cleanly ahead of the car rather than overtaking it in mid-flip.
  if (flipPushDrive) {
    const pushDir = scaleV3(toBallHoriz, 1 / toBallHorizLen);
    const carPushSpeed = dotV3(car.vel, pushDir);
    const ballPushSpeed = dotV3(ball.vel, pushDir);
    const targetBallPush = Math.min(maxBallSpeed * 0.98, Math.max(ballPushSpeed, carPushSpeed + 4.5));
    if (targetBallPush > ballPushSpeed) {
      ball.vel = addV3(ball.vel, scaleV3(pushDir, targetBallPush - ballPushSpeed));
    }
    ball.vel.y = clamp(ball.vel.y, 0.4, 5.2);
  }

  const speed = lenV3(ball.vel);
  if (speed > maxBallSpeed) ball.vel = scaleV3(ball.vel, maxBallSpeed / speed);

  if (flipPushDrive) {
    const pushDir = scaleV3(toBallHoriz, 1 / toBallHorizLen);
    const finalBallPush = dotV3(ball.vel, pushDir);
    const carPushSpeed = dotV3(car.vel, pushDir);
    if (carPushSpeed > finalBallPush - 3.8) {
      const trim = carPushSpeed - Math.max(0, finalBallPush - 3.8);
      car.vel = subV3(car.vel, scaleV3(pushDir, trim));
    }
  }

  const spin = lenV3(ball.angVel);
  if (spin > 40) ball.angVel = scaleV3(ball.angVel, 40 / spin);
  return true;
}
