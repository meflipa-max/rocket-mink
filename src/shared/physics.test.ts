import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_HALF_Z,
  ARENA_HALF_X,
  ARENA_HEIGHT,
  CEILING_RAMP_RADIUS,
  BALL_RADIUS,
  CAR_RIDE_HEIGHT,
  checkGoalScored,
  createBoostPads,
  resolveArenaSphere,
} from './arena';
import {
  MAX_BALL_SPEED,
  MAX_CAR_SPEED,
  MAX_BOOST_SPEED,
  NEUTRAL_INPUT,
  SUPERSONIC_THRESHOLD,
  createMatchState,
  resetKickoff,
  skipGoalReplay,
  stepSimulation,
  predictScoringTeam,
} from './physics';
import type { PlayerInput } from './types';
import { dotV3, quatFromYaw, rotateVecByQuat, v3 } from './math3d';
import { GOAL_REPLAY_DURATION, GOAL_CELEBRATION_DURATION } from './replay';

test('ball top speed stays below turbo speed and strong impacts stay capped', () => {
  assert.ok(MAX_BALL_SPEED < MAX_BOOST_SPEED);
  const state = createMatchState('freeplay', 'dfh_night', []);
  state.ball.pos = v3(0, 5, 0);
  state.ball.vel = v3(0, 0, 150);
  stepSimulation(state, {}, 1 / 60);
  assert.ok(Math.hypot(state.ball.vel.x, state.ball.vel.y, state.ball.vel.z) <= MAX_BALL_SPEED + 1e-8);
});

test('boost carries a car from the pitch up the wall and onto the flat ceiling', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'CeilingDriver', team: 'blue' }]);
    const car = state.cars[0];
    car.pos = v3(35, CAR_RIDE_HEIGHT, 0);
    car.quat = quatFromYaw(Math.PI / 2);
    car.boost = 100;
    let reachedCeiling = false;
    for (let i = 0; i < 5 / dt; i++) {
      stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: 1, boost: true } }, dt);
      if (car.onGround && car.groundNormal.y < -0.95 && car.pos.x < ARENA_HALF_X - CEILING_RAMP_RADIUS - 2) {
        reachedCeiling = true;
        assert.ok(car.pos.y > ARENA_HEIGHT - 1);
        const jump = stepSimulation(state, { p1: { ...NEUTRAL_INPUT, jump: true } }, dt);
        assert.ok(jump.some((event) => event.type === 'jump'));
        assert.equal(car.onGround, false, 'Jump must detach from the ceiling');
        break;
      }
    }
    assert.ok(reachedCeiling, `Ceiling not reached at ${1 / dt}Hz: ${JSON.stringify({ pos: car.pos, normal: car.groundNormal, grounded: car.onGround })}`);
  }
});

test('shot prediction follows fast ground bounces, slow rollers and aerial trajectories while rejecting misses', () => {
  const state = createMatchState('freeplay', 'dfh_night', []);
  for (const speed of [8, 20, 42]) {
    state.ball.pos = v3(0, BALL_RADIUS, ARENA_HALF_Z - (speed === 8 ? 12 : 25));
    state.ball.vel = v3(0, 0, speed);
    assert.equal(predictScoringTeam(state.ball), 'blue', `Rolling shot at ${speed}m/s`);
  }
  state.ball.pos = v3(0, 12, ARENA_HALF_Z - 18);
  state.ball.vel = v3(0, -7, 20);
  assert.equal(predictScoringTeam(state.ball), 'blue');
  state.ball.pos = v3(24, BALL_RADIUS, ARENA_HALF_Z - 15);
  state.ball.vel = v3(0, 0, 25);
  assert.equal(predictScoringTeam(state.ball), null);
  state.ball.pos = v3(0, 18, ARENA_HALF_Z - 6);
  state.ball.vel = v3(0, 0, 30);
  assert.equal(predictScoringTeam(state.ball), null, 'Shot over the crossbar is not on target');
});

