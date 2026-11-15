import { clamp, lerp, normQuat, slerpQuat } from './math3d';
import type {
  CarCustomization,
  CarState,
  GameStateSnapshot,
  Team,
  Vec3,
} from './types';

export interface CompactCarWire {
  gm?: number;
  it?: number;
  aj?: number;
  id: string;
  p: [number, number, number];
  v: [number, number, number];
  q: [number, number, number, number];
  b: number;
  ws: number;
  sa: number;
  /** Bitmask: 1=onGround, 2=hasDoubleJump, 4=isFlipping, 8=supersonic, 16=jump held */
  f: number;
  gn: [number, number, number];
  ft: number;
  fa: [number, number, number];
  dt: number;
  s: number;
  g: number;
  sh: number;
  sv: number;
  d: number;
}

export interface CompactGameStateWire {
  pu?: GameStateSnapshot['powerUps'];
  seq: number;
  t: number;
  ph: GameStateSnapshot['phase'];
  pt: number;
  cs: number;
  ot: 0 | 1;
  sb: number;
  so: number;
  w: Team | null;
  lgs: string | null;
  lgt: Team | null;
  lgk: number;
  ball: {
    p: [number, number, number];
    v: [number, number, number];
    a: [number, number, number];
    lt: Team | null;
  };
  /** Indices of currently inactive boost pads along with remaining respawn timers */
  ip: Array<[number, number]>;
  cars: CompactCarWire[];
}

