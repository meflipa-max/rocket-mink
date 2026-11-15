import {
  ARENA_HALF_X,
  ARENA_HALF_Z,
  BALL_RADIUS,
  CAR_RIDE_HEIGHT,
  GOAL_HALF_X,
  GOAL_HEIGHT,
  checkGoalScored,
  createBoostPads,
  getKickoffSpawn,
  resolveArenaSphere,
} from './arena';
import { GOAL_CELEBRATION_DURATION, GOAL_REPLAY_DURATION } from './replay';
import { resolveBallContact } from './ballContact';
import { carTouchesBoostPad } from './boostPickup';
import { applyGodModeMagnet, GOD_MODE_BALL_SPEED, GOD_MODE_SPEED, stepPowerUps } from './powerUps';
import {
  addV3,
  clamp,
  crossV3,
  dotV3,
  lenV3,
  lerp,
  mulQuat,
  normQuat,
  normV3,
  quatFromAxisAngle,
  quatFromUnitVectors,
  quatFromYaw,
  rotateVecByQuat,
  scaleV3,
  slerpQuat,
  subV3,
  v3,
} from './math3d';
import type {
  ArenaId,
  BallState,
  CarCustomization,
  CarState,
  GameStateSnapshot,
  MatchMode,
  PlayerInput,
  Team,
  Vec3,
} from './types';
import { DEFAULT_CUSTOMIZATION_BLUE, DEFAULT_CUSTOMIZATION_ORANGE } from './types';

export const GRAVITY = -15.2; // Rocket League-style floaty aerial gravity
export const MAX_CAR_SPEED = 21.0; // Normal max throttle speed (m/s, ~75 km/h)
export const SUPERSONIC_THRESHOLD = 26.5; // Supersonic speed threshold (m/s, ~95 km/h)
export const MAX_BOOST_SPEED = 31.0; // Max boost speed (m/s, ~112 km/h)
export const MAX_BALL_SPEED = 29.0; // ~104 km/h, below the 112 km/h turbo car speed
export const MATCH_DURATION_SECONDS = 300; // 5:00 standard match

export type SimulationEvent =
  | { type: 'god_mode_spawn'; pos: Vec3 }
  | { type: 'god_mode_pickup'; carId: string; playerName: string; team: Team; pos: Vec3 }
  | { type: 'ball_hit'; speed: number; pos: Vec3; playerId: string | null }
  | { type: 'wall_hit'; speed: number; pos: Vec3 }
  | { type: 'jump'; carId: string; pos: Vec3 }
  | { type: 'flip'; carId: string; pos: Vec3 }
  | { type: 'boost_pickup'; carId: string; padId: number; isBig: boolean }
  | { type: 'demo'; attackerId: string; victimId: string; pos: Vec3 }
  | { type: 'goal'; team: Team; scorerName: string; speedKph: number; pos: Vec3 }
  | { type: 'save'; playerId: string; playerName: string; team: Team }
  | { type: 'shot'; playerId: string; playerName: string; team: Team; aerial: boolean }
  | { type: 'overtime' }
  | { type: 'countdown'; secondsLeft: number }
  | { type: 'match_ended'; winner: Team | null };

export interface PlayerSeed {
  id: string;
  name: string;
  team: Team;
  isBot?: boolean;
  customization?: CarCustomization;
}

export const NEUTRAL_INPUT: PlayerInput = {
  throttle: 0,
  steer: 0,
  boost: false,
  handbrake: false,
  jump: false,
  pitch: 0,
  yaw: 0,
  roll: 0,
};

export function createCar(seed: PlayerSeed, slotIndex: number): CarState {
  const spawn = getKickoffSpawn(seed.team, slotIndex);
  const defaultCust =
    seed.team === 'blue' ? DEFAULT_CUSTOMIZATION_BLUE : DEFAULT_CUSTOMIZATION_ORANGE;
  return {
    id: seed.id,
    name: seed.name,
    team: seed.team,
    isBot: Boolean(seed.isBot),
    pos: { ...spawn.pos },
    vel: v3(),
    quat: quatFromYaw(spawn.yaw),
    angVel: v3(),
    boost: 33,
    onGround: true,
    groundNormal: v3(0, 1, 0),
    hasDoubleJump: true,
    airTimeSinceJump: 0,
    isFlipping: false,
    flipTimer: 0,
    flipAxis: v3(),
    supersonic: false,
    demolishedTimer: 0,
    godModeTimer: 0,
    prevJumpInput: false,
    wheelSpin: 0,
    steerAngle: 0,
    score: 0,
    goals: 0,
    shots: 0,
    saves: 0,
    demos: 0,
    customization: seed.customization ? { ...seed.customization } : { ...defaultCust },
  };
}

export function createMatchState(
  mode: MatchMode,
  arenaId: ArenaId,
  players: PlayerSeed[],
): GameStateSnapshot {
  let blueIdx = 0;
  let orangeIdx = 0;
  const cars: CarState[] = players.map((p) => {
    const idx = p.team === 'blue' ? blueIdx++ : orangeIdx++;
    return createCar(p, idx);
  });

  return {
    powerUps: { elapsed: 0, spawnCount: 0, item: null },
    tick: 0,
    phase: mode === 'freeplay' ? 'active' : 'countdown',
    phaseTimer: mode === 'freeplay' ? 0 : 3.0,
    clockSeconds: MATCH_DURATION_SECONDS,
    isOvertime: false,
    scoreBlue: 0,
    scoreOrange: 0,
    lastGoalScorer: null,
    lastGoalTeam: null,
    lastGoalSpeedKph: 0,
    winner: null,
    arenaId,
    mode,
    cars,
    ball: {
      pos: v3(0, BALL_RADIUS + 0.05, 0),
      vel: v3(),
      angVel: v3(),
      radius: BALL_RADIUS,
      lastTouchTeam: null,
      lastTouchPlayerId: null,
      lastTouchName: null,
      lastHitSpeed: 0,
    },
    boostPads: createBoostPads(),
  };
}