test('lateral saves count for both teams even when the ball keeps travelling toward the goal line', () => {
  for (const team of ['blue', 'orange'] as const) {
    for (const x of [0, 24]) {
      const direction = team === 'blue' ? -1 : 1;
      const state = createMatchState('1v1', 'dfh_night', [{ id: 'keeper', name: 'Keeper', team }]);
      state.phase = 'active';
      const car = state.cars[0];
      car.pos = v3(x - 3, CAR_RIDE_HEIGHT, direction * 60);
      car.quat = quatFromYaw(Math.PI / 2);
      car.vel = v3(25, 0, 0);
      state.ball.pos = v3(x, BALL_RADIUS, direction * 60);
      state.ball.vel = v3(0, 0, direction * 30);
      const events = stepSimulation(state, {}, 1 / 60);
      assert.ok(events.some((event) => event.type === 'ball_hit'));
      assert.equal(Math.sign(state.ball.vel.z), direction);
      assert.equal(events.some((event) => event.type === 'save'), x === 0, 'Wide balls are not saves');
      assert.equal(car.saves, x === 0 ? 1 : 0);
    }
  }
});

test('shots are awarded at the initial touch for fast midfield drives and slow finishes before any goal', () => {
  for (const speed of [10, 31]) {
    const state = createMatchState('1v1', 'dfh_night', [{ id: 'striker', name: 'Striker', team: 'blue' }]);
    state.phase = 'active';
    const car = state.cars[0];
    car.pos = v3(0, CAR_RIDE_HEIGHT, speed === 10 ? 72 : 30);
    car.quat = quatFromYaw(0);
    car.vel = v3(0, 0, speed);
    state.ball.pos = v3(0, BALL_RADIUS, car.pos.z + 3.2);
    const events = stepSimulation(state, {}, 1 / 60);
    assert.ok(events.some((event) => event.type === 'shot'), `Missing shot at ${speed}m/s`);
    assert.equal(car.shots, 1);
    assert.equal(events.some((event) => event.type === 'goal'), false);
    assert.equal(state.scoreBlue, 0);
  }
});

test('arena has 34 boost pads (6 big, 28 small) and resolves floor & curved ramp', () => {
  const pads = createBoostPads();
  assert.equal(pads.length, 34);
  assert.equal(pads.filter((p) => p.isBig).length, 6);
  assert.equal(pads.filter((p) => !p.isBig).length, 28);

  const floorHit = resolveArenaSphere({ x: 0, y: 0.2, z: 0 }, CAR_RIDE_HEIGHT);
  assert.equal(floorHit.hit, true);
  assert.ok(floorHit.normal.y > 0.99);

  // Inside goal mouth should remain open past ARENA_HALF_Z
  const inGoal = resolveArenaSphere({ x: 0, y: 2.0, z: ARENA_HALF_Z + 2.0 }, BALL_RADIUS);
  assert.equal(inGoal.hit, false);
  assert.equal(checkGoalScored({ x: 0, y: 2.0, z: ARENA_HALF_Z + 2.0 }, BALL_RADIUS), 'blue');
});

test('car accelerates, consumes boost, and reaches supersonic speed', () => {
  const state = createMatchState('1v1', 'dfh_night', [
    { id: 'p1', name: 'BlueOne', team: 'blue' },
    { id: 'p2', name: 'OrangeOne', team: 'orange' },
  ]);
  state.phase = 'active';
  state.cars[0].boost = 100;

  const boostDrive: PlayerInput = { ...NEUTRAL_INPUT, throttle: 1, boost: true };
  for (let i = 0; i < 120; i++) {
    stepSimulation(state, { p1: boostDrive, p2: NEUTRAL_INPUT }, 1 / 60);
  }

  const speed = Math.hypot(state.cars[0].vel.x, state.cars[0].vel.z);
  assert.ok(MAX_CAR_SPEED < 25, 'Normal car speed should stay controlled');
  assert.ok(speed > SUPERSONIC_THRESHOLD, `Expected supersonic speed > ${SUPERSONIC_THRESHOLD}, got ${speed}`);
  assert.equal(state.cars[0].supersonic, true);
  assert.ok(state.cars[0].boost < 100, 'Boost should be consumed');
});

