import { clamp, lerp, normQuat, slerpQuat } from './math3d';
import type { GameStateSnapshot, Quat, Vec3 } from './types';

export const GOAL_CELEBRATION_DURATION = 1.25;
export const GOAL_REPLAY_DURATION = 7.0;
export const REPLAY_CLIP_WINDOW_SEC = 5.2;

// Show the approach at speed, then slow the decisive final touch and goal.
export function replayTimelineProgress(progress: number): number {
  const p = clamp(progress, 0, 1);
  return p < 0.65 ? p / 0.65 * 0.82 : 0.82 + (p - 0.65) / 0.35 * 0.18;
}
const SAMPLE_INTERVAL_SEC = 1 / 30;
const MAX_BUFFER_AGE_SEC = 7.5;

export interface ReplayCarFrame {
  id: string;
  pos: Vec3;
  quat: Quat;
  boost: number;
  wheelSpin: number;
  steerAngle: number;
  supersonic: boolean;
  isFlipping: boolean;
  demolished: boolean;
  onGround: boolean;
  groundNormal: Vec3;
}

export interface ReplayFrame {
  t: number;
  ballPos: Vec3;
  ballAngVel: Vec3;
  cars: ReplayCarFrame[];
}

export interface ReplayClip {
  scorerId: string | null;
  scorerName: string | null;
  goalTeam: GameStateSnapshot['lastGoalTeam'];
  goalSpeedKph: number;
  frames: ReplayFrame[];
}

export class GoalReplayRecorder {
  private frames: ReplayFrame[] = [];
  private lastSampleTime = -Infinity;

  clear(): void {
    this.frames = [];
    this.lastSampleTime = -Infinity;
  }

  record(state: GameStateSnapshot, elapsedSec: number, force = false): void {
    if (!force && elapsedSec - this.lastSampleTime < SAMPLE_INTERVAL_SEC && this.frames.length > 0) {
      return;
    }
    this.lastSampleTime = elapsedSec;

    this.frames.push({
      t: elapsedSec,
      ballPos: { ...state.ball.pos },
      ballAngVel: { ...state.ball.angVel },
      cars: state.cars.map((car) => ({
        id: car.id,
        pos: { ...car.pos },
        quat: { ...car.quat },
        boost: car.boost,
        wheelSpin: car.wheelSpin,
        steerAngle: car.steerAngle,
        supersonic: car.supersonic,
        isFlipping: car.isFlipping,
        demolished: car.demolishedTimer > 0,
        onGround: car.onGround,
        groundNormal: { ...car.groundNormal },
      })),
    });

    const cutoff = elapsedSec - MAX_BUFFER_AGE_SEC;
    while (this.frames.length > 2 && this.frames[0].t < cutoff) {
      this.frames.shift();
    }
  }

  captureClip(
    state: GameStateSnapshot,
    windowSec = REPLAY_CLIP_WINDOW_SEC,
  ): ReplayClip | null {
    if (this.frames.length === 0) return null;
    const endTime = this.frames[this.frames.length - 1].t;
    const startTime = endTime - windowSec;
    const slice = this.frames.filter((f) => f.t >= startTime);
    const clipFrames = slice.length >= 2 ? slice : [...this.frames];

    return {
      scorerId: state.ball.lastTouchPlayerId,
      scorerName: state.lastGoalScorer,
      goalTeam: state.lastGoalTeam,
      goalSpeedKph: state.lastGoalSpeedKph,
      frames: clipFrames,
    };
  }
}

export function sampleReplayFrame(clip: ReplayClip, progress01: number): ReplayFrame | null {
  const frames = clip.frames;
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];

  const p = clamp(progress01, 0, 1);
  const startT = frames[0].t;
  const endT = frames[frames.length - 1].t;
  const span = Math.max(1e-4, endT - startT);
  const targetT = startT + p * span;

  // Binary search bracket [lo, hi]
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= targetT) lo = mid;
    else hi = mid;
  }

  const a = frames[lo];
  const b = frames[hi];
  const dt = Math.max(1e-5, b.t - a.t);
  const alpha = clamp((targetT - a.t) / dt, 0, 1);

  return {
    t: targetT,
    ballPos: {
      x: lerp(a.ballPos.x, b.ballPos.x, alpha),
      y: lerp(a.ballPos.y, b.ballPos.y, alpha),
      z: lerp(a.ballPos.z, b.ballPos.z, alpha),
    },
    ballAngVel: {
      x: lerp(a.ballAngVel.x, b.ballAngVel.x, alpha),
      y: lerp(a.ballAngVel.y, b.ballAngVel.y, alpha),
      z: lerp(a.ballAngVel.z, b.ballAngVel.z, alpha),
    },
    cars: a.cars.map((carA, idx) => {
      const carB = b.cars[idx]?.id === carA.id ? b.cars[idx] : b.cars.find((c) => c.id === carA.id) || carA;
      return {
        id: carA.id,
        pos: {
          x: lerp(carA.pos.x, carB.pos.x, alpha),
          y: lerp(carA.pos.y, carB.pos.y, alpha),
          z: lerp(carA.pos.z, carB.pos.z, alpha),
        },
        quat: normQuat(slerpQuat(carA.quat, carB.quat, alpha)),
        boost: lerp(carA.boost, carB.boost, alpha),
        wheelSpin: lerp(carA.wheelSpin, carB.wheelSpin, alpha),
        steerAngle: lerp(carA.steerAngle, carB.steerAngle, alpha),
        supersonic: alpha < 0.5 ? carA.supersonic : carB.supersonic,
        isFlipping: alpha < 0.5 ? carA.isFlipping : carB.isFlipping,
        demolished: alpha < 0.5 ? carA.demolished : carB.demolished,
        onGround: alpha < 0.5 ? carA.onGround : carB.onGround,
        groundNormal: alpha < 0.5 ? carA.groundNormal : carB.groundNormal,
      };
    }),
  };
}