export function resetKickoff(state: GameStateSnapshot): void {
  let blueIdx = 0;
  let orangeIdx = 0;
  for (const car of state.cars) {
    const idx = car.team === 'blue' ? blueIdx++ : orangeIdx++;
    const spawn = getKickoffSpawn(car.team, idx);
    car.pos = { ...spawn.pos };
    car.vel = v3();
    car.quat = quatFromYaw(spawn.yaw);
    car.angVel = v3();
    car.boost = Math.max(33, car.boost);
    car.onGround = true;
    car.groundNormal = v3(0, 1, 0);
    car.hasDoubleJump = true;
    car.airTimeSinceJump = 0;
    car.isFlipping = false;
    car.flipTimer = 0;
    car.supersonic = false;
    car.demolishedTimer = 0;
    car.godModeTimer = 0;
    car.prevJumpInput = false;
  }

  state.ball.pos = v3(0, BALL_RADIUS + 0.05, 0);
  state.ball.vel = v3();
  state.ball.angVel = v3();
  state.ball.lastTouchTeam = null;
  state.ball.lastTouchPlayerId = null;
  state.ball.lastTouchName = null;
  state.ball.lastHitSpeed = 0;

  for (const pad of state.boostPads) {
    pad.active = true;
    pad.respawnTimer = 0;
  }

  state.phase = state.mode === 'freeplay' ? 'active' : 'countdown';
  state.phaseTimer = state.mode === 'freeplay' ? 0 : 3.0;
}

export function stepSimulation(
  state: GameStateSnapshot,
  inputs: Record<string, PlayerInput>,
  dt: number,
  authoritative = true,
): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const stepDt = clamp(dt, 0.001, 0.05);
  state.tick += 1;

  if (state.phase === 'ended') {
    return events;
  }

  // Countdown phase
  if (state.phase === 'countdown') {
    const prevCeil = Math.ceil(state.phaseTimer);
    state.phaseTimer = Math.max(0, state.phaseTimer - stepDt);
    const nextCeil = Math.ceil(state.phaseTimer);
    if (nextCeil !== prevCeil && nextCeil > 0) {
      events.push({ type: 'countdown', secondsLeft: nextCeil });
    }
    if (authoritative && state.phaseTimer <= 0) {
      state.phase = 'active';
      events.push({ type: 'countdown', secondsLeft: 0 });
    }
    // Allow steering wheel wiggle / boost revving? In RL you wait cleanly until GO!
    return events;
  }

  // Goal scored celebration phase (physics still continues during explosion blast!)
  if (state.phase === 'goal_scored') {
    state.phaseTimer -= stepDt;
    stepCarsOnly(state, inputs, stepDt, events);
    if (authoritative && state.phaseTimer <= 0) {
      state.phase = 'goal_replay';
      state.phaseTimer = GOAL_REPLAY_DURATION;
    }
    return events;
  }

  // Instant Goal Replay playback phase (synchronized via phaseTimer, followed by kickoff or ended)
  if (state.phase === 'goal_replay') {
    state.phaseTimer -= stepDt;
    if (authoritative && state.phaseTimer <= 0) {
      if (state.isOvertime) {
        state.phase = 'ended';
        state.winner = state.scoreBlue > state.scoreOrange ? 'blue' : 'orange';
        events.push({ type: 'match_ended', winner: state.winner });
      } else {
        resetKickoff(state);
      }
    }
    return events;
  }

  // Active match clock (host-authoritative only so guest prediction never runs a separate match clock)
  if (authoritative && state.mode !== 'freeplay') {
    if (!state.isOvertime) {
      state.clockSeconds = Math.max(0, state.clockSeconds - stepDt);
      if (state.clockSeconds <= 0) {
        // Rocket League rule: match ends on 0:00 if ball touches the ground (or immediately if grounded/decided)
        const ballOnGround = state.ball.pos.y <= BALL_RADIUS + 0.35 && state.ball.vel.y <= 0.5;
        if (ballOnGround) {
          if (state.scoreBlue === state.scoreOrange) {
            state.isOvertime = true;
            resetKickoff(state);
            events.push({ type: 'overtime' });
            return events;
          } else {
            state.phase = 'ended';
            state.winner = state.scoreBlue > state.scoreOrange ? 'blue' : 'orange';
            events.push({ type: 'match_ended', winner: state.winner });
            return events;
          }
        }
      }
    } else {
      // Overtime counts up
      state.clockSeconds += stepDt;
    }
  }

  if (authoritative) stepPowerUps(state, stepDt, events);

  // Update boost pad respawn timers
  for (const pad of state.boostPads) {
    if (!pad.active) {
      pad.respawnTimer -= stepDt;
      if (pad.respawnTimer <= 0) {
        pad.active = true;
        pad.respawnTimer = 0;
      }
    }
  }

  // Step cars
  stepCarsOnly(state, inputs, stepDt, events);

  // Car-to-Car collisions & demolitions
  resolveCarCollisions(state, events, authoritative);

  // Step ball physics
  stepBall(state, stepDt, events);

  // Car-to-Ball collisions
  resolveCarBallCollisions(state, events, authoritative);

  // Check goals (host-authoritative so guest extrapolation never flashes phantom goals)
  const scoringTeam = authoritative ? checkGoalScored(state.ball.pos, state.ball.radius) : null;
  if (scoringTeam) {
    const speedKph = Math.round(lenV3(state.ball.vel) * 3.6);
    if (state.mode === 'freeplay') {
      // Quick celebration & reset in freeplay
      state.lastGoalTeam = scoringTeam;
      state.lastGoalSpeedKph = speedKph;
      state.lastGoalScorer = state.ball.lastTouchName || 'Allenamento';
      events.push({
        type: 'goal',
        team: scoringTeam,
        scorerName: state.lastGoalScorer,
        speedKph,
        pos: { ...state.ball.pos },
      });
      state.ball.pos = v3(0, BALL_RADIUS + 0.05, 0);
      state.ball.vel = v3();
      state.ball.angVel = v3();
    } else {
      if (scoringTeam === 'blue') state.scoreBlue += 1;
      else state.scoreOrange += 1;

      const scorer =
        state.cars.find(
          (c) => c.id === state.ball.lastTouchPlayerId && c.team === scoringTeam,
        ) || null;
      if (scorer) {
        scorer.goals += 1;
        scorer.score += 100;
      }

      state.lastGoalTeam = scoringTeam;
      state.lastGoalScorer = scorer ? scorer.name : scoringTeam === 'blue' ? 'Squadra Blu' : 'Squadra Arancione';
      state.lastGoalSpeedKph = speedKph;
      state.phase = 'goal_scored';
      state.phaseTimer = GOAL_CELEBRATION_DURATION;

      // Rocket League Goal Explosion shockwave pushes all cars radially away from goal!
      const goalCenter = v3(
        0,
        2.0,
        scoringTeam === 'blue' ? ARENA_HALF_Z : -ARENA_HALF_Z,
      );
      for (const car of state.cars) {
        if (car.demolishedTimer > 0) continue;
        const delta = subV3(car.pos, goalCenter);
        const dist = Math.max(4, lenV3(delta));
        const dir = normV3({ x: delta.x, y: delta.y + 4.5, z: delta.z });
        const push = clamp(1600 / dist, 18, 52);
        car.vel = addV3(car.vel, scaleV3(dir, push));
        car.onGround = false;
      }

      events.push({
        type: 'goal',
        team: scoringTeam,
        scorerName: state.lastGoalScorer,
        speedKph,
        pos: goalCenter,
      });
    }
  }

  return events;
}

