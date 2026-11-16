import { CAR_HALF_EXTENTS, CAR_RIDE_HEIGHT } from './arena';
import { addV3, clamp, crossV3, dotV3, lenSqV3, lenV3, lerp, normV3, rotateVecByInvQuat, rotateVecByQuat, scaleV3, subV3, v3 } from './math3d';
import type { BallState, CarState } from './types';

/** Resolves a sphere against the actual oriented chassis with Rocket League-style dribbling, soft catches, and shot shaping. */
export function resolveBallContact(car: CarState, ball: BallState, maxBallSpeed: number): boolean {
  const localBall = rotateVecByInvQuat(subV3(ball.pos, car.pos), car.quat);
  const closest = v3(
    clamp(localBall.x, -CAR_HALF_EXTENTS.x, CAR_HALF_EXTENTS.x),
    clamp(localBall.y, -CAR_HALF_EXTENTS.y, CAR_HALF_EXTENTS.y),
    clamp(localBall.z, -CAR_HALF_EXTENTS.z, CAR_HALF_EXTENTS.z),
  );
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
    // Keep roof carries smoothly cradling the ball above the roof, while bumper strikes
    // use an elevated effective upper bumper so grounded forward hits drive ahead cleanly.
    const sittingOnRoof = localNormal.y > 0.72 && localBall.y > CAR_HALF_EXTENTS.y + ball.radius * 0.68;
    if (!sittingOnRoof && horizLen > 0.25 && localBall.y > CAR_HALF_EXTENTS.y) {
      const bumperEffectiveTop = Math.max(CAR_HALF_EXTENTS.y + 0.56, ball.radius - CAR_RIDE_HEIGHT - 0.08);
      const hitDiffY = Math.max(0, localBall.y - bumperEffectiveTop) * 0.65;
      localNormal = normV3(v3(difference.x, hitDiffY, difference.z));
    }

    // Rocket League directional hit shaping: blend steep corner edge normals slightly toward
    // the vector from slightly behind car center to ball center so angled shots aim reliably.
    if (car.onGround && Math.abs(localNormal.y) < 0.45 && Math.abs(localBall.x) > 0.15) {
      const centerAim = normV3(v3(localBall.x, localNormal.y, localBall.z + 0.4));
      localNormal = normV3(v3(
        lerp(localNormal.x, centerAim.x, 0.28),
        localNormal.y,
        lerp(localNormal.z, centerAim.z, 0.28),
      ));
    }
  }
  let normal = normV3(rotateVecByQuat(localNormal, car.quat));

  // Distinguish roof carry/dribble contacts from low bumper drives
  const roofContact = car.onGround && localNormal.y > 0.58 && localBall.y > CAR_HALF_EXTENTS.y;
  const roofFlickWindow = car.isFlipping && localBall.y > CAR_HALF_EXTENTS.y + 0.55 && ball.pos.y < car.pos.y + ball.radius + 2.2;

  // When pushing the ball during a dodge/flip, prevent steep vertical loft (passing over the car)
  // or downward slams into the turf, while allowing genuine roof flicks to scoop cleanly!
  const toBallHoriz = v3(ball.pos.x - car.pos.x, 0, ball.pos.z - car.pos.z);
  const toBallHorizLen = Math.hypot(toBallHoriz.x, toBallHoriz.z);
  const carHorizSpeed = Math.hypot(car.vel.x, car.vel.z);
  let flipPushDrive = false;
  let roofFlick = false;
  if (car.isFlipping && toBallHorizLen > 0.15 && carHorizSpeed > 3.5) {
    const pushDir = scaleV3(toBallHoriz, 1 / toBallHorizLen);
    const velHorizDir = scaleV3(v3(car.vel.x, 0, car.vel.z), 1 / carHorizSpeed);
    if (dotV3(pushDir, velHorizDir) > 0.15 && ball.pos.y < 4.8) {
      flipPushDrive = true;
      if (roofFlickWindow && ball.pos.y >= car.pos.y + 1.55) {
        roofFlick = true;
        const clampedY = clamp(normal.y, 0.28, 0.52);
        const horizScale = Math.sqrt(Math.max(0.01, 1 - clampedY * clampedY));
        normal = normV3(v3(pushDir.x * horizScale, clampedY, pushDir.z * horizScale));
      } else {
        const clampedY = clamp(normal.y, 0.06, 0.22);
        const horizScale = Math.sqrt(Math.max(0.01, 1 - clampedY * clampedY));
        normal = normV3(v3(pushDir.x * horizScale, clampedY, pushDir.z * horizScale));
      }
    }
  }

  const contactArm = rotateVecByQuat(closest, car.quat);
  ball.pos = addV3(ball.pos, scaleV3(normal, penetration + (flipPushDrive ? 0.12 : roofContact ? 0.0005 : 0.02)));
  // The chassis contact point (not the ball center) determines a rotating bumper's speed.
  let rotationalVelocity = crossV3(car.angVel, contactArm);
  rotationalVelocity = scaleV3(rotationalVelocity, Math.min(1, 8 / Math.max(lenV3(rotationalVelocity), 1e-6)));
  const carContactVelocity = addV3(car.vel, rotationalVelocity);
  const ballArm = scaleV3(normal, -ball.radius);
  const relativeVelocity = subV3(addV3(ball.vel, crossV3(ball.angVel, ballArm)), carContactVelocity);
  const closing = dotV3(relativeVelocity, normal);
  if (closing >= -1e-6) return false;

  // Rocket League one-way feel: ball hits barely slow down or deflect the car.
  const carInverseMass = 0.03;
  // Soft catch: gentle drops onto a grounded car roof absorb bounce so dribbling/carrying works cleanly.
  const restitution = roofContact
    ? lerp(0.04, 0.55, clamp((-closing - 2.0) / 5.0, 0, 1))
    : 0.55;
  const impulse = -(1 + restitution) * closing / (1 + carInverseMass);
  const normalImpulse = scaleV3(normal, impulse);
  ball.vel = addV3(ball.vel, normalImpulse);
  car.vel = subV3(car.vel, scaleV3(normalImpulse, carInverseMass));

  // Surface friction transfers spin & couples the ball during roof dribbling without fake kicks.
  const tangent = subV3(relativeVelocity, scaleV3(normal, closing));
  const tangentSpeed = lenV3(tangent);
  if (tangentSpeed > 1e-6) {
    const denom = roofContact ? 1.85 + carInverseMass : 3.5 + carInverseMass;
    const maxFriction = roofContact
      ? Math.max(impulse * 0.35, Math.min(tangentSpeed * 0.42, 1.8))
      : impulse * 0.22;
    const frictionImpulse = scaleV3(tangent, -Math.min(tangentSpeed / denom, maxFriction) / tangentSpeed);
    ball.vel = addV3(ball.vel, frictionImpulse);
    car.vel = subV3(car.vel, scaleV3(frictionImpulse, carInverseMass));
    const spinFactor = roofContact ? 0.95 : 2.5;
    ball.angVel = addV3(ball.angVel, scaleV3(crossV3(ballArm, frictionImpulse), spinFactor / (ball.radius ** 2)));
  }

  // On a flip push or roof flick, launch the ball cleanly ahead of the car.
  if (flipPushDrive) {
    const pushDir = scaleV3(toBallHoriz, 1 / toBallHorizLen);
    const carPushSpeed = dotV3(car.vel, pushDir);
    const ballPushSpeed = dotV3(ball.vel, pushDir);
    const targetBallPush = Math.min(maxBallSpeed * 0.98, Math.max(ballPushSpeed, carPushSpeed + (roofFlick ? 6.2 : 4.5)));
    if (targetBallPush > ballPushSpeed) {
      ball.vel = addV3(ball.vel, scaleV3(pushDir, targetBallPush - ballPushSpeed));
    }
    ball.vel.y = roofFlick ? clamp(ball.vel.y, 4.2, 10.5) : clamp(ball.vel.y, 0.4, 5.2);
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
