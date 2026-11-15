import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBallContact } from './ballContact';
import { createMatchState, MAX_BALL_SPEED } from './physics';
import { addV3, dotV3, lenV3, quatFromYaw, rotateVecByQuat, v3 } from './math3d';

function setup() {
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'Pilot', team: 'blue' }]);
  const car = state.cars[0];
  car.pos = v3(0, 5, 0);
  car.quat = quatFromYaw(0);
  car.vel = v3(0, 0, 10);
  car.angVel = v3();
  state.ball.pos = v3(0, 5, 3);
  state.ball.vel = v3();
  return { car, ball: state.ball };
}

test('centered hits follow bumper direction with no artificial lift and scale with closing speed', () => {
  let previous = 0;
  for (const speed of [3, 6, 12]) {
    const { car, ball } = setup();
    car.vel.z = speed;
    assert.ok(resolveBallContact(car, ball, MAX_BALL_SPEED));
    assert.equal(ball.vel.x, 0);
    assert.equal(ball.vel.y, 0);
    assert.ok(ball.vel.z > previous);
    assert.ok(Math.abs((ball.vel.z - car.vel.z) / speed - 0.55) < 1e-8);
    previous = ball.vel.z;
  }
});

test('left and right glancing hits mirror their angles and preserve tangential ball momentum', () => {
  const velocities = [];
  for (const side of [-1, 1]) {
    const { car, ball } = setup();
    ball.pos.x = side * 1.9;
    ball.vel.x = side * 2;
    assert.ok(resolveBallContact(car, ball, MAX_BALL_SPEED));
    assert.ok(ball.vel.x * side > 2);
    assert.ok(ball.vel.z > 0);
    velocities.push(ball.vel);
  }
  assert.ok(Math.abs(velocities[0].x + velocities[1].x) < 1e-8);
  assert.ok(Math.abs(velocities[0].z - velocities[1].z) < 1e-8);
});

test('impact direction rotates with the car at every heading, including reverse and vertical contacts', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const { car, ball } = setup();
    car.quat = quatFromYaw(yaw);
    car.vel = rotateVecByQuat(v3(0, 0, -10), car.quat);
    ball.pos = addV3(car.pos, rotateVecByQuat(v3(0, 0, -3), car.quat));
    assert.ok(resolveBallContact(car, ball, MAX_BALL_SPEED));
    assert.ok(dotV3(ball.vel, rotateVecByQuat(v3(0, 0, -1), car.quat)) > 10);
  }
  for (const side of [-1, 1]) {
    const { car, ball } = setup();
    car.vel = v3(0, side * 8, 0);
    ball.pos = addV3(car.pos, v3(0, side * 1.6, 0));
    assert.ok(resolveBallContact(car, ball, MAX_BALL_SPEED));
    assert.ok(ball.vel.y * side > 8);
    assert.equal(ball.vel.z, 0);
  }
});

test('separating contacts do not gain energy, while a rotating bumper can strike without translation', () => {
  const separating = setup();
  separating.ball.vel.z = 15;
  assert.equal(resolveBallContact(separating.car, separating.ball, MAX_BALL_SPEED), false);
  assert.deepEqual(separating.ball.vel, v3(0, 0, 15));
  const rotating = setup();
  rotating.car.vel = v3();
  rotating.car.angVel = v3(0, 4, 0);
  rotating.ball.pos.x = 0.8;
  // This point on the bumper rotates away from the ball: no invented flip multiplier.
  assert.equal(resolveBallContact(rotating.car, rotating.ball, MAX_BALL_SPEED), false);
  const striking = setup();
  striking.car.vel = v3();
  striking.car.angVel = v3(0, -4, 0);
  striking.ball.pos.x = 0.8;
  assert.ok(resolveBallContact(striking.car, striking.ball, MAX_BALL_SPEED));
  assert.ok(striking.ball.vel.z > 0);
});

test('surface friction transfers spin in mirrored directions and extreme hits keep the velocity direction when capped', () => {
  for (const side of [-1, 1]) {
    const { car, ball } = setup();
    car.vel.x = side * 8;
    assert.ok(resolveBallContact(car, ball, MAX_BALL_SPEED));
    assert.ok(ball.vel.x * side > 0);
    assert.ok(ball.angVel.y * side < 0);
  }
  const { car, ball } = setup();
  car.vel = v3(0, 0, 150);
  resolveBallContact(car, ball, MAX_BALL_SPEED);
  assert.ok(Math.abs(lenV3(ball.vel) - MAX_BALL_SPEED) < 1e-8);
  assert.equal(ball.vel.x, 0);
  assert.equal(ball.vel.y, 0);
});