/** Replays only one car against the arena; never advances the ball, bots or match events. */
export function replayCarInput(state: GameStateSnapshot, carId: string, input: PlayerInput, dt: number): void {
  const car = state.cars.find((c) => c.id === carId);
  if (!car || dt <= 0) return;
  stepCarsOnly({ ...state, cars: [car] }, { [carId]: input }, dt, []);
}

/** Guests predict their own car and nearby ball contacts, never bots or the whole match. */
export function stepClientPrediction(
  state: GameStateSnapshot,
  carId: string,
  input: PlayerInput,
  dt: number,
  extrapolateWorld: boolean,
  extrapolateBall = extrapolateWorld,
): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const car = state.cars.find((candidate) => candidate.id === carId);
  if (!car) return events;
  stepCarsOnly({ ...state, cars: [car] }, { [carId]: input }, dt, events);
  if (extrapolateWorld) {
    for (const remote of state.cars) {
      if (remote.id !== carId && remote.demolishedTimer <= 0) remote.pos = addV3(remote.pos, scaleV3(remote.vel, dt));
    }
  }
  if (extrapolateBall) {
    stepBall(state, dt, events);
    resolveCarBallCollisions({ ...state, cars: [car] }, events, false);
  }
  return events;
}

function stepCarsOnly(
  state: GameStateSnapshot,
  inputs: Record<string, PlayerInput>,
  dt: number,
  events: SimulationEvent[],
): void {
  for (const car of state.cars) {
    car.godModeTimer = Math.max(0, (car.godModeTimer ?? 0) - dt);
    // Handle demolished respawn
    if (car.demolishedTimer > 0) {
      car.demolishedTimer -= dt;
      if (car.demolishedTimer <= 0) {
        car.demolishedTimer = 0;
        const side = car.id.charCodeAt(0) % 2 === 0 ? -1 : 1;
        const z = car.team === 'blue' ? -(ARENA_HALF_Z - 14) : ARENA_HALF_Z - 14;
        car.pos = v3(side * (ARENA_HALF_X * 0.52), CAR_RIDE_HEIGHT, z);
        car.vel = v3();
        car.quat = quatFromYaw(car.team === 'blue' ? 0 : Math.PI);
        car.angVel = v3();
        car.boost = 33;
        car.onGround = true;
        car.groundNormal = v3(0, 1, 0);
        car.supersonic = false;
      }
      continue;
    }

    const previousPosition = { ...car.pos };
    car.angVel = v3();
    const input = car.isBot
      ? computeBotInput(car, state)
      : inputs[car.id] ?? NEUTRAL_INPUT;

    const justPressedJump = input.jump && !car.prevJumpInput;
    car.prevJumpInput = input.jump;

    // Local basis vectors
    const forward = normV3(rotateVecByQuat(v3(0, 0, 1), car.quat));
    const up = normV3(rotateVecByQuat(v3(0, 1, 0), car.quat));
    const left = normV3(rotateVecByQuat(v3(1, 0, 0), car.quat));

    const forwardSpeed = dotV3(car.vel, forward);
    const lateralSpeed = dotV3(car.vel, left);
    const godMode = car.godModeTimer > 0;
    if (godMode && (input.throttle !== 0 || input.boost)) {
      car.vel = addV3(car.vel, scaleV3(forward, (input.throttle < 0 ? -1 : 1) * 32 * dt));
    }

    // Boosting (works on ground and in air!)
    const isBoosting = input.boost && car.boost > 0.2;
    if (isBoosting) {
      car.boost = Math.max(0, car.boost - (state.mode === 'freeplay' ? 12 : 30.0) * dt);
      // A smooth second surge above cruising speed makes the supersonic phase
      // distinct without an instantaneous velocity jump.
      const surge = clamp((Math.max(0, forwardSpeed) - 17) / 9.5, 0, 1);
      const boostAccel = (car.onGround ? 23 : 20) + 14 * surge * surge * (3 - 2 * surge);
      car.vel = addV3(car.vel, scaleV3(forward, boostAccel * dt));
    }

    // Ground driving & wall/ceiling adhesion
    if (car.onGround) {
      car.hasDoubleJump = true;
      car.airTimeSinceJump = 0;
      car.isFlipping = false;

      // Throttle force
      const throttle = clamp(input.throttle, -1, 1);
      if (Math.abs(throttle) > 0.02) {
        // Braking when moving opposite to throttle is snappier
        const braking = Math.sign(throttle) !== Math.sign(forwardSpeed) && Math.abs(forwardSpeed) > 1.5;
        const accel = braking ? 48.0 : throttle > 0 ? 26.0 : 20.0;
        if (Math.abs(forwardSpeed) < (godMode ? GOD_MODE_SPEED : MAX_CAR_SPEED) || braking || isBoosting) {
          car.vel = addV3(car.vel, scaleV3(forward, throttle * accel * dt));
        }
      } else {
        // Rolling coast drag
        const coastDrop = Math.min(Math.abs(forwardSpeed), 10.5 * dt) * Math.sign(forwardSpeed);
        car.vel = subV3(car.vel, scaleV3(forward, coastDrop));
      }

      // Lateral tire grip (reduced during handbrake/powerslide, sharper in God Mode!)
      const grip = input.handbrake
        ? godMode ? 4.8 : 2.6
        : godMode ? 28.0 : 14.5;
      const latDamp = clamp(grip * dt, 0, 1);
      car.vel = subV3(car.vel, scaleV3(left, lateralSpeed * latDamp));

      // Steering (speed-dependent turn rate, tighter during powerslide and God Mode)
      const steer = clamp(input.steer, -1, 1);
      car.steerAngle = lerp(car.steerAngle, steer * (godMode ? 0.56 : 0.42), clamp(16 * dt, 0, 1));
      const speedFactor = clamp(Math.abs(forwardSpeed) / (godMode ? 5.5 : 9.0), 0, 1);
      const turnDir = forwardSpeed >= -0.5 ? 1 : -1;
      const baseTurnRate = input.handbrake ? 3.4 : 2.55;
      const turnRate = godMode ? baseTurnRate * 1.65 : baseTurnRate;
      const yawDelta = steer * turnDir * turnRate * speedFactor * dt;
      if (Math.abs(yawDelta) > 1e-5) {
        const yawQ = quatFromAxisAngle(car.groundNormal, yawDelta);
        car.quat = normQuat(mulQuat(yawQ, car.quat));
      }

      // Align car up vector smoothly with surface normal (ground, ramp, wall!)
      const newUp = normV3(rotateVecByQuat(v3(0, 1, 0), car.quat));
      const alignQ = quatFromUnitVectors(newUp, car.groundNormal);
      const targetQuat = normQuat(mulQuat(alignQ, car.quat));
      car.quat = slerpQuat(car.quat, targetQuat, clamp(24 * dt, 0, 1));

      // Floor gravity vs curved ramp / vertical wall / ceiling wheel adhesion
      const isCeiling = car.groundNormal.y < -0.25;
      const isSteepWall = !isCeiling && car.groundNormal.y < 0.65;
      if (isCeiling) {
        if (isBoosting && Math.abs(forwardSpeed) > 10.0) {
          // Active boost at speed temporarily sustains inverted ceiling traction
          const adhesion = 18.0 + Math.abs(forwardSpeed) * 0.6;
          car.vel = subV3(car.vel, scaleV3(car.groundNormal, adhesion * dt));
          car.vel.y += GRAVITY * 0.6 * dt;
        } else {
          // Without active boost on the ceiling, gravity pulls the car down cleanly
          car.vel.y += GRAVITY * dt;
          if (car.vel.y < -1.2) {
            car.onGround = false;
          }
        }
      } else if (car.groundNormal.y < 0.35 && Math.abs(forwardSpeed) < 7.0) {
        // Lose wall grip if too slow on a near-vertical wall -> detach smoothly
        car.onGround = false;
        car.vel.y += GRAVITY * dt;
      } else if (isSteepWall) {
        // Strong tire downforce on curved ramps & walls (overcomes v^2/R centripetal lift)
        const adhesion = 24.0 + Math.abs(forwardSpeed) * 2.4;
        car.vel = subV3(car.vel, scaleV3(car.groundNormal, adhesion * dt));
        // Subtle gravity pull along wall so climbing slowly still feels weighty
        car.vel.y += GRAVITY * 0.4 * dt;
      } else {
        // Flat floor & gentle ramps: full gravity keeps tires planted without bouncing
        car.vel.y += GRAVITY * dt;
        car.vel = subV3(car.vel, scaleV3(car.groundNormal, 8.0 * dt));
      }

      // Jump 1 (snappy initial pop + variable hold extension for first 0.20s)
      if (justPressedJump) {
        car.onGround = false;
        car.hasDoubleJump = true;
        car.airTimeSinceJump = 0.001;
        const jumpImpulse = 8.4;
        car.vel = addV3(car.vel, scaleV3(car.groundNormal, jumpImpulse));
        car.pos = addV3(car.pos, scaleV3(car.groundNormal, 0.14));
        events.push({ type: 'jump', carId: car.id, pos: { ...car.pos } });
      }
    } else {
      // Airborne state
      car.steerAngle = lerp(car.steerAngle, 0, clamp(10 * dt, 0, 1));
      const hasUsedFirstJump = car.airTimeSinceJump > 0;
      if (hasUsedFirstJump) {
        car.airTimeSinceJump += dt;
      }

      // RL variable jump height: holding Space up to 0.20s after Jump 1 extends upward lift
      if (
        hasUsedFirstJump &&
        input.jump &&
        car.hasDoubleJump &&
        car.airTimeSinceJump < 0.21 &&
        !car.isFlipping
      ) {
        car.vel = addV3(car.vel, scaleV3(car.groundNormal, 18.5 * dt));
      }

      // RL dodge vertical hover: during the first 0.18s of a flip, gravity is heavily damped so the car glides level
      const flipElapsed = car.isFlipping ? 0.38 - car.flipTimer : 99;
      if (car.isFlipping && flipElapsed < 0.18) {
        car.vel.y += GRAVITY * 0.12 * dt;
      } else {
        car.vel.y += GRAVITY * dt;
      }

      // Second Jump or Directional Air Dodge within 1.45s after jump 1 (unlimited timer if dropped off wall/ceiling!)
      const canFlipNow = car.hasDoubleJump && (!hasUsedFirstJump || car.airTimeSinceJump < 1.45);
      if (justPressedJump && canFlipNow) {
        car.hasDoubleJump = false;
        if (!hasUsedFirstJump) car.airTimeSinceJump = 0.001;

        // Determine dodge direction from W/S (throttle/pitch) & A/D/Q/E (steer/yaw/roll)
        const forwardIntent = input.throttle !== 0 ? input.throttle : -input.pitch;
        const sideIntent =
          input.steer !== 0
            ? input.steer
            : input.yaw !== 0
              ? input.yaw
              : -input.roll;
        const dodgeMag = Math.hypot(forwardIntent, sideIntent);

        if (dodgeMag > 0.25) {
          // Execute Rocket League Directional Dodge / Flip (Straight, Sideways, or Diagonal Speed-Flip!)
          const isDiagonal = Math.abs(forwardIntent) > 0.25 && Math.abs(sideIntent) > 0.25;
          const flipDuration = 0.38;
          car.isFlipping = true;
          car.flipTimer = flipDuration;

          // Project car forward & left onto horizontal plane for clean RL dodge surge
          const wallHoriz = normV3({ x: car.groundNormal.x, y: 0, z: car.groundNormal.z }, v3(0, 0, 1));
          const horizFwd = normV3({ x: forward.x, y: 0, z: forward.z }, wallHoriz);
          const horizLeft = normV3({ x: left.x, y: 0, z: left.z }, v3(horizFwd.z, 0, -horizFwd.x));
          const dodgeDir = normV3(
            addV3(scaleV3(horizFwd, forwardIntent), scaleV3(horizLeft, sideIntent)),
          );

          // Rocket League snap: flatten vertical drop cleanly when initiating dodge
          car.vel.y = clamp(car.vel.y * 0.15, -0.6, 1.4);
          const dodgeSurge = isDiagonal ? 13.8 : 12.2;
          car.vel = addV3(car.vel, scaleV3(dodgeDir, dodgeSurge));

          // Flip rotation axis in local car space: Forward (+X), Back (-X), Left (-Z), Right (+Z), Diagonal
          car.flipAxis = normV3({
            x: forwardIntent,
            y: 0,
            z: -sideIntent,
          });
          events.push({ type: 'flip', carId: car.id, pos: { ...car.pos } });
        } else {
          // Neutral Double Jump (pure vertical pop)
          car.vel.y = Math.max(car.vel.y * 0.35, 0) + 8.8;
          events.push({ type: 'jump', carId: car.id, pos: { ...car.pos } });
        }
      }

      // Air control / Barrel Roll (Avvitamento) & Flip Spin
      if (car.isFlipping) {
        const spinDt = Math.min(dt, car.flipTimer);
        car.flipTimer = Math.max(0, car.flipTimer - dt);
        const flipDuration = 0.38;
        // Rocket League Flip Cancel: pulling opposite pitch slows pitch rotation while preserving lateral barrel roll
        const pitchCancelling =
          Math.abs(car.flipAxis.x) > 0.2 &&
          input.pitch !== 0 &&
          Math.sign(input.pitch) === Math.sign(car.flipAxis.x);
        const spinMult = pitchCancelling ? 0.32 : 1.0;
        const spinStep = ((Math.PI * 2) / flipDuration) * spinMult * spinDt;
        const flipDelta = quatFromAxisAngle(car.flipAxis, spinStep);
        car.quat = normQuat(mulQuat(car.quat, flipDelta));
        car.angVel = rotateVecByQuat(scaleV3(car.flipAxis, spinStep / dt), car.quat);

        if (Math.abs(input.roll) > 0.05) {
          car.quat = normQuat(
            mulQuat(car.quat, quatFromAxisAngle(v3(0, 0, 1), input.roll * 2.2 * dt)),
          );
        }
        if (car.flipTimer <= 0) {
          car.isFlipping = false;
        }
      } else if (
        car.pos.y > CAR_RIDE_HEIGHT + 0.55 ||
        !car.hasDoubleJump ||
        car.airTimeSinceJump > 0.14 ||
        Math.abs(input.roll) > 0.05
      ) {
        // Rocket League Aerial Control:
        // - Q/E = Directional Air Roll (Avvitamento)
        // - Holding Handbrake (X/K/Ctrl) + A/D = Free Air Roll (stile RL!)
        const airAgility = godMode ? 1.35 : 1.0;
        const pitchRate = -input.pitch * 4.2 * airAgility;
        const freeAirRoll = input.handbrake ? -input.yaw : 0;
        const activeRoll = input.roll !== 0 ? input.roll : freeAirRoll;
        const yawRate = (input.handbrake ? 0 : input.yaw * 3.8) * airAgility;
        const rollRate = activeRoll * 6.4 * airAgility;

        if (Math.abs(pitchRate) > 1e-4) {
          car.quat = mulQuat(car.quat, quatFromAxisAngle(v3(1, 0, 0), pitchRate * dt));
        }
        if (Math.abs(yawRate) > 1e-4) {
          car.quat = mulQuat(car.quat, quatFromAxisAngle(v3(0, 1, 0), yawRate * dt));
        }
        if (Math.abs(rollRate) > 1e-4) {
          car.quat = mulQuat(car.quat, quatFromAxisAngle(v3(0, 0, 1), rollRate * dt));
        }
        car.quat = normQuat(car.quat);
      } else {
        // Gentle upright stabilization when skimming low over turf/ramps without jumping
        const currentUp = normV3(rotateVecByQuat(v3(0, 1, 0), car.quat));
        const alignQ = quatFromUnitVectors(currentUp, v3(0, 1, 0));
        const uprightQ = normQuat(mulQuat(alignQ, car.quat));
        car.quat = slerpQuat(car.quat, uprightQ, clamp(10 * dt, 0, 1));
      }
    }

    // Clamp max total velocity & update supersonic flag
    const speed = lenV3(car.vel);
    const maxSpeed = godMode ? GOD_MODE_SPEED : MAX_BOOST_SPEED;
    if (speed > maxSpeed) {
      car.vel = scaleV3(car.vel, maxSpeed / speed);
    }
    // Enter at full speed, with a small exit margin to avoid flickering and
    // repeating the sonic boom when throttle or network corrections vary slightly.
    const supersonicThreshold = car.supersonic ? SUPERSONIC_THRESHOLD - 1 : SUPERSONIC_THRESHOLD;
    car.supersonic = dotV3(car.vel, forward) >= supersonicThreshold;
    car.wheelSpin += forwardSpeed * dt * 2.2;

    // Integrate position
    car.pos = addV3(car.pos, scaleV3(car.vel, dt));

    // Resolve stadium shell contact
    const hit = resolveArenaSphere(car.pos, CAR_RIDE_HEIGHT);
    if (hit.hit) {
      car.pos = addV3(car.pos, scaleV3(hit.normal, hit.penetration));
      const vn = dotV3(car.vel, hit.normal);
      if (vn < 0) {
        // Check if landing smoothly on wheels or driving onto curved ramp/wall
        const currentUp = rotateVecByQuat(v3(0, 1, 0), car.quat);
        const upDot = dotV3(currentUp, hit.normal);
        if (hit.isFloorOrRamp && upDot > 0.18) {
          // Snap smoothly onto surface without upward bounce
          car.vel = subV3(car.vel, scaleV3(hit.normal, vn));
          car.onGround = true;
          car.groundNormal = { ...hit.normal };
        } else if (hit.normal.y > 0.7 && Math.abs(vn) < 5.0) {
          // Gentle upright recovery if touching flat floor at low vertical speed
          car.vel = subV3(car.vel, scaleV3(hit.normal, vn));
          car.onGround = true;
          car.groundNormal = v3(0, 1, 0);
        } else {
          // Wall / ceiling / roof bounce (damped on ceiling so car drops cleanly)
          const bounce = hit.normal.y < -0.5 ? 1.08 : 1.22;
          car.vel = subV3(car.vel, scaleV3(hit.normal, vn * bounce));
          if (hit.normal.y > 0.7 && car.pos.y < 1.2) {
            car.onGround = true;
            car.groundNormal = v3(0, 1, 0);
          }
        }
      } else if (hit.isFloorOrRamp) {
        car.onGround = true;
        car.groundNormal = { ...hit.normal };
      }
    } else if (car.onGround) {
      // Probe below wheels (generous on floor/walls, tighter on ceiling so cars detach cleanly)
      const onCeiling = car.groundNormal.y < -0.25;
      const probeDist = onCeiling ? 0.32 : 0.75;
      const probePos = subV3(car.pos, scaleV3(car.groundNormal, probeDist));
      const probe = resolveArenaSphere(probePos, CAR_RIDE_HEIGHT);
      if (probe.hit && probe.isFloorOrRamp && !(onCeiling && dotV3(car.vel, probe.normal) > 0.6)) {
        car.groundNormal = { ...probe.normal };
        // Pull gently onto curved surface to avoid micro-hops (never pull back onto ceiling)
        if (!onCeiling && probe.penetration < 0.72) {
          const gap = Math.max(0, 0.75 - probe.penetration);
          if (gap > 0.02 && gap < 0.45) {
            car.pos = subV3(car.pos, scaleV3(probe.normal, gap * 0.5));
          }
        }
      } else {
        car.onGround = false;
      }
    }

    // Boost Pad Pickups
    for (const pad of state.boostPads) {
      if (!pad.active) continue;
      if (car.boost < 99.9 && carTouchesBoostPad(car, pad, previousPosition)) {
        car.boost = Math.min(100, car.boost + (pad.isBig ? 100 : 12));
        pad.active = false;
        pad.respawnTimer = pad.isBig ? 10.0 : 4.0;
        events.push({ type: 'boost_pickup', carId: car.id, padId: pad.id, isBig: pad.isBig });
      }
    }
  }
}

