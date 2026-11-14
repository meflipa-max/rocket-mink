import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState } from './physics';
import { GoalReplayRecorder, sampleReplayFrame } from './replay';

test('GoalReplayRecorder captures rolling frames, locks goal clip, and smoothly interpolates playback', () => {
  const recorder = new GoalReplayRecorder();
  const state = createMatchState('1v1', 'dfh_night', [
    { id: 'p1', name: 'Striker', team: 'blue' },
    { id: 'p2', name: 'Keeper', team: 'orange' },
  ]);
  state.phase = 'active';
  state.lastGoalScorer = 'Striker';
  state.lastGoalTeam = 'blue';
  state.lastGoalSpeedKph = 92;
  state.ball.lastTouchPlayerId = 'p1';

  for (let i = 0; i <= 30; i++) {
    const t = i / 10; // 0.0s .. 3.0s
    state.ball.pos = { x: 0, y: 1.7, z: i * 1.5 };
    state.cars[0].pos = { x: 1, y: 0.56, z: i * 1.2 };
    recorder.record(state, t);
  }

  const clip = recorder.captureClip(state, 2.0);
  assert.ok(clip);
  assert.equal(clip.scorerName, 'Striker');
  assert.equal(clip.goalTeam, 'blue');
  assert.equal(clip.goalSpeedKph, 92);
  assert.ok(clip.frames.length >= 15);

  const midFrame = sampleReplayFrame(clip, 0.5);
  assert.ok(midFrame);
  assert.ok(midFrame.ballPos.z > 25 && midFrame.ballPos.z < 36, `Expected mid ballPos ~30, got ${midFrame.ballPos.z}`);

  const endFrame = sampleReplayFrame(clip, 1.0);
  assert.ok(endFrame);
  assert.ok(Math.abs(endFrame.ballPos.z - 45) < 0.05);

  recorder.clear();
  assert.equal(recorder.captureClip(state), null);
});