test('car jump and directional air flip grant upward and forward impulse', () => {
  const state = createMatchState('freeplay', 'dfh_night', [
    { id: 'p1', name: 'Solo', team: 'blue' },
  ]);
  state.cars[0].pos = { x: 0, y: CAR_RIDE_HEIGHT, z: -20 };
  state.cars[0].quat = { x: 0, y: 0, z: 0, w: 1 };

  // First jump
  stepSimulation(state, { p1: { ...NEUTRAL_INPUT, jump: true } }, 1 / 60);
  assert.equal(state.cars[0].onGround, false);
  assert.ok(state.cars[0].vel.y > 8, 'First jump should give upward velocity');

  // Release jump for 4 frames
  for (let i = 0; i < 4; i++) {
    stepSimulation(state, { p1: NEUTRAL_INPUT }, 1 / 60);
  }

  // Forward flip
  const evs = stepSimulation(
    state,
    { p1: { ...NEUTRAL_INPUT, throttle: 1, jump: true } },
    1 / 60,
  );
  assert.equal(state.cars[0].isFlipping, true);
  assert.ok(state.cars[0].vel.z > 12, 'Forward flip should surge velocity along +Z');
  assert.ok(evs.some((e) => e.type === 'flip'));
});

test('car-ball collision pushes ball into goal and increments team score', () => {
  const state = createMatchState('1v1', 'dfh_night', [
    { id: 'p1', name: 'Striker', team: 'blue' },
    { id: 'p2', name: 'Keeper', team: 'orange' },
  ]);
  state.phase = 'active';
  // Place striker right behind ball near Orange goal
  state.cars[0].pos = { x: 0, y: CAR_RIDE_HEIGHT, z: ARENA_HALF_Z - 7 };
  state.cars[0].quat = { x: 0, y: 0, z: 0, w: 1 };
  state.cars[0].vel = { x: 0, y: 0, z: 32 };
  state.cars[1].pos = { x: 30, y: CAR_RIDE_HEIGHT, z: -30 };

  state.ball.pos = { x: 0, y: BALL_RADIUS, z: ARENA_HALF_Z - 3.5 };
  state.ball.vel = { x: 0, y: 0, z: 0 };

  let goalDetected = false;
  for (let i = 0; i < 60; i++) {
    const evs = stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: 1 }, p2: NEUTRAL_INPUT }, 1 / 60);
    if (evs.some((e) => e.type === 'goal' && e.team === 'blue')) {
      goalDetected = true;
      break;
    }
  }

  assert.equal(goalDetected, true);
  assert.equal(state.scoreBlue, 1);
  assert.equal(state.phase, 'goal_scored');
  assert.equal(state.cars[0].goals, 1);
});

test('tied score at 0:00 triggers overtime and golden goal ends the match', () => {
  const state = createMatchState('1v1', 'dfh_night', [
    { id: 'p1', name: 'Blue', team: 'blue' },
    { id: 'p2', name: 'Orange', team: 'orange' },
  ]);
  state.phase = 'active';
  state.clockSeconds = 0.01;
  state.ball.pos = { x: 0, y: BALL_RADIUS, z: 0 };
  state.ball.vel = { x: 0, y: 0, z: 0 };

  const evs = stepSimulation(state, {}, 1 / 60);
  assert.equal(state.isOvertime, true);
  assert.ok(evs.some((e) => e.type === 'overtime'));

  // Score golden goal for Orange
  state.phase = 'active';
  state.ball.pos = { x: 0, y: 2, z: -(ARENA_HALF_Z + BALL_RADIUS) };
  stepSimulation(state, {}, 1 / 60);
  assert.equal(state.scoreOrange, 1);
  assert.equal(state.phase, 'goal_scored');

  // Advance past celebration timer -> enters instant goal_replay
  for (let i = 0; i < Math.ceil((GOAL_CELEBRATION_DURATION + 0.1) * 60); i++) {
    stepSimulation(state, {}, 1 / 60);
  }
  assert.equal(state.phase, 'goal_replay');

  // Advance past goal replay -> golden goal ends match
  for (let i = 0; i < Math.ceil((GOAL_REPLAY_DURATION + 0.1) * 60); i++) {
    stepSimulation(state, {}, 1 / 60);
  }
  assert.equal(state.phase, 'ended');
  assert.equal(state.winner, 'orange');

  // Skipping replay resets straight to kickoff in regular time
  state.isOvertime = false;
  state.phase = 'goal_replay';
  skipGoalReplay(state);
  assert.equal(state.phase, 'countdown');
});