function stepBall(
  state: GameStateSnapshot,
  dt: number,
  events: SimulationEvent[],
): void {
  const magnetic = applyGodModeMagnet(state, dt);
  stepBallPhysics(state.ball, dt, events, magnetic ? GOD_MODE_BALL_SPEED : MAX_BALL_SPEED);
}

function stepBallPhysics(ball: BallState, dt: number, events: SimulationEvent[], maxSpeed = MAX_BALL_SPEED): void {

  // Gravity, air drag & natural deceleration
  ball.vel.y += GRAVITY * 0.92 * dt;
  const airDrag = Math.exp(-0.08 * dt);
  ball.vel = scaleV3(ball.vel, airDrag);
  ball.angVel = scaleV3(ball.angVel, Math.exp(-0.25 * dt));

  // Clamp max ball speed to readable Rocket League-like pace
  const speed = lenV3(ball.vel);
  if (speed > maxSpeed) {
    ball.vel = scaleV3(ball.vel, maxSpeed / speed);
  }

  // Integrate ball pos
  ball.pos = addV3(ball.pos, scaleV3(ball.vel, dt));

  // Arena surface bounce
  const hit = resolveArenaSphere(ball.pos, ball.radius);
  if (hit.hit) {
    ball.pos = addV3(ball.pos, scaleV3(hit.normal, hit.penetration));
    const vn = dotV3(ball.vel, hit.normal);
    if (vn < 0) {
      const bounceSpeed = -vn;
      // Gravity at resting contact must not produce a fresh micro-bounce every tick.
      const restingContact = hit.isFloorOrRamp && bounceSpeed < 0.8;
      const restitution = restingContact ? 0 : hit.normal.y > 0.8 ? 0.56 : 0.64;
      ball.vel = subV3(ball.vel, scaleV3(hit.normal, (1 + restitution) * vn));

      // Rolling friction + spin coupling
      const tangentVel = subV3(ball.vel, scaleV3(hit.normal, dotV3(ball.vel, hit.normal)));
      // Resistance is per second, never per contact: identical coast at 30–240 Hz.
      // Real impacts lose a small amount of tangential energy; resting rolls taper
      // exponentially all the way down instead of stopping at a speed threshold.
      const rollDrag = restingContact
        ? 1 - Math.exp(-0.18 * dt)
        : Math.min(0.06, bounceSpeed * 0.003);
      ball.vel = subV3(ball.vel, scaleV3(tangentVel, rollDrag));
      const spinAxis = crossV3(hit.normal, tangentVel);
      const rollingSpin = scaleV3(spinAxis, (1 - rollDrag) / ball.radius);
      ball.angVel = addV3(
        scaleV3(ball.angVel, Math.exp(-12 * dt)),
        scaleV3(rollingSpin, 1 - Math.exp(-12 * dt)),
      );

      if (bounceSpeed > 6.0) {
        events.push({ type: 'wall_hit', speed: bounceSpeed, pos: { ...ball.pos } });
      }
    }
  }
}

