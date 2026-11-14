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
  MAX_CAR_SPEED,
  NEUTRAL_INPUT,
  SUPERSONIC_THRESHOLD,
  createMatchState,
  resetKickoff,
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

  // Advance past celebration timer
  for (let i = 0; i < 210; i++) {
    stepSimulation(state, {}, 1 / 60);
  }
  assert.equal(state.phase, 'ended');
  assert.equal(state.winner, 'orange');

  resetKickoff(state);
  assert.equal(state.phase, 'countdown');
});
