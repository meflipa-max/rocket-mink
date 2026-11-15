import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState, MAX_BOOST_SPEED, NEUTRAL_INPUT, resetKickoff, stepSimulation, type SimulationEvent } from './physics';
import { applyGodModeMagnet, GOD_MODE_DURATION, GOD_MODE_SPAWN_TIMES, stepPowerUps } from './powerUps';
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

test('God Mode exceeds turbo speed for its full duration and restores the normal cap on expiry', () => {
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'P', team: 'blue' }]);
  const car = state.cars[0];
  car.godModeTimer = GOD_MODE_DURATION;
  car.pos = v3(0, 0.56, -65);
  state.ball.pos = v3(40, 1.65, 0);
  let peakSpeed = 0;
  assert.ok(GOD_MODE_DURATION >= 10, 'God Mode should last noticeably longer than 6 seconds');
  const totalFrames = Math.ceil(GOD_MODE_DURATION * 60) + 5;
  for (let i = 0; i < totalFrames; i++) {
    stepSimulation(state, { p: { ...NEUTRAL_INPUT, throttle: 1 } }, 1 / 60);
    peakSpeed = Math.max(peakSpeed, Math.hypot(car.vel.x, car.vel.y, car.vel.z));
    if (i === 370) {
      assert.ok(car.godModeTimer > 4, 'God Mode must still be active past 6 seconds');
    }
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
      state.cars[poweredIndex].godModeTimer = GOD_MODE_DURATION;
      if (relation === 'powered') state.cars[1 - poweredIndex].godModeTimer = GOD_MODE_DURATION;
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

test('God Mode magnet carries the ball at powered speed, captures from mid-range, and releases on expiry', () => {
  const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'P', team: 'blue' }]);
  const car = state.cars[0];
  car.pos = v3(0, 0.56, -65);
  car.quat = { x: 0, y: 0, z: 0, w: 1 };
  car.vel = v3(0, 0, 40);
  car.godModeTimer = GOD_MODE_DURATION;
  state.ball.pos = v3(0, 1.75, -61.2);
  state.ball.vel = v3();
  for (let i = 0; i < 120; i++) stepSimulation(state, { p: { ...NEUTRAL_INPUT, throttle: 1 } }, 1 / 60);
  assert.ok(car.vel.z > 35);
  assert.ok(state.ball.vel.z > 32, 'Normal ball cap must not prevent a magnetic dribble');
  assert.ok(state.ball.pos.z > car.pos.z && state.ball.pos.z - car.pos.z < 10, 'Ball stays in front, within capture range');

  // Mid-range capture (14m ahead/side) pulls ball toward the car
  state.ball.pos = v3(5, 2, car.pos.z + 13);
  state.ball.vel = v3();
  assert.equal(applyGodModeMagnet(state, 1 / 60), true, 'Magnet should capture within 18m');
  assert.ok(state.ball.vel.x < 0, 'Magnet pulls lateral ball toward car');

  car.godModeTimer = 0;
  const previous = { ...state.ball.vel };
  assert.equal(applyGodModeMagnet(state, 1 / 60), false);
  assert.deepEqual(state.ball.vel, previous);
  state.ball.pos = v3(40, 2, 0);
  car.godModeTimer = GOD_MODE_DURATION;
  assert.equal(applyGodModeMagnet(state, 1 / 60), false, 'Distant balls cannot be stolen across the field');
});

test('God Mode sharpens car turning rate and keeps magnetized ball through a turn', () => {
  const normal = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'Normal', team: 'blue' }]);
  const god = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'God', team: 'blue' }]);
  for (const s of [normal, god]) {
    s.cars[0].pos = v3(0, 0.56, -20);
    s.cars[0].quat = { x: 0, y: 0, z: 0, w: 1 };
    s.cars[0].vel = v3(0, 0, 20);
    s.ball.pos = v3(0, 1.65, -16.5);
  }
  god.cars[0].godModeTimer = GOD_MODE_DURATION;

  for (let i = 0; i < 30; i++) {
    stepSimulation(normal, { p: { ...NEUTRAL_INPUT, throttle: 1, steer: 1 } }, 1 / 60);
    stepSimulation(god, { p: { ...NEUTRAL_INPUT, throttle: 1, steer: 1 } }, 1 / 60);
  }

  // After 0.5s of left steering (+X), God Mode car has turned significantly further than normal
  assert.ok(god.cars[0].vel.x > normal.cars[0].vel.x * 1.35, `Expected sharper turn in God Mode: god.vel.x=${god.cars[0].vel.x}, normal.vel.x=${normal.cars[0].vel.x}`);
  const ballDist = Math.hypot(
    god.ball.pos.x - god.cars[0].pos.x,
    god.ball.pos.y - god.cars[0].pos.y,
    god.ball.pos.z - god.cars[0].pos.z,
  );
  assert.ok(ballDist < 8, `Magnet should hold ball near car through sharp turn, got ${ballDist}`);
});