/** Uses actual ball drag, gravity and floor bounces, rather than a straight ballistic arc. */
export function predictScoringTeam(ball: BallState): Team | null {
  if (Math.abs(ball.vel.z) < 1) return null;
  const direction = Math.sign(ball.vel.z);
  const goalZ = direction * (ARENA_HALF_Z + ball.radius * 0.45);
  const travelTime = (goalZ - ball.pos.z) / ball.vel.z;
  if (travelTime < 0 || travelTime > 5) return null;
  const projectedX = ball.pos.x + ball.vel.x * travelTime;
  // Floor bounces do not change the X/Z heading. Side-wall bank shots are a new action.
  if (Math.abs(projectedX) > GOAL_HALF_X + ball.radius) return null;
  const future: BallState = { ...ball, pos: { ...ball.pos }, vel: { ...ball.vel }, angVel: { ...ball.angVel } };
  const ignored: SimulationEvent[] = [];
  const predictionSpeedLimit = Math.max(MAX_BALL_SPEED, lenV3(ball.vel));
  for (let tick = 0; tick < 300; tick++) {
    const goal = checkGoalScored(future.pos, future.radius);
    if (goal) return goal;
    if (Math.sign(future.vel.z) !== direction || Math.abs(future.vel.z) < 1) return null;
    stepBallPhysics(future, 1 / 60, ignored, predictionSpeedLimit);
    ignored.length = 0;
  }
  return null;
}

