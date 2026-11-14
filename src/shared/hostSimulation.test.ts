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

test('host allows hot-joining player to replace a bot and receive inputs', () => {
  const host = new HostSimulation('2v2', 'dfh_night', [
    { id: 'host-1', name: 'Papa', team: 'blue' },
    { id: 'bot-b', name: 'Bot B', team: 'blue', isBot: true },
    { id: 'bot-o', name: 'Bot O', team: 'orange', isBot: true },
  ]);
  host.state.phase = 'active';
  host.addOrReplacePlayer({ id: 'son-1', name: 'Figlio', team: 'orange' });
  const sonCar = host.state.cars.find((c) => c.id === 'son-1');
  assert.ok(sonCar);
  assert.equal(sonCar.isBot, false);
  assert.equal(sonCar.name, 'Figlio');

  host.setInput('son-1', { ...NEUTRAL_INPUT, throttle: 1 });
  for (let i = 0; i < 30; i++) host.step(1 / 60);
  assert.ok(Math.hypot(sonCar.vel.x, sonCar.vel.z) > 1);

  host.demoteToBot('son-1');
  assert.equal(sonCar.isBot, true);
});