test('driving straight stays grounded across floor and smoothly climbs curved wall ramp', () => {
  const state = createMatchState('freeplay', 'dfh_night', [
    { id: 'p1', name: 'WallDriver', team: 'blue' },
  ]);
  // Aim straight toward right side wall (+X)
  state.cars[0].pos = { x: 40, y: CAR_RIDE_HEIGHT, z: 0 };
  state.cars[0].quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

  for (let i = 0; i < 150; i++) {
    stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: 1 } }, 1 / 60);
    assert.equal(state.cars[0].onGround, true, `Car should stay grounded on frame ${i}`);
  }
  assert.ok(state.cars[0].pos.y > 4, 'Car should climb up the wall smoothly');
  assert.ok(state.cars[0].groundNormal.x < -0.5, 'Car groundNormal should point inward from +X wall');
});

test('sideways and diagonal flips impart lateral/diagonal impulse and rotate on proper axis', () => {
  const state = createMatchState('freeplay', 'dfh_night', [
    { id: 'p1', name: 'Flipper', team: 'blue' },
  ]);
  state.cars[0].pos = { x: 0, y: CAR_RIDE_HEIGHT, z: 0 };
  state.cars[0].quat = { x: 0, y: 0, z: 0, w: 1 };

  // Jump 1
  stepSimulation(state, { p1: { ...NEUTRAL_INPUT, jump: true } }, 1 / 60);
  for (let i = 0; i < 4; i++) stepSimulation(state, { p1: NEUTRAL_INPUT }, 1 / 60);

  // Diagonal front-left flip (W + A + Space)
  const evs = stepSimulation(
    state,
    { p1: { ...NEUTRAL_INPUT, throttle: 1, steer: 1, jump: true } },
    1 / 60,
  );
  assert.equal(state.cars[0].isFlipping, true);
  assert.ok(evs.some((e) => e.type === 'flip'));
  assert.ok(state.cars[0].vel.z > 8, 'Diagonal flip surges forward (+Z)');
  assert.ok(state.cars[0].vel.x > 8, 'Diagonal flip surges left (+X)');
  assert.ok(Math.abs(state.cars[0].flipAxis.x) > 0.5 && Math.abs(state.cars[0].flipAxis.z) > 0.5);

  // Pure sideways flip right via roll/steer (D + Space x2)
  const sideState = createMatchState('freeplay', 'dfh_night', [
    { id: 'p1', name: 'SideFlipper', team: 'blue' },
  ]);
  sideState.cars[0].pos = { x: 0, y: CAR_RIDE_HEIGHT, z: 0 };
  sideState.cars[0].quat = { x: 0, y: 0, z: 0, w: 1 };
  stepSimulation(sideState, { p1: { ...NEUTRAL_INPUT, jump: true } }, 1 / 60);
  for (let i = 0; i < 4; i++) stepSimulation(sideState, { p1: NEUTRAL_INPUT }, 1 / 60);

  const sideEvs = stepSimulation(
    sideState,
    { p1: { ...NEUTRAL_INPUT, steer: -1, jump: true } },
    1 / 60,
  );
  assert.equal(sideState.cars[0].isFlipping, true);
  assert.ok(sideEvs.some((e) => e.type === 'flip'));
  assert.ok(sideState.cars[0].vel.x < -10, 'Right flip surges right (-X)');
  assert.ok(Math.abs(sideState.cars[0].vel.z) < 1, 'Pure sideways flip has minimal Z surge');
  assert.ok(Math.abs(sideState.cars[0].flipAxis.z) > 0.95, 'Sideways flip rolls around Z axis');
});