function resolveCarBallCollisions(
  state: GameStateSnapshot,
  events: SimulationEvent[],
  authoritative = true,
): void {
  const ball = state.ball;

  for (const car of state.cars) {
    if (car.demolishedTimer > 0) continue;

    const incomingBall: BallState = { ...ball, pos: { ...ball.pos }, vel: { ...ball.vel }, angVel: { ...ball.angVel } };
    if (resolveBallContact(car, ball, car.godModeTimer > 0 ? GOD_MODE_BALL_SPEED : MAX_BALL_SPEED)) {
      const hitSpeed = lenV3(ball.vel);
      const previousTouchId = ball.lastTouchPlayerId;
      ball.lastTouchTeam = car.team;
      ball.lastTouchPlayerId = car.id;
      ball.lastTouchName = car.name;
      ball.lastHitSpeed = hitSpeed;
      car.score += 2;

      const incomingGoal = authoritative ? predictScoringTeam(incomingBall) : null;
      const outgoingGoal = authoritative ? predictScoringTeam(ball) : null;
      // A lateral or upward deflection can save a shot without reversing its Z velocity.
      if (incomingGoal && incomingGoal !== car.team && outgoingGoal !== incomingGoal) {
        car.saves += 1;
        car.score += 50;
        events.push({
          type: 'save',
          playerId: car.id,
          playerName: car.name,
          team: car.team,
        });
      }

      // Count the shot at contact, including rolling/bouncing shots, with no speed cutoff.
      // Continuous dribbling contacts on the same threat do not create duplicate shots.
      if (outgoingGoal === car.team && (incomingGoal !== outgoingGoal || previousTouchId !== car.id)) {
        car.shots += 1;
        car.score += 10;
        events.push({ type: 'shot', playerId: car.id, playerName: car.name, team: car.team, aerial: car.pos.y > 4 });
      }

      events.push({
        type: 'ball_hit',
        speed: hitSpeed,
        pos: { ...ball.pos },
        playerId: car.id,
      });
    }
  }
}

