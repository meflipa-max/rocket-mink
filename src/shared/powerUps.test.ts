import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState, MAX_BOOST_SPEED, NEUTRAL_INPUT, resetKickoff, stepSimulation, type SimulationEvent } from './physics';
import { GOD_MODE_DURATION, GOD_MODE_SPAWN_TIMES, stepPowerUps } from './powerUps';
import { packCompactSnapshot, unpackCompactSnapshot } from './netSnapshot';
import { v3 } from './math3d';

test('God Mode item appears exactly three times over the match and expires if nobody collects it', () => {
  const state = createMatchState('freeplay', 'dfh_night', []);
  const times: number[] = [];
  for (let i = 0; i < 8000; i++) {
    const events: SimulationEvent[] = [];
    stepPowerUps(state, 0.05, events);
    if (events.some((event) => event.type === 'god_mode_spawn')) times.push(state.powerUps.elapsed);
  }
  assert.equal(times.length, 3);
  times.forEach((time, index) => assert.ok(Math.abs(time - GOD_MODE_SPAWN_TIMES[index]) < 0.051));
  assert.equal(state.powerUps.item, null);
  assert.equal(state.powerUps.spawnCount, 3);
});

test('one player collects the item, its state is synchronized, and countdown and prediction cannot spawn items', () => {
  const state = createMatchState('1v1', 'dfh_night', [{ id: 'p', name: 'P', team: 'blue' }]);
  state.powerUps.elapsed = 44.99;
  stepSimulation(state, {}, 1 / 60);
  assert.equal(state.powerUps.spawnCount, 0);
  state.phase = 'active';
  stepSimulation(state, {}, 1 / 60, false);
  assert.equal(state.powerUps.spawnCount, 0);
  const events = stepSimulation(state, {}, 1 / 60);
  assert.ok(events.some((event) => event.type === 'god_mode_spawn'));
  const onWire = unpackCompactSnapshot(packCompactSnapshot(state, 1), state);
  assert.deepEqual(onWire.powerUps.item, state.powerUps.item);
  state.cars[0].pos = v3(-18, 0.56, 0);
  const pickup = stepSimulation(state, {}, 1 / 60);
  assert.ok(pickup.some((event) => event.type === 'god_mode_pickup'));
  assert.equal(state.powerUps.item, null);
  assert.ok(state.cars[0].godModeTimer > GOD_MODE_DURATION - 0.05);
  const unpacked = unpackCompactSnapshot(packCompactSnapshot(state, 2), state);
  assert.ok(Math.abs(unpacked.cars[0].godModeTimer - state.cars[0].godModeTimer) < 0.01);
});

test('God Mode exceeds turbo speed for six seconds and restores the normal cap on expiry', () => {
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'P', team: 'blue' }]);
  const car = state.cars[0];
  car.godModeTimer = GOD_MODE_DURATION;
  car.pos = v3(0, 0.56, -65);
  state.ball.pos = v3(40, 1.65, 0);
  let peakSpeed = 0;
  for (let i = 0; i < 365; i++) {
    stepSimulation(state, { p: { ...NEUTRAL_INPUT, throttle: 1 } }, 1 / 60);
    peakSpeed = Math.max(peakSpeed, Math.hypot(car.vel.x, car.vel.y, car.vel.z));
  }
  assert.ok(peakSpeed > MAX_BOOST_SPEED + 5);
  assert.equal(car.godModeTimer, 0);
  assert.ok(Math.hypot(car.vel.x, car.vel.y, car.vel.z) <= MAX_BOOST_SPEED + 1e-8);
});

test('God Mode demolishes opposing cars on slow side contact, protects its owner, and spares teammates and other powered cars', () => {
  for (const relation of ['enemy', 'teammate', 'powered'] as const) {
    for (const poweredIndex of [0, 1]) {
      const state = createMatchState('1v1', 'dfh_night', [{ id: 'a', name: 'A', team: 'blue' }, { id: 'b', name: 'B', team: relation === 'teammate' ? 'blue' : 'orange' }]);
      state.phase = 'active';
      state.cars[0].pos = v3(0, 0.56, 0);
      state.cars[1].pos = v3(2, 0.56, 0);
      state.cars[poweredIndex].godModeTimer = 6;
      if (relation === 'powered') state.cars[1 - poweredIndex].godModeTimer = 6;
      const events = stepSimulation(state, {}, 1 / 60);
      assert.equal(events.some((event) => event.type === 'demo'), relation === 'enemy');
      assert.equal(state.cars[poweredIndex].demolishedTimer, 0);
      if (relation === 'enemy') assert.ok(state.cars[1 - poweredIndex].demolishedTimer > 0);
    }
  }
});

test('kickoff clears active invincibility and a rematch starts a fresh three-item schedule', () => {
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'P', team: 'blue' }]);
  state.cars[0].godModeTimer = 5;
  state.powerUps.elapsed = 200;
  state.powerUps.spawnCount = 2;
  resetKickoff(state);
  assert.equal(state.cars[0].godModeTimer, 0);
  assert.equal(state.powerUps.spawnCount, 2);
  const rematch = createMatchState('freeplay', 'dfh_night', []);
  assert.deepEqual(rematch.powerUps, { elapsed: 0, spawnCount: 0, item: null });
});
