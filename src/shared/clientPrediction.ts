import { reconcilePredictedSnapshot } from './netSnapshot';
import { replayCarInput, stepClientPrediction, type SimulationEvent } from './physics';
import type { GameStateSnapshot, PlayerInput } from './types';

type InputFrame = { start: number; end: number; input: PlayerInput };
const HISTORY_SECONDS = 1.25;

/** Keeps corrections on the guest's timeline instead of pulling its car back by the RTT. */
export class ClientPrediction {
  time = 0;
  private frames: InputFrame[] = [];
  private worldPredictionAge = 0;

  reset() {
    this.time = 0;
    this.frames = [];
    this.worldPredictionAge = 0;
  }

  advance(state: GameStateSnapshot, playerId: string, input: PlayerInput, dt: number, fresh = true): SimulationEvent[] {
    const events: SimulationEvent[] = [];
    let remaining = dt;
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 1 / 60);
      if (state.phase === 'active' && fresh) {
        this.frames.push({ start: this.time, end: this.time + step, input: { ...input } });
        events.push(...stepClientPrediction(state, playerId, input, step, this.worldPredictionAge < 0.1));
        this.worldPredictionAge += step;
      } else {
        this.frames = [];
      }
      this.time += step;
      remaining -= step;
    }
    this.frames = this.frames.filter((frame) => frame.end > this.time - HISTORY_SECONDS);
    return events;
  }

  reconcile(predicted: GameStateSnapshot, authoritative: GameStateSnapshot, playerId: string): GameStateSnapshot {
    this.worldPredictionAge = 0;
    const localIndex = authoritative.cars.findIndex((car) => car.id === playerId);
    const inputTime = authoritative.cars[localIndex]?.inputTime;
    const reset = predicted.phase !== authoritative.phase ||
      predicted.scoreBlue !== authoritative.scoreBlue || predicted.scoreOrange !== authoritative.scoreOrange ||
      predicted.cars.length !== authoritative.cars.length ||
      predicted.cars.some((car, i) => car.id !== authoritative.cars[i]?.id);
    if (reset || authoritative.phase !== 'active') {
      this.frames = [];
      return structuredClone(authoritative);
    }
    // Older hosts do not echo input time; preserve compatibility with their snapshots.
    if (inputTime === undefined) return reconcilePredictedSnapshot(predicted, authoritative, playerId);

    const replay = structuredClone(authoritative);
    const historyAvailable = !this.frames.length || inputTime >= this.frames[0].start - 0.001;
    if (historyAvailable) {
      for (const frame of this.frames) {
        const dt = frame.end - Math.max(frame.start, inputTime);
        if (dt > 1e-8) replayCarInput(replay, playerId, frame.input, dt);
      }
    }
    this.frames = this.frames.filter((frame) => frame.end > inputTime);
    const result = reconcilePredictedSnapshot(predicted, authoritative, playerId);
    // Physics uses the corrected present state; the renderer smooths visual corrections.
    if (localIndex >= 0) result.cars[localIndex] = replay.cars[localIndex];
    return result;
  }
}