function resolveCarCollisions(
  state: GameStateSnapshot,
  events: SimulationEvent[],
  authoritative = true,
): void {
  const cars = state.cars;
  const minDist = 2.35;

  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.demolishedTimer > 0) continue;

    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.demolishedTimer > 0) continue;

      const delta = subV3(b.pos, a.pos);
      const dist = lenV3(delta);
      if (dist >= minDist) continue;

      const n = dist > 1e-4 ? scaleV3(delta, 1 / dist) : v3(1, 0, 0);

      // Only a committed, nose-first supersonic impact can demolish. Side swipes,
      // reversing, glancing touches and cars travelling together remain bumps.
      if (a.team !== b.team && authoritative) {
        if (a.godModeTimer > 0 && b.godModeTimer <= 0) {
          b.demolishedTimer = 3;
          a.demos++;
          a.score += 25;
          events.push({ type: 'demo', attackerId: a.id, victimId: b.id, pos: { ...b.pos } });
          continue;
        }
        if (b.godModeTimer > 0 && a.godModeTimer <= 0) {
          a.demolishedTimer = 3;
          b.demos++;
          b.score += 25;
          events.push({ type: 'demo', attackerId: b.id, victimId: a.id, pos: { ...a.pos } });
          break;
        }
        const aIntoB = dotV3(a.vel, n);
        const bIntoA = -dotV3(b.vel, n);
        const closingSpeed = aIntoB + bIntoA;
        const aForward = rotateVecByQuat(v3(0, 0, 1), a.quat);
        const bForward = rotateVecByQuat(v3(0, 0, 1), b.quat);
        const aDemolishes = b.godModeTimer <= 0 && a.supersonic && aIntoB >= SUPERSONIC_THRESHOLD * 0.94 && dotV3(aForward, n) > 0.85 && closingSpeed > 18;
        const bDemolishes = a.godModeTimer <= 0 && b.supersonic && bIntoA >= SUPERSONIC_THRESHOLD * 0.94 && -dotV3(bForward, n) > 0.85 && closingSpeed > 18;
        if (aDemolishes) {
          b.demolishedTimer = 3.0;
          a.demos += 1;
          a.score += 25;
          events.push({ type: 'demo', attackerId: a.id, victimId: b.id, pos: { ...b.pos } });
        }
        if (bDemolishes) {
          a.demolishedTimer = 3.0;
          b.demos += 1;
          b.score += 25;
          events.push({ type: 'demo', attackerId: b.id, victimId: a.id, pos: { ...a.pos } });
        }
        if (a.demolishedTimer > 0) break;
        if (b.demolishedTimer > 0) continue;
      }

      // Standard car-car bump separation
      const overlap = minDist - dist;
      a.pos = subV3(a.pos, scaleV3(n, overlap * 0.5));
      b.pos = addV3(b.pos, scaleV3(n, overlap * 0.5));

      const relVel = subV3(b.vel, a.vel);
      const vn = dotV3(relVel, n);
      if (vn < 0) {
        const jImp = -(1 + 0.55) * vn * 0.5;
        a.vel = subV3(a.vel, scaleV3(n, jImp));
        b.vel = addV3(b.vel, scaleV3(n, jImp));
      }
    }
  }
}

