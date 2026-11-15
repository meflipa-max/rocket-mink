import test from 'node:test';
import assert from 'node:assert/strict';
import { carTouchesBoostPad, boostPadRadius } from './boostPickup';
import { createMatchState, stepSimulation } from './physics';
import { quatFromYaw, v3 } from './math3d';

test('boost can be collected by the car side or bumper at the pad edge, at any heading', () => {
  for (const isBig of [false, true]) for (const yaw of [0, Math.PI / 2]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'P', team: 'blue' }]);
    const car = state.cars[0];
    const pad = { id: 0, pos: v3(0, isBig ? 0.9 : 0.3, 0), isBig, active: true, respawnTimer: 0 };
    car.quat = quatFromYaw(yaw);
    const halfWidth = yaw === 0 ? 1.05 : 1.75;
    car.pos = v3(boostPadRadius(isBig) + halfWidth - 0.05, 0.56, 0);
    assert.ok(carTouchesBoostPad(car, pad));
    car.pos.x += 0.3;
    assert.equal(carTouchesBoostPad(car, pad), false);
    car.pos = v3(0, 10, 0);
    assert.equal(carTouchesBoostPad(car, pad), false, 'High aerials must not collect ground pads');
    car.pos = v3(8, 0.56, 0);
    assert.ok(carTouchesBoostPad(car, pad, v3(-8, 0.56, 0)), 'Fast crossings must not skip the pickup');
  }
});

test('edge pickups award boost once and leave full cars and inactive pads untouched', () => {
  for (const isBig of [false, true]) {
    const state = createMatchState('freeplay', 'dfh_night', [{ id: 'p', name: 'P', team: 'blue' }]);
    state.boostPads = [{ id: 0, pos: v3(0, 0.3, 0), isBig, active: true, respawnTimer: 0 }];
    const car = state.cars[0];
    car.pos = v3(boostPadRadius(isBig) + 0.9, 0.56, 0);
    car.quat = quatFromYaw(0);
    car.boost = 100;
    assert.equal(stepSimulation(state, {}, 1 / 60).some((event) => event.type === 'boost_pickup'), false);
    car.boost = 0;
    assert.ok(stepSimulation(state, {}, 1 / 60).some((event) => event.type === 'boost_pickup'));
    assert.equal(car.boost, isBig ? 100 : 12);
    assert.equal(state.boostPads[0].active, false);
    assert.equal(stepSimulation(state, {}, 1 / 60).some((event) => event.type === 'boost_pickup'), false);
  }
});