test('ball speed stays controlled after high-speed hit and RL jump/air-roll work faithfully', () => {
  const state = createMatchState('freeplay', 'dfh_night', [
    { id: 'p1', name: 'Striker', team: 'blue' },
  ]);
  state.cars[0].pos = { x: 0, y: CAR_RIDE_HEIGHT, z: -4 };
  state.cars[0].quat = { x: 0, y: 0, z: 0, w: 1 };
  state.cars[0].vel = { x: 0, y: 0, z: 31 };
  state.ball.pos = { x: 0, y: BALL_RADIUS, z: 0 };
  state.ball.vel = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < 15; i++) {
    stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: 1, boost: true } }, 1 / 60);
  }
  const ballSpeed = Math.hypot(state.ball.vel.x, state.ball.vel.y, state.ball.vel.z);
  assert.ok(ballSpeed <= MAX_BALL_SPEED + 0.01, `Ball speed ${ballSpeed} exceeded MAX_BALL_SPEED`);
  assert.ok(ballSpeed < 43, `Ball should stay readable, got ${ballSpeed}`);

  // Variable jump height: holding jump yields higher peak than single-frame tap
  const tapState = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Tap', team: 'blue' }]);
  const holdState = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Hold', team: 'blue' }]);
  stepSimulation(tapState, { p1: { ...NEUTRAL_INPUT, jump: true } }, 1 / 60);
  stepSimulation(holdState, { p1: { ...NEUTRAL_INPUT, jump: true } }, 1 / 60);
  for (let i = 0; i < 14; i++) {
    stepSimulation(tapState, { p1: NEUTRAL_INPUT }, 1 / 60);
    stepSimulation(holdState, { p1: { ...NEUTRAL_INPUT, jump: true } }, 1 / 60);
  }
  assert.ok(
    holdState.cars[0].pos.y > tapState.cars[0].pos.y + 0.15,
    'Holding jump should gain noticeably higher elevation than a quick tap',
  );

  // Free Air Roll: holding handbrake + yaw in midair barrel-rolls around Z axis
  const rollState = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Roller', team: 'blue' }]);
  rollState.cars[0].onGround = false;
  rollState.cars[0].pos = { x: 0, y: 8, z: 0 };
  rollState.cars[0].quat = { x: 0, y: 0, z: 0, w: 1 };
  for (let i = 0; i < 12; i++) {
    stepSimulation(
      rollState,
      { p1: { ...NEUTRAL_INPUT, handbrake: true, yaw: 1 } },
      1 / 60,
    );
  }
  assert.ok(Math.abs(rollState.cars[0].quat.z) > 0.3, 'Handbrake + steer in air should barrel-roll');
});

test('non-authoritative client prediction does not drift match clock or trigger local overtime', () => {
  const state = createMatchState('1v1', 'dfh_night', [
    { id: 'p1', name: 'Host', team: 'blue' },
    { id: 'p2', name: 'Guest', team: 'orange' },
  ]);
  state.phase = 'active';
  state.clockSeconds = 120.5;

  for (let i = 0; i < 60; i++) {
    stepSimulation(state, { p2: { ...NEUTRAL_INPUT, throttle: 1 } }, 1 / 60, false);
  }
  assert.equal(state.clockSeconds, 120.5);
  assert.equal(state.isOvertime, false);
  assert.equal(state.phase, 'active');
});

test('ball coasts progressively with the same resistance at 30, 60, 120 and 240 Hz', () => {
  const distances: number[] = [];
  const speeds: number[] = [];
  for (const hz of [30, 60, 120, 240]) {
    const state = createMatchState('freeplay', 'dfh_night', []);
    state.ball.pos = v3(-15, BALL_RADIUS, 0);
    state.ball.vel = v3(3, 0, 0);
    let previous = 3;
    for (let i = 0; i < hz * 8; i++) {
      stepSimulation(state, {}, 1 / hz);
      assert.ok(state.ball.vel.x > 0 && state.ball.vel.x <= previous, 'No stop threshold or speed jumps');
      assert.ok(previous - state.ball.vel.x < 0.03, 'No per-contact sand friction');
      assert.ok(Math.abs(state.ball.pos.y - BALL_RADIUS) < 0.001, 'Resting ball must not micro-bounce');
      previous = state.ball.vel.x;
    }
    assert.ok(state.ball.angVel.z < 0, 'Rotation follows rolling direction');
    distances.push(state.ball.pos.x);
    speeds.push(state.ball.vel.x);
  }
  assert.ok(Math.max(...speeds) - Math.min(...speeds) < 0.001);
  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.08);
  assert.ok(speeds[0] > 0.35 && speeds[0] < 0.4, 'Ball should still be gently rolling after eight seconds');
});