/**
 * Competitive AI Bot driver for solo/bot-filled matches.
 * Calculates attack line behind the ball toward opponent goal, defends if behind play,
 * collects boost, and performs dodge flips into the ball.
 */
export function computeBotInput(car: CarState, state: GameStateSnapshot): PlayerInput {
  const ball = state.ball;
  const oppGoalZ = car.team === 'blue' ? ARENA_HALF_Z : -ARENA_HALF_Z;
  const ownGoalZ = car.team === 'blue' ? -ARENA_HALF_Z : ARENA_HALF_Z;

  // Determine whether bot is behind the ball relative to opponent goal
  const ballToOppGoal = normV3({ x: -ball.pos.x, y: 0, z: oppGoalZ - ball.pos.z });
  const carBehindBall =
    car.team === 'blue' ? car.pos.z < ball.pos.z + 1.5 : car.pos.z > ball.pos.z - 1.5;

  let targetPos: Vec3;
  if (carBehindBall) {
    // Line up slightly behind ball on the shot vector
    targetPos = subV3(ball.pos, scaleV3(ballToOppGoal, 2.2));
  } else {
    // Rotate back toward own goal post side so bot doesn't own-goal!
    const sideOffset = car.pos.x >= ball.pos.x ? 12 : -12;
    targetPos = v3(
      clamp(ball.pos.x + sideOffset, -(ARENA_HALF_X - 12), ARENA_HALF_X - 12),
      0,
      lerp(ball.pos.z, ownGoalZ, 0.45),
    );
  }

  const toTarget = subV3(targetPos, car.pos);
  const horizTarget = v3(toTarget.x, 0, toTarget.z);
  const distToTarget = lenV3(horizTarget);
  const forward = normV3(rotateVecByQuat(v3(0, 0, 1), car.quat));
  const left = normV3(rotateVecByQuat(v3(1, 0, 0), car.quat));

  const dirToTarget = normV3(horizTarget, forward);
  const fwdDot = dotV3(forward, dirToTarget);
  const leftDot = dotV3(left, dirToTarget);

  const steer = clamp(leftDot * 2.6, -1, 1);
  const handbrake = fwdDot < 0.25 && distToTarget > 6;
  const throttle = fwdDot < -0.55 && distToTarget < 10 ? -1 : 1;

  const distToBall = lenV3(subV3(ball.pos, car.pos));
  const useBoost =
    car.boost > 8 &&
    fwdDot > 0.85 &&
    ((distToTarget > 18 && car.onGround) || (carBehindBall && distToBall < 22));

  // Flip into ball when lined up close on ground!
  const shouldFlip =
    car.onGround &&
    carBehindBall &&
    distToBall < 5.8 &&
    ball.pos.y < 3.4 &&
    fwdDot > 0.88 &&
    lenV3(car.vel) > 9;

  const shouldFollowUpFlip =
    !car.onGround &&
    car.hasDoubleJump &&
    car.airTimeSinceJump > 0.08 &&
    car.airTimeSinceJump < 0.35 &&
    distToBall < 5.5;

  // Gentle air stabilization if knocked airborne
  let pitch = 0;
  let roll = 0;
  if (!car.onGround) {
    const up = rotateVecByQuat(v3(0, 1, 0), car.quat);
    roll = clamp(left.y * 1.5, -1, 1);
    pitch = clamp(-forward.y * 1.2 + (1 - up.y) * 0.2, -1, 1);
  }

  return {
    throttle,
    steer,
    boost: useBoost,
    handbrake,
    jump: shouldFlip || shouldFollowUpFlip,
    pitch,
    yaw: steer,
    roll,
  };
}

/** Skips an active goal celebration/replay straight to kickoff or match end. */
export function skipGoalReplay(state: GameStateSnapshot): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  if (state.phase !== 'goal_scored' && state.phase !== 'goal_replay') return events;
  if (state.isOvertime) {
    state.phase = 'ended';
    state.winner = state.scoreBlue > state.scoreOrange ? 'blue' : 'orange';
    events.push({ type: 'match_ended', winner: state.winner });
  } else {
    resetKickoff(state);
  }
  return events;
}
