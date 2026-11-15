import type { PlayerInput } from './types';

export function relayRates(players: number) {
  const count = Math.max(2, Math.min(6, players));
  return {
    inputIntervalMs: 1000 / Math.min(15, Math.max(8, Math.floor(30 / (count - 1)))),
    stateIntervalTicks: Math.min(5, Math.max(3, count + 1)),
  };
}

/** Limit redundant relay keepalives without delaying any control transition. */
export class InputRateLimiter {
  private last: PlayerInput | null = null;
  private lastAt = -Infinity;
  accept(input: PlayerInput, now: number, relay: boolean, intervalMs = 100): boolean {
    const changed = !this.last || (Object.keys(input) as Array<keyof PlayerInput>).some((key) => input[key] !== this.last![key]);
    if (relay && !changed && now - this.lastAt < intervalMs) return false;
    this.last = { ...input };
    this.lastAt = now;
    return true;
  }
}

/** Discard excess elapsed time after a stalled tab instead of accumulating seconds of catch-up. */
export class FixedStepClock {
  private accumulator = 0;
  constructor(readonly dt = 1 / 60, readonly maxSteps = 4) {}
  advance(elapsed: number): number {
    this.accumulator = Math.min(this.accumulator + Math.max(0, Number.isFinite(elapsed) ? elapsed : 0), this.dt * this.maxSteps);
    const steps = Math.min(this.maxSteps, Math.floor((this.accumulator + 1e-9) / this.dt));
    this.accumulator = Math.max(0, this.accumulator - steps * this.dt);
    return steps;
  }
}
