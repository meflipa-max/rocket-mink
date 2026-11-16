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

test('grounded forward hit drives the ball ahead with low loft instead of popping over the car roof', () => {
  for (const carSpeed of [18, 28]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'Striker', team: 'blue' }]);
    const car = state.cars[0];
    car.pos = v3(0, 0.56, 0);
    car.quat = quatFromYaw(0);
    car.vel = v3(0, 0, carSpeed);
    state.ball.pos = v3(0, 1.65, 2.95);
    state.ball.vel = v3();
    assert.ok(resolveBallContact(car, state.ball, MAX_BALL_SPEED));
    assert.ok(state.ball.vel.z > 24, `Expected strong forward drive, got vel.z=${state.ball.vel.z}`);
    assert.ok(state.ball.vel.y < 4.5, `Expected low loft without overhead pop, got vel.y=${state.ball.vel.y}`);
    assert.ok(state.ball.vel.z > state.ball.vel.y * 4, 'Forward velocity must dominate vertical pop');
  }
});

test('forward flip push drives the ball cleanly ahead without popping over the car', () => {
  for (const ballY of [1.1, 2.0]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'FlipStriker', team: 'blue' }]);
    const car = state.cars[0];
    car.pos = v3(0, 0.85, 0);
    car.quat = quatFromYaw(0);
    car.vel = v3(0, 0.5, 29);
    car.onGround = false;
    car.isFlipping = true;
    state.ball.pos = v3(0, ballY, 2.85);
    state.ball.vel = v3(0, 0, 8);

    assert.ok(resolveBallContact(car, state.ball, MAX_BALL_SPEED));
    assert.ok(state.ball.pos.z > car.pos.z + 2.5, `Ball stayed too close: ball.z=${state.ball.pos.z}, car.z=${car.pos.z}`);
    assert.ok(state.ball.vel.z > car.vel.z + 3.5, `Ball must outpace flipping car: ball=${state.ball.vel.z}, car=${car.vel.z}`);
    assert.ok(state.ball.vel.y <= 5.21 && state.ball.vel.y >= 0.4, `Unexpected flip lift: vel.y=${state.ball.vel.y}`);
  }
});

test('soft roof catch cushions gentle drops and allows roof flick launch', () => {
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'Dribbler', team: 'blue' }]);
  const car = state.cars[0];
  car.pos = v3(0, 0.56, 0);
  car.quat = quatFromYaw(0);
  car.vel = v3(0, 0, 14);
  car.onGround = true;

  // Gentle drop onto the roof should be cushioned instead of bouncing high
  state.ball.pos = v3(0, 0.56 + 0.45 + state.ball.radius - 0.05, 0.1);
  state.ball.vel = v3(0, -2.5, 13.0);
  assert.ok(resolveBallContact(car, state.ball, MAX_BALL_SPEED));
  assert.ok(state.ball.vel.y < 0.6, `Expected soft roof catch, got vel.y=${state.ball.vel.y}`);

  // Forward flip while carrying on the roof produces a clean upward + forward flick
  car.onGround = false;
  car.isFlipping = true;
  car.pos = v3(0, 0.85, 0);
  car.vel = v3(0, 1.0, 18);
  state.ball.pos = v3(0, 0.85 + 0.45 + state.ball.radius - 0.1, 0.6);
  state.ball.vel = v3(0, 0.2, 17);
  assert.ok(resolveBallContact(car, state.ball, MAX_BALL_SPEED));
  assert.ok(state.ball.vel.z > car.vel.z + 4.0, `Flick must accelerate ahead of car: ball.z=${state.ball.vel.z}, car.z=${car.vel.z}`);
  assert.ok(state.ball.vel.y >= 4.0, `Roof flick must scoop upward: vel.y=${state.ball.vel.y}`);
});


