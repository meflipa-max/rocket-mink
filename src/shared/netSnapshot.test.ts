import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState } from './physics';
import {
  packCompactSnapshot,
  reconcilePredictedSnapshot,
  unpackCompactSnapshot,
} from './netSnapshot';

test('compact snapshot packing shrinks payload dramatically while preserving state fidelity', () => {
  const snap = createMatchState('2v2', 'neo_tokyo', [
    { id: 'host-1', name: 'HostPilot', team: 'blue' },
    { id: 'guest-2', name: 'GuestPilot', team: 'orange' },
  ]);
  snap.phase = 'active';
  snap.tick = 142;
  snap.clockSeconds = 245.5;
  snap.boostPads[0].active = false;
  snap.boostPads[0].respawnTimer = 8.4;
  snap.cars[0].pos = { x: 12.3456, y: 4.5678, z: -30.1234 };
  snap.cars[0].onGround = true;
  snap.cars[0].supersonic = true;

  const fullBytes = JSON.stringify(snap).length;
  const wire = packCompactSnapshot(snap, 77);
  const compactBytes = JSON.stringify(wire).length;

  assert.ok(compactBytes < fullBytes * 0.4, `Expected compact (${compactBytes}B) < 40% of full (${fullBytes}B)`);

  const unpacked = unpackCompactSnapshot(wire, snap);
  assert.equal(unpacked.tick, 142);
  assert.equal(unpacked.cars[0].name, 'HostPilot');
  assert.equal(unpacked.cars[0].team, 'blue');
  assert.equal(unpacked.cars[0].supersonic, true);
  assert.equal(unpacked.boostPads[0].active, false);
  assert.ok(Math.abs(unpacked.boostPads[0].respawnTimer - 8.4) < 0.02);
  assert.equal(unpacked.boostPads[1].active, true);
  assert.ok(Math.abs(unpacked.cars[0].pos.x - 12.35) < 0.02);
});

test('reconcilePredictedSnapshot smooths small local error and snaps on large reset', () => {
  const predicted = createMatchState('1v1', 'dfh_night', [
    { id: 'host-1', name: 'Host', team: 'blue' },
    { id: 'guest-2', name: 'Guest', team: 'orange' },
  ]);
  predicted.phase = 'active';
  const auth = structuredClone(predicted);

  // Small 0.5m local error should smoothly blend instead of snapping completely
  predicted.cars[1].pos.x = 10.0;
  auth.cars[1].pos.x = 10.5;
  reconcilePredictedSnapshot(predicted, auth, 'guest-2');
  assert.ok(predicted.cars[1].pos.x > 10.0 && predicted.cars[1].pos.x < 10.45);

  // Large 15m desync (e.g. reset or hard hit) should snap immediately
  predicted.cars[1].pos.z = 0;
  auth.cars[1].pos.z = 18;
  reconcilePredictedSnapshot(predicted, auth, 'guest-2');
  assert.equal(predicted.cars[1].pos.z, 18);
});
