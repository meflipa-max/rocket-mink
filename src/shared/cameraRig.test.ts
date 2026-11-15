import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowCamera, constrainCamera, smoothCameraUp } from './cameraRig';
import { ARENA_HEIGHT, ARENA_HALF_Z, GOAL_DEPTH, resolveArenaSphere } from './arena';
import { dotV3, lenV3, quatFromUnitVectors, subV3, v3 } from './math3d';

test('follow camera stays inside the shell and follows the driving surface on walls, corners and ceiling', () => {
  const samples = [
    { pos: v3(0, 0.56, 0), up: v3(0, 1, 0) },
    { pos: v3(61.44, 12, 0), up: v3(-1, 0, 0) },
    { pos: v3(55.6, 12, 77.6), up: v3(-Math.SQRT1_2, 0, -Math.SQRT1_2) },
    { pos: v3(60.725, 24.725, 0), up: v3(-Math.SQRT1_2, -Math.SQRT1_2, 0) },
    { pos: v3(0, ARENA_HEIGHT - 0.56, 0), up: v3(0, -1, 0) },
  ];
  for (const sample of samples) {
    for (const ballCam of [true, false]) {
      const car = { pos: sample.pos, groundNormal: sample.up, onGround: true, quat: quatFromUnitVectors(v3(0, 1, 0), sample.up) };
      const view = buildFollowCamera(car, v3(0, 1.65, 0), ballCam);
      assert.equal(resolveArenaSphere(view.position, 0.45).hit, false, JSON.stringify({ sample, ballCam, view }));
      assert.ok(dotV3(subV3(view.position, car.pos), sample.up) > 0, 'Camera belongs on the wheel-facing side of the surface');
      assert.ok(Math.abs(lenV3(view.up) - 1) < 1e-8);
      assert.ok(lenV3(subV3(view.lookAt, view.position)) > 0.5);
    }
  }
});

test('camera can follow inside both recessed goals without clipping the back net or roof', () => {
  for (const side of [-1, 1]) {
    const car = { pos: v3(0, 0.56, side * (ARENA_HALF_Z + 6)), groundNormal: v3(0, 1, 0), onGround: true, quat: quatFromUnitVectors(v3(0, 1, 0), v3(0, 1, 0)) };
    const view = buildFollowCamera(car, v3(0, 1.65, 0), true);
    assert.ok(Math.abs(view.position.z) > ARENA_HALF_Z, 'Camera must be allowed into the goal');
    assert.ok(Math.abs(view.position.z) < ARENA_HALF_Z + GOAL_DEPTH);
    assert.equal(resolveArenaSphere(view.position, 0.45).hit, false);
    const clipped = constrainCamera(view.pivot, v3(50, 15, side * (ARENA_HALF_Z + 20)));
    assert.equal(resolveArenaSphere(clipped, 0.45).hit, false);
  }
});

test('camera up rotates smoothly through a ceiling inversion and recovers in the air without collapsing', () => {
  let up = v3(0, 1, 0);
  for (let i = 0; i < 60; i++) {
    up = smoothCameraUp(up, v3(0, -1, 0), 1 / 60, true);
    assert.ok(Math.abs(lenV3(up) - 1) < 1e-8);
  }
  assert.ok(up.y < -0.99);
  for (let i = 0; i < 120; i++) up = smoothCameraUp(up, v3(0, 1, 0), 1 / 60, false);
  assert.ok(up.y > 0.99);
});
