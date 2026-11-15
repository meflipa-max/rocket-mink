import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientPrediction } from './clientPrediction';
import { HostSimulation } from './hostSimulation';
import { createMatchState, NEUTRAL_INPUT, stepSimulation } from './physics';
import { packCompactSnapshot, unpackCompactSnapshot } from './netSnapshot';

const DT = 1 / 60;
function match() {
  const state = createMatchState('1v1', 'dfh_night', [{ id: 'guest', name: 'Guest', team: 'blue' }]);
  state.phase = 'active';
  state.boostPads = [];
  return state;
}

test('delayed host corrections replay unacknowledged steering and jumps instead of pulling the guest backwards', () => {
  const state = match();
  const prediction = new ClientPrediction();
  const authoritative = structuredClone(state);
  const input = { ...NEUTRAL_INPUT, throttle: 1, steer: 0.2, boost: true };
  for (let i = 0; i < 45; i++) {
    prediction.advance(state, 'guest', input, DT);
    stepSimulation(authoritative, { guest: input }, DT);
  }
  authoritative.cars[0].inputTime = prediction.time;
  for (let i = 0; i < 12; i++) {
    prediction.advance(state, 'guest', { ...input, jump: i === 0 || i === 7 }, DT);
  }
  const expected = structuredClone(state.cars[0]);
  const compact = unpackCompactSnapshot(packCompactSnapshot(authoritative, 1), authoritative);
  const corrected = prediction.reconcile(state, compact, 'guest');
  const car = corrected.cars[0];
  assert.ok(Math.hypot(car.pos.x - expected.pos.x, car.pos.y - expected.pos.y, car.pos.z - expected.pos.z) < 0.03);
  assert.equal(car.hasDoubleJump, expected.hasDoubleJump);
  assert.equal(car.isFlipping, expected.isFlipping);
  assert.equal(car.prevJumpInput, expected.prevJumpInput);
  assert.equal(corrected.clockSeconds, compact.clockSeconds);
});

test('host echoes how much input it actually simulated, including time between input packets', () => {
  const host = new HostSimulation('1v1', 'dfh_night', [{ id: 'guest', name: 'Guest', team: 'blue' }]);
  host.setInput('guest', NEUTRAL_INPUT, 2);
  host.step(DT);
  host.step(DT);
  assert.ok(Math.abs(host.state.cars[0].inputTime! - (2 + 2 * DT)) < 1e-8);
  const car = host.state.cars[0];
  car.prevJumpInput = true;
  car.airTimeSinceJump = 0.34;
  const unpacked = unpackCompactSnapshot(packCompactSnapshot(host.state, 1), host.state).cars[0];
  assert.equal(unpacked.prevJumpInput, true);
  assert.equal(unpacked.airTimeSinceJump, 0.34);
  assert.ok(Math.abs(unpacked.inputTime! - car.inputTime!) < 0.0001);
});

test('guest prediction does not run bot AI and bounds extrapolation while local controls stay immediate', () => {
  const state = match();
  const remote = structuredClone(state.cars[0]);
  remote.id = 'remote';
  remote.isBot = true;
  remote.pos = { x: 20, y: 0.56, z: 0 };
  remote.vel = { x: 5, y: 0, z: 0 };
  state.cars.push(remote);
  const prediction = new ClientPrediction();
  const rotation = { ...remote.quat };
  for (let i = 0; i < 60; i++) prediction.advance(state, 'guest', { ...NEUTRAL_INPUT, throttle: 1 }, DT);
  assert.deepEqual(remote.quat, rotation);
  assert.deepEqual(remote.vel, { x: 5, y: 0, z: 0 });
  assert.ok(remote.pos.x < 20.7, 'Remote extrapolation must stop after 100ms');
  assert.ok(Math.hypot(state.cars[0].vel.x, state.cars[0].vel.z) > 5);
  assert.equal(state.powerUps.elapsed, 0, 'Guest must not simulate a second match clock');
});

test('kickoff clears previous input history so old jumps and boost are not replayed', () => {
  const state = match();
  const prediction = new ClientPrediction();
  prediction.advance(state, 'guest', { ...NEUTRAL_INPUT, throttle: 1, jump: true }, DT);
  const kickoff = match();
  kickoff.phase = 'countdown';
  kickoff.cars[0].inputTime = 0;
  const corrected = prediction.reconcile(state, kickoff, 'guest');
  assert.deepEqual(corrected, kickoff);
  kickoff.phase = 'active';
  assert.deepEqual(prediction.reconcile(corrected, kickoff, 'guest'), kickoff);
});