export interface RosterEntry {
  id: string;
  name: string;
  team: Team;
  isBot: boolean;
  customization: CarCustomization;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function packCompactSnapshot(
  snapshot: GameStateSnapshot,
  seq: number,
): CompactGameStateWire {
  const ip: Array<[number, number]> = [];
  for (let i = 0; i < snapshot.boostPads.length; i++) {
    const pad = snapshot.boostPads[i];
    if (!pad.active) {
      ip.push([i, r2(pad.respawnTimer)]);
    }
  }

  return {
    pu: structuredClone(snapshot.powerUps),
    seq,
    t: snapshot.tick,
    ph: snapshot.phase,
    pt: r2(snapshot.phaseTimer),
    cs: r2(snapshot.clockSeconds),
    ot: snapshot.isOvertime ? 1 : 0,
    sb: snapshot.scoreBlue,
    so: snapshot.scoreOrange,
    w: snapshot.winner,
    lgs: snapshot.lastGoalScorer,
    lgt: snapshot.lastGoalTeam,
    lgk: snapshot.lastGoalSpeedKph,
    ball: {
      p: [r2(snapshot.ball.pos.x), r2(snapshot.ball.pos.y), r2(snapshot.ball.pos.z)],
      v: [r2(snapshot.ball.vel.x), r2(snapshot.ball.vel.y), r2(snapshot.ball.vel.z)],
      a: [r2(snapshot.ball.angVel.x), r2(snapshot.ball.angVel.y), r2(snapshot.ball.angVel.z)],
      lt: snapshot.ball.lastTouchTeam,
    },
    ip,
    cars: snapshot.cars.map((car) => {
      const f =
        (car.onGround ? 1 : 0) |
        (car.hasDoubleJump ? 2 : 0) |
        (car.isFlipping ? 4 : 0) |
        (car.supersonic ? 8 : 0) |
        (car.prevJumpInput ? 16 : 0);
      return {
        gm: r2(car.godModeTimer ?? 0),
        it: car.inputTime === undefined ? undefined : Math.round(car.inputTime * 10000) / 10000,
        aj: car.airTimeSinceJump,
        id: car.id,
        p: [r2(car.pos.x), r2(car.pos.y), r2(car.pos.z)],
        v: [r2(car.vel.x), r2(car.vel.y), r2(car.vel.z)],
        q: [r3(car.quat.x), r3(car.quat.y), r3(car.quat.z), r3(car.quat.w)],
        b: r2(car.boost),
        ws: r2(car.wheelSpin),
        sa: r2(car.steerAngle),
        f,
        gn: [r3(car.groundNormal.x), r3(car.groundNormal.y), r3(car.groundNormal.z)],
        ft: r2(car.flipTimer),
        fa: [r3(car.flipAxis.x), r3(car.flipAxis.y), r3(car.flipAxis.z)],
        dt: r2(car.demolishedTimer),
        s: car.score,
        g: car.goals,
        sh: car.shots,
        sv: car.saves,
        d: car.demos,
      };
    }),
  };
}

export function unpackCompactSnapshot(
  wire: CompactGameStateWire,
  template: GameStateSnapshot,
): GameStateSnapshot {
  const templateCarsById = new Map(template.cars.map((c) => [c.id, c]));
  const inactiveMap = new Map<number, number>(wire.ip);

  return {
    powerUps: structuredClone(wire.pu ?? { elapsed: 0, spawnCount: 0, item: null }),
    tick: wire.t,
    mode: template.mode,
    arenaId: template.arenaId,
    phase: wire.ph,
    phaseTimer: wire.pt,
    clockSeconds: wire.cs,
    isOvertime: wire.ot === 1,
    scoreBlue: wire.sb,
    scoreOrange: wire.so,
    lastGoalScorer: wire.lgs,
    lastGoalTeam: wire.lgt,
    lastGoalSpeedKph: wire.lgk,
    winner: wire.w,
    boostPads: template.boostPads.map((pad, idx) => {
      const respawn = inactiveMap.get(idx);
      return {
        ...pad,
        active: respawn === undefined,
        respawnTimer: respawn ?? 0,
      };
    }),
    ball: {
      pos: { x: wire.ball.p[0], y: wire.ball.p[1], z: wire.ball.p[2] },
      vel: { x: wire.ball.v[0], y: wire.ball.v[1], z: wire.ball.v[2] },
      angVel: { x: wire.ball.a[0], y: wire.ball.a[1], z: wire.ball.a[2] },
      radius: template.ball.radius,
      lastTouchTeam: wire.ball.lt,
      lastTouchPlayerId: template.ball.lastTouchPlayerId,
      lastTouchName: template.ball.lastTouchName,
      lastHitSpeed: template.ball.lastHitSpeed,
    },
    cars: wire.cars.map((wc, idx): CarState => {
      const base = templateCarsById.get(wc.id) || template.cars[idx];
      const q = normQuat({ x: wc.q[0], y: wc.q[1], z: wc.q[2], w: wc.q[3] });
      return {
        id: wc.id,
        inputTime: wc.it,
        godModeTimer: wc.gm ?? 0,
        name: base?.name ?? 'Pilota',
        team: base?.team ?? 'blue',
        isBot: base?.isBot ?? false,
        customization: base?.customization ?? template.cars[0].customization,
        pos: { x: wc.p[0], y: wc.p[1], z: wc.p[2] },
        vel: { x: wc.v[0], y: wc.v[1], z: wc.v[2] },
        quat: q,
        angVel: { x: 0, y: 0, z: 0 },
        boost: wc.b,
        onGround: (wc.f & 1) !== 0,
        groundNormal: { x: wc.gn[0], y: wc.gn[1], z: wc.gn[2] },
        hasDoubleJump: (wc.f & 2) !== 0,
        prevJumpInput: (wc.f & 16) !== 0,
        airTimeSinceJump: wc.aj ?? 0,
        isFlipping: (wc.f & 4) !== 0,
        flipTimer: wc.ft,
        flipAxis: { x: wc.fa[0], y: wc.fa[1], z: wc.fa[2] },
        wheelSpin: wc.ws,
        steerAngle: wc.sa,
        supersonic: (wc.f & 8) !== 0,
        demolishedTimer: wc.dt,
        score: wc.s,
        goals: wc.g,
        shots: wc.sh,
        saves: wc.sv,
        demos: wc.d,
      };
    }),
  };
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

function distVec3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Gently reconciles a 60fps client-predicted GameStateSnapshot with an incoming
 * authoritative snapshot from the host. Small prediction errors are smoothed out;
 * large resets (kickoffs, demolitions, big collisions) snap immediately.
 */
export function reconcilePredictedSnapshot(
  predicted: GameStateSnapshot,
  authoritative: GameStateSnapshot,
  localPlayerId: string,
): GameStateSnapshot {
  const rosterMismatch =
    predicted.cars.length !== authoritative.cars.length ||
    predicted.cars.some((car, idx) => car.id !== authoritative.cars[idx]?.id);
  if (rosterMismatch) {
    return structuredClone(authoritative);
  }

  predicted.tick = authoritative.tick;
  predicted.phase = authoritative.phase;
  predicted.phaseTimer = authoritative.phaseTimer;
  predicted.clockSeconds = authoritative.clockSeconds;
  predicted.isOvertime = authoritative.isOvertime;
  predicted.scoreBlue = authoritative.scoreBlue;
  predicted.scoreOrange = authoritative.scoreOrange;
  predicted.lastGoalScorer = authoritative.lastGoalScorer;
  predicted.lastGoalTeam = authoritative.lastGoalTeam;
  predicted.lastGoalSpeedKph = authoritative.lastGoalSpeedKph;
  predicted.winner = authoritative.winner;
  predicted.powerUps = structuredClone(authoritative.powerUps);
  predicted.boostPads = authoritative.boostPads;

  if (authoritative.phase !== 'active') {
    predicted.ball = { ...authoritative.ball };
    predicted.cars = authoritative.cars.map((c) => ({
      ...c,
      pos: { ...c.pos },
      vel: { ...c.vel },
      quat: { ...c.quat },
      groundNormal: { ...c.groundNormal },
      flipAxis: { ...c.flipAxis },
    }));
    return predicted;
  }

  // Reconcile ball smoothly
  const ballErr = distVec3(predicted.ball.pos, authoritative.ball.pos);
  if (ballErr > 4.5) {
    predicted.ball = {
      ...authoritative.ball,
      pos: { ...authoritative.ball.pos },
      vel: { ...authoritative.ball.vel },
      angVel: { ...authoritative.ball.angVel },
    };
  } else {
    const ballPosBlend = clamp(0.24 + ballErr * 0.08, 0.24, 0.65);
    predicted.ball.pos = lerpVec3(predicted.ball.pos, authoritative.ball.pos, ballPosBlend);
    predicted.ball.vel = lerpVec3(predicted.ball.vel, authoritative.ball.vel, 0.35);
    predicted.ball.angVel = lerpVec3(predicted.ball.angVel, authoritative.ball.angVel, 0.35);
    predicted.ball.lastTouchTeam = authoritative.ball.lastTouchTeam;
  }

  // Reconcile each car
  for (let i = 0; i < authoritative.cars.length; i++) {
    const auth = authoritative.cars[i];
    const pred = predicted.cars[i];
    const isLocal = auth.id === localPlayerId;
    const err = distVec3(pred.pos, auth.pos);
    const demoChanged = (pred.demolishedTimer > 0) !== (auth.demolishedTimer > 0);

    if (demoChanged || err > (isLocal ? 3.2 : 4.2)) {
      predicted.cars[i] = {
        ...auth,
        pos: { ...auth.pos },
        vel: { ...auth.vel },
        quat: { ...auth.quat },
        groundNormal: { ...auth.groundNormal },
        flipAxis: { ...auth.flipAxis },
      };
      continue;
    }

    if (isLocal) {
      // Preserve immediate local steering/jump feel; gently correct drift
      if (err > 0.08) {
        const posBlend = clamp(0.14 + err * 0.08, 0.14, 0.45);
        pred.pos = lerpVec3(pred.pos, auth.pos, posBlend);
        pred.vel = lerpVec3(pred.vel, auth.vel, 0.22);
        pred.quat = slerpQuat(pred.quat, auth.quat, 0.18);
      }
      if (Math.abs(pred.boost - auth.boost) > 6) {
        pred.boost = auth.boost;
      }
    } else {
      // Remote cars converge cleanly to authoritative state
      pred.pos = lerpVec3(pred.pos, auth.pos, 0.36);
      pred.vel = lerpVec3(pred.vel, auth.vel, 0.45);
      pred.quat = slerpQuat(pred.quat, auth.quat, 0.4);
      pred.boost = auth.boost;
      pred.onGround = auth.onGround;
      pred.groundNormal = { ...auth.groundNormal };
      pred.hasDoubleJump = auth.hasDoubleJump;
      pred.isFlipping = auth.isFlipping;
      pred.flipTimer = auth.flipTimer;
      pred.flipAxis = { ...auth.flipAxis };
      pred.wheelSpin = auth.wheelSpin;
      pred.steerAngle = auth.steerAngle;
      pred.supersonic = auth.supersonic;
    }

    pred.demolishedTimer = auth.demolishedTimer;
    pred.godModeTimer = auth.godModeTimer ?? 0;
    pred.score = auth.score;
    pred.goals = auth.goals;
    pred.shots = auth.shots;
    pred.saves = auth.saves;
    pred.demos = auth.demos;
  }

  return predicted;
}