test('backflip direction, nose rotation and additive impulse follow every car heading', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const initialSpeed of [-5, 0, 10]) {
      const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Backflip', team: 'blue' }]);
      const car = state.cars[0];
      car.pos = v3(0, 8, 0);
      car.onGround = false;
      car.airTimeSinceJump = 0.15;
      car.quat = quatFromYaw(yaw);
      const forward = rotateVecByQuat(v3(0, 0, 1), car.quat);
      car.vel = v3(forward.x * initialSpeed, 0, forward.z * initialSpeed);
      state.ball.pos = v3(30, BALL_RADIUS, 30);
      const events = stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: -1, pitch: 1, jump: true } }, 1 / 60);
      assert.ok(events.some((e) => e.type === 'flip'));
      assert.ok(car.flipAxis.x < -0.99, 'Backflip rotates around negative local X');
      assert.ok(rotateVecByQuat(v3(0, 0, 1), car.quat).y > 0.1, 'Nose must rise during backflip');
      assert.ok(Math.abs(dotV3(car.vel, forward) - (initialSpeed - 12.2)) < 0.01, 'Impulse must preserve pre-existing momentum');
      assert.equal(car.hasDoubleJump, false);
      const velocity = { ...car.vel };
      stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: -1, pitch: 1, jump: true } }, 1 / 60);
      assert.ok(Math.abs(car.vel.x - velocity.x) < 0.01 && Math.abs(car.vel.z - velocity.z) < 0.01, 'Holding jump cannot repeat the dodge');
    }
  }
});

test('backflip rear bumper strikes the ball backwards and credits the player', () => {
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Backflip', team: 'blue' }]);
  const car = state.cars[0];
  car.pos = v3(0, 3, 0);
  car.onGround = false;
  car.airTimeSinceJump = 0.15;
  car.quat = quatFromYaw(0);
  state.ball.pos = v3(0, 3, -3);
  const events = stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: -1, pitch: 1, jump: true } }, 1 / 60);
  assert.ok(events.some((e) => e.type === 'ball_hit'));
  assert.ok(state.ball.vel.z < -10, 'Rear strike must send the ball behind the car');
  assert.equal(state.ball.lastTouchPlayerId, 'p1');
  assert.ok(Math.hypot(state.ball.vel.x, state.ball.vel.y, state.ball.vel.z) <= MAX_BALL_SPEED);
});

test('backflip completes exactly one turn at different frame rates and can be cancelled', () => {
  for (const hz of [30, 60, 120]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Flip', team: 'blue' }]);
    const car = state.cars[0];
    car.pos = v3(0, 10, -30);
    car.onGround = false;
    car.airTimeSinceJump = 0.15;
    car.quat = quatFromYaw(0);
    state.ball.pos = v3(30, BALL_RADIUS, 30);
    stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: -1, jump: true } }, 1 / hz);
    for (let i = 0; i < Math.ceil(0.4 * hz); i++) stepSimulation(state, {}, 1 / hz);
    assert.equal(car.isFlipping, false);
    assert.ok(Math.abs(car.quat.w) > 0.9999, `Flip should finish upright at ${hz} Hz`);
    assert.ok(car.vel.z < -12, 'Rotation completion must preserve backwards momentum');
  }
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Cancel', team: 'blue' }]);
  const car = state.cars[0];
  car.pos = v3(0, 10, -30);
  car.onGround = false;
  car.airTimeSinceJump = 0.15;
  car.quat = quatFromYaw(0);
  state.ball.pos = v3(30, BALL_RADIUS, 30);
  stepSimulation(state, { p1: { ...NEUTRAL_INPUT, throttle: -1, jump: true } }, 1 / 60);
  for (let i = 0; i < 24; i++) stepSimulation(state, { p1: { ...NEUTRAL_INPUT, pitch: -1 } }, 1 / 60);
  assert.equal(car.isFlipping, false);
  assert.ok(Math.abs(car.quat.x) > 0.4, 'Opposite pitch input cancels the backflip rotation');
  assert.ok(car.vel.z < -12, 'Flip cancel must keep the dodge impulse');
});

test('boost has a stronger high-speed surge and supersonic only applies to forward travel', () => {
  const acceleration: number[] = [];
  for (const speed of [10, 24]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Boost', team: 'blue' }]);
    const car = state.cars[0];
    car.pos = v3(0, 8, -30);
    car.onGround = false;
    car.quat = quatFromYaw(0);
    car.vel = v3(0, 0, speed);
    stepSimulation(state, { p1: { ...NEUTRAL_INPUT, boost: true } }, 1 / 60);
    acceleration.push((car.vel.z - speed) * 60);
  }
  assert.ok(acceleration[1] > acceleration[0] + 8);
  for (const velocity of [v3(0, -30, 0), v3(30, 0, 0), v3(0, 0, -30)]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'No demo', team: 'blue' }]);
    state.cars[0].pos = v3(0, 12, -30);
    state.cars[0].onGround = false;
    state.cars[0].quat = quatFromYaw(0);
    state.cars[0].vel = velocity;
    stepSimulation(state, {}, 1 / 60);
    assert.equal(state.cars[0].supersonic, false);
  }
});

