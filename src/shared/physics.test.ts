import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_HALF_Z,
  BALL_RADIUS,
  CAR_RIDE_HEIGHT,
  checkGoalScored,
  createBoostPads,
  resolveArenaSphere,
} from './arena';
import {
  MAX_BALL_SPEED,
  MAX_CAR_SPEED,
  NEUTRAL_INPUT,
  SUPERSONIC_THRESHOLD,
  createMatchState,
  resetKickoff,
  skipGoalReplay,
  stepSimulation,
} from './physics';
import type { PlayerInput } from './types';

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
  for (let i = 0; i < 130; i++) {
    stepSimulation(state, {}, 1 / 60);
  }
  assert.equal(state.phase, 'goal_replay');

  // Advance past goal replay -> golden goal ends match
  for (let i = 0; i < 290; i++) {
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


