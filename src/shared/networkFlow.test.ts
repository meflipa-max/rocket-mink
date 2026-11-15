import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepClock, InputRateLimiter } from './networkFlow';
import { NEUTRAL_INPUT } from './physics';

test('relay input flooding is reduced to 10 keepalives per second without delaying key changes', () => {
  const limiter = new InputRateLimiter();
  const input = { ...NEUTRAL_INPUT, throttle: 1 };
  let sends = 0;
  for (let i = 0; i < 60; i++) if (limiter.accept(input, i * 1000 / 60, true)) sends++;
  assert.ok(sends <= 10);
  assert.equal(limiter.accept({ ...input, jump: true }, 1001, true), true);
  assert.equal(limiter.accept(input, 1002, true), true, 'A release cannot wait behind the previous press');
});

test('a stalled or backgrounded host cannot build up a permanent simulation backlog', () => {
  const clock = new FixedStepClock();
  for (let i = 0; i < 100; i++) assert.equal(clock.advance(1), 4);
  assert.equal(clock.advance(1 / 60), 1);
  assert.equal(clock.advance(0), 0);
  assert.equal(clock.advance(NaN), 0);
  for (let i = 0; i < 10; i++) assert.equal(clock.advance(1 / 60), 1);
});