test('demolition requires a fast frontal closing impact, with no side-swipe or teammate demos', () => {
  const cases = [
    { speed: 30, side: 0, victimSpeed: 0, team: 'orange' as const, demo: true },
    { speed: 24, side: 0, victimSpeed: 0, team: 'orange' as const, demo: false },
    { speed: 30, side: 1.9, victimSpeed: 0, team: 'orange' as const, demo: false },
    { speed: 30, side: 0, victimSpeed: 28, team: 'orange' as const, demo: false },
    { speed: 30, side: 0, victimSpeed: 0, team: 'blue' as const, demo: false },
  ];
  for (const scenario of cases) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'a', name: 'Attacker', team: 'blue' }, { id: 'b', name: 'Victim', team: scenario.team }]);
    const [a, b] = state.cars;
    a.pos = v3(0, CAR_RIDE_HEIGHT, -30);
    b.pos = v3(scenario.side, CAR_RIDE_HEIGHT, -27.5);
    a.quat = b.quat = quatFromYaw(0);
    a.vel = v3(0, 0, scenario.speed);
    b.vel = v3(0, 0, scenario.victimSpeed);
    const events = stepSimulation(state, {}, 1 / 60);
    assert.equal(events.some((e) => e.type === 'demo'), scenario.demo, JSON.stringify(scenario));
    assert.equal(b.demolishedTimer > 0, scenario.demo);
  }
});

test('turbo activation is not supersonic and crossing the speed threshold emits no action notification', () => {
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Turbo', team: 'blue' }]);
  const car = state.cars[0];
  car.pos = v3(0, 10, -30);
  car.onGround = false;
  car.quat = quatFromYaw(0);
  for (let i = 0; i < 10; i++) {
    const events = stepSimulation(state, { p1: { ...NEUTRAL_INPUT, boost: i % 2 === 0 } }, 1 / 60);
    assert.equal(car.supersonic, false, 'Brief turbo presses below the speed threshold must not activate supersonic');
    assert.deepEqual(events, []);
  }
  for (const [speed, expected] of [[26.6, true], [26.2, true], [25.4, false], [26.2, false], [26.6, true]] as const) {
    car.vel = v3(0, 0, speed);
    const events = stepSimulation(state, {}, 1 / 60);
    assert.equal(car.supersonic, expected, `Expected supersonic=${expected} at ${speed} m/s`);
    assert.deepEqual(events, [], 'Supersonic is a speed state, not a rewarded action');
  }
});

test('shot and save notifications correspond to actual goal-directed actions', () => {
  for (const x of [0, 23]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Striker', team: 'blue' }]);
    state.cars[0].pos = v3(x, CAR_RIDE_HEIGHT, ARENA_HALF_Z - 7);
    state.cars[0].quat = quatFromYaw(0);
    state.cars[0].vel = v3(0, 0, 31);
    state.ball.pos = v3(x, BALL_RADIUS, ARENA_HALF_Z - 3.5);
    const events = stepSimulation(state, {}, 1 / 60);
    assert.ok(events.some((e) => e.type === 'ball_hit'));
    assert.equal(events.some((e) => e.type === 'shot'), x === 0, 'Wide shots must not get a shot-on-goal notification');
  }
  for (const incoming of [-15, 0]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p1', name: 'Keeper', team: 'blue' }]);
    state.cars[0].pos = v3(0, CAR_RIDE_HEIGHT, -ARENA_HALF_Z + 2);
    state.cars[0].quat = quatFromYaw(0);
    state.cars[0].vel = v3(0, 0, 20);
    state.ball.pos = v3(0, BALL_RADIUS, -ARENA_HALF_Z + 5);
    state.ball.vel = v3(0, 0, incoming);
    const events = stepSimulation(state, {}, 1 / 60);
    assert.ok(events.some((e) => e.type === 'ball_hit'));
    assert.equal(events.some((e) => e.type === 'save'), incoming < 0, 'A stationary ball is not a save');
  }
});


