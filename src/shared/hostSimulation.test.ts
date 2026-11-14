import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSimulation } from './hostSimulation';
import { NEUTRAL_INPUT } from './physics';

test('host accepts known player inputs and can advance the match', () => {
  const host = new HostSimulation('1v1', 'dfh_night', [
    { id: 'a', name: 'A', team: 'blue' },
    { id: 'b', name: 'B', team: 'orange' },
  ]);
  host.state.phase = 'active';
  host.setInput('a', { ...NEUTRAL_INPUT, throttle: 1 });
  for (let i = 0; i < 60; i++) host.step(1 / 60);
  assert.ok(Math.hypot(host.state.cars[0].vel.x, host.state.cars[0].vel.z) > 1);
  host.removeInput('a');
  assert.doesNotThrow(() => host.step(Infinity));
});