test('guest stays responsive across repeated compact snapshots with 100ms and 300ms round trips', () => {
  for (const delay of [3, 9]) {
    const host = new HostSimulation('1v1', 'dfh_night', [{ id: 'guest', name: 'Guest', team: 'blue' }]);
    host.state.phase = 'active';
    host.state.boostPads = [];
    let client = structuredClone(host.state);
    const reference = structuredClone(host.state);
    const prediction = new ClientPrediction();
    const commands: Array<{ at: number; time: number; input: typeof NEUTRAL_INPUT }> = [];
    const snapshots: Array<{ at: number; state: typeof client }> = [];
    let largestCorrection = 0;
    for (let frame = 0; frame < 100; frame++) {
      const input = { ...NEUTRAL_INPUT, throttle: 1, steer: 0.1, boost: true, jump: frame >= 50 && frame < 54 };
      if (frame % 2 === 0) commands.push({ at: frame + delay, time: prediction.time, input });
      for (const packet of commands.filter((packet) => packet.at === frame)) host.setInput('guest', packet.input, packet.time);
      host.step(DT);
      if (frame % 2 === 0) snapshots.push({ at: frame + delay, state: unpackCompactSnapshot(packCompactSnapshot(host.state, frame + 1), host.state) });
      for (const packet of snapshots.filter((packet) => packet.at === frame)) {
        const before = { ...client.cars[0].pos };
        client = prediction.reconcile(client, packet.state, 'guest');
        if (frame > delay * 2 + 4) largestCorrection = Math.max(largestCorrection, Math.hypot(client.cars[0].pos.x - before.x, client.cars[0].pos.y - before.y, client.cars[0].pos.z - before.z));
      }
      prediction.advance(client, 'guest', input, DT);
      stepSimulation(reference, { guest: input }, DT, false);
    }
    assert.ok(largestCorrection < 0.15, `${delay * 2 * DT * 1000}ms RTT correction was ${largestCorrection}m`);
    const a = client.cars[0].pos;
    const b = reference.cars[0].pos;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.2);
  }
});

test('in-flight guest jump and steer are never cancelled when host echoes advanced inputTime for an older seq', () => {
  const host = new HostSimulation('1v1', 'dfh_night', [{ id: 'guest', name: 'Guest', team: 'blue' }]);
  host.state.phase = 'active';
  host.state.boostPads = [];
  let client = structuredClone(host.state);
  const prediction = new ClientPrediction();

  // Frames 0..9: steady throttle (seq 1) received by host
  const drive = { ...NEUTRAL_INPUT, throttle: 1 };
  host.setInput('guest', drive, 0, 1);
  for (let i = 0; i < 10; i++) {
    prediction.advance(client, 'guest', drive, DT, true, 1);
    host.step(DT);
  }

  // Frame 10..15: guest taps Jump + Steer (seq 2), STILL IN FLIGHT to host
  const jumpTurn = { ...NEUTRAL_INPUT, throttle: 1, steer: 1, jump: true };
  for (let i = 0; i < 6; i++) {
    prediction.advance(client, 'guest', jumpTurn, DT, true, 2);
    // Host is still running seq 1 because seq 2 hasn't arrived yet!
    host.step(DT);
  }
  assert.ok(client.cars[0].pos.y > 0.7, 'Guest should already be airborne locally');

  // Host sends a snapshot BEFORE receiving seq 2 (inputTime advanced past 10*DT, inputSeq is still 1)
  const preAckSnap = unpackCompactSnapshot(packCompactSnapshot(host.state, 1), host.state);
  assert.equal(preAckSnap.cars[0].inputSeq, 1);
  assert.ok(preAckSnap.cars[0].inputTime! > 15 * DT);

  client = prediction.reconcile(client, preAckSnap, 'guest');
  assert.ok(
    client.cars[0].pos.y > 0.7 && !client.cars[0].onGround,
    `In-flight jump must NOT be cancelled back onto ground (y=${client.cars[0].pos.y}, onGround=${client.cars[0].onGround})`,
  );
});

test('ball continues predicting smoothly past 100ms between relay snapshots while remote cars stay bounded', () => {
  const state = match();
  state.ball.pos = { x: 0, y: 2, z: 0 };
  state.ball.vel = { x: 12, y: 0, z: 0 };
  const prediction = new ClientPrediction();

  // Advance 12 frames = 200ms without a host snapshot
  let xAt100ms = 0;
  for (let i = 0; i < 12; i++) {
    prediction.advance(state, 'guest', NEUTRAL_INPUT, DT, true, 1);
    if (i === 5) xAt100ms = state.ball.pos.x;
  }
  assert.ok(
    state.ball.pos.x > xAt100ms + 0.8,
    `Ball should keep gliding between 100ms and 200ms (at100ms=${xAt100ms}, at200ms=${state.ball.pos.x})`,
  );
});

