import {
  ARENA_HALF_X,
  ARENA_HALF_Z,
  BALL_RADIUS,
  CAR_HALF_EXTENTS,
  CAR_RIDE_HEIGHT,
  GOAL_HALF_X,
  GOAL_HEIGHT,
  checkGoalScored,
  createBoostPads,
  getKickoffSpawn,
  resolveArenaSphere,
} from './arena';
import {
  addV3,
  clamp,
  crossV3,
  dotV3,
  lenSqV3,
  lenV3,
  lerp,
  mulQuat,
  normQuat,
  normV3,
  quatFromAxisAngle,
  quatFromUnitVectors,
  quatFromYaw,
  rotateVecByInvQuat,
  rotateVecByQuat,
  scaleV3,
  slerpQuat,
  subV3,
  v3,
} from './math3d';
import type {
  ArenaId,
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
export const MATCH_DURATION_SECONDS = 300; // 5:00 standard match

export type SimulationEvent =
  | { type: 'ball_hit'; speed: number; pos: Vec3; playerId: string | null }
  | { type: 'wall_hit'; speed: number; pos: Vec3 }
  | { type: 'jump'; carId: string; pos: Vec3 }
  | { type: 'flip'; carId: string; pos: Vec3 }
  | { type: 'boost_pickup'; carId: string; padId: number; isBig: boolean }
  | { type: 'demo'; attackerId: string; victimId: string; pos: Vec3 }
  | { type: 'goal'; team: Team; scorerName: string; speedKph: number; pos: Vec3 }
  | { type: 'save'; playerId: string; playerName: string; team: Team }
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
    if (state.phaseTimer <= 0) {
      state.phase = 'active';
      events.push({ type: 'countdown', secondsLeft: 0 });
    }
    // Allow steering wheel wiggle / boost revving? In RL you wait cleanly until GO!
    return events;
  }

  // Goal scored celebration phase (physics still continues in slow-ish explosion!)
  if (state.phase === 'goal_scored') {
    state.phaseTimer -= stepDt;
    stepCarsOnly(state, inputs, stepDt, events);
    if (state.phaseTimer <= 0) {
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

  // Active match clock
  if (state.mode !== 'freeplay') {
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
  resolveCarCollisions(state, events);

  // Step ball physics
  stepBall(state, stepDt, events);

  // Car-to-Ball collisions
  resolveCarBallCollisions(state, events);

  // Check goals
  const scoringTeam = checkGoalScored(state.ball.pos, state.ball.radius);
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
      state.phaseTimer = 3.2;

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

function stepCarsOnly(
  state: GameStateSnapshot,
  inputs: Record<string, PlayerInput>,
  dt: number,
  events: SimulationEvent[],
): void {
  for (const car of state.cars) {
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

    // Boosting (works on ground and in air!)
    const isBoosting = input.boost && car.boost > 0.2;
    if (isBoosting) {
      car.boost = Math.max(0, car.boost - (state.mode === 'freeplay' ? 12 : 30.0) * dt);
      const boostAccel = car.onGround ? 28.0 : 23.0;
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
        if (Math.abs(forwardSpeed) < MAX_CAR_SPEED || braking || isBoosting) {
          car.vel = addV3(car.vel, scaleV3(forward, throttle * accel * dt));
        }
      } else {
        // Rolling coast drag
        const coastDrop = Math.min(Math.abs(forwardSpeed), 10.5 * dt) * Math.sign(forwardSpeed);
        car.vel = subV3(car.vel, scaleV3(forward, coastDrop));
      }

      // Lateral tire grip (reduced during handbrake/powerslide for authentic drifts!)
      const grip = input.handbrake ? 2.6 : 14.5;
      const latDamp = clamp(grip * dt, 0, 1);
      car.vel = subV3(car.vel, scaleV3(left, lateralSpeed * latDamp));

      // Steering (speed-dependent turn rate, tighter during powerslide)
      const steer = clamp(input.steer, -1, 1);
      car.steerAngle = lerp(car.steerAngle, steer * 0.42, clamp(16 * dt, 0, 1));
      const speedFactor = clamp(Math.abs(forwardSpeed) / 9.0, 0, 1);
      const turnDir = forwardSpeed >= -0.5 ? 1 : -1;
      const turnRate = input.handbrake ? 3.4 : 2.55;
      const yawDelta = steer * turnDir * turnRate * speedFactor * dt;
      if (Math.abs(yawDelta) > 1e-5) {
        const yawQ = quatFromAxisAngle(car.groundNormal, yawDelta);
        car.quat = normQuat(mulQuat(yawQ, car.quat));
      }

      // Align car up vector smoothly with surface normal (ground, ramp, wall, ceiling!)
      const newUp = normV3(rotateVecByQuat(v3(0, 1, 0), car.quat));
      const alignQ = quatFromUnitVectors(newUp, car.groundNormal);
      const targetQuat = normQuat(mulQuat(alignQ, car.quat));
      car.quat = slerpQuat(car.quat, targetQuat, clamp(22 * dt, 0, 1));

      // Wall/Ceiling gravity vs adhesive tire force
      const isVerticalOrCeiling = car.groundNormal.y < 0.55;
      if (isVerticalOrCeiling && Math.abs(forwardSpeed) < 11.0) {
        // Lose wall grip if too slow -> fall off wall!
        car.onGround = false;
        car.vel.y += GRAVITY * dt;
      } else {
        // Gentle adhesive force toward surface normal + slight gravity on floor
        car.vel = subV3(car.vel, scaleV3(car.groundNormal, 6.0 * dt));
      }

      // Jump 1
      if (justPressedJump) {
        car.onGround = false;
        car.hasDoubleJump = true;
        car.airTimeSinceJump = 0;
        const jumpImpulse = 10.6;
        car.vel = addV3(car.vel, scaleV3(car.groundNormal, jumpImpulse));
        car.pos = addV3(car.pos, scaleV3(car.groundNormal, 0.12));
        events.push({ type: 'jump', carId: car.id, pos: { ...car.pos } });
      }
    } else {
      // Airborne state
      car.steerAngle = lerp(car.steerAngle, 0, clamp(10 * dt, 0, 1));
      car.airTimeSinceJump += dt;
      car.vel.y += GRAVITY * dt;

      // Second Jump or Directional Air Dodge (Flip) within 1.35s window
      if (justPressedJump && car.hasDoubleJump && car.airTimeSinceJump < 1.35) {
        car.hasDoubleJump = false;

        // Determine dodge direction from pitch (W/S) & steer/yaw (A/D)
        // Forward in Rocket League: pressing W (throttle > 0 or pitch < 0) flips forward!
        const forwardIntent = input.throttle !== 0 ? input.throttle : -input.pitch;
        const sideIntent = input.steer !== 0 ? input.steer : input.yaw;
        const dodgeMag = Math.hypot(forwardIntent, sideIntent);

        if (dodgeMag > 0.25) {
          // Execute Directional Dodge / Flip!
          car.isFlipping = true;
          car.flipTimer = 0.52;

          // Project car forward & left onto horizontal plane for clean RL dodge surge
          const horizFwd = normV3({ x: forward.x, y: 0, z: forward.z }, v3(0, 0, 1));
          const horizLeft = normV3({ x: left.x, y: 0, z: left.z }, v3(1, 0, 0));
          const dodgeDir = normV3(
            addV3(scaleV3(horizFwd, forwardIntent), scaleV3(horizLeft, sideIntent)),
          );

          // Cancel downward momentum for classic snappy RL flip!
          if (car.vel.y < 0) car.vel.y *= 0.25;
          car.vel.y += 2.6;
          car.vel = addV3(car.vel, scaleV3(dodgeDir, 13.2));

          // Flip rotation axis in local car space:
          // Forward flip rotates around local +X; Left flip rotates around local -Z
          car.flipAxis = normV3({
            x: forwardIntent,
            y: 0,
            z: -sideIntent,
          });
          events.push({ type: 'flip', carId: car.id, pos: { ...car.pos } });
        } else {
          // Neutral Double Jump
          car.vel.y = Math.max(car.vel.y, 0) + 9.2;
          events.push({ type: 'jump', carId: car.id, pos: { ...car.pos } });
        }
      }

      // Air control / Dodge spin
      if (car.isFlipping) {
        car.flipTimer -= dt;
        const spinStep = (Math.PI * 2 / 0.52) * dt;
        const flipDelta = quatFromAxisAngle(car.flipAxis, spinStep);
        car.quat = normQuat(mulQuat(car.quat, flipDelta));
        if (car.flipTimer <= 0) {
          car.isFlipping = false;
        }
      } else {
        // Manual 3D aerial pitch, yaw, roll
        const pitchRate = -input.pitch * 3.2; // Nose down on W (pitch = -1 -> +angle around +X), nose up on S
        const yawRate = input.yaw * 3.0;
        const rollRate = input.roll * 4.2;

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
      }
    }

    // Clamp max total velocity & update supersonic flag
    const speed = lenV3(car.vel);
    if (speed > MAX_BOOST_SPEED) {
      car.vel = scaleV3(car.vel, MAX_BOOST_SPEED / speed);
    }
    car.supersonic = speed >= SUPERSONIC_THRESHOLD;
    car.wheelSpin += forwardSpeed * dt * 2.2;

    // Integrate position
    car.pos = addV3(car.pos, scaleV3(car.vel, dt));

    // Resolve stadium shell contact
    const hit = resolveArenaSphere(car.pos, CAR_RIDE_HEIGHT);
    if (hit.hit) {
      car.pos = addV3(car.pos, scaleV3(hit.normal, hit.penetration));
      const vn = dotV3(car.vel, hit.normal);
      if (vn < 0) {
        // Check if landing smoothly on wheels or scraping wall
        const currentUp = rotateVecByQuat(v3(0, 1, 0), car.quat);
        const upDot = dotV3(currentUp, hit.normal);
        if (hit.isFloorOrRamp && upDot > 0.35) {
          // Snap onto surface
          car.vel = subV3(car.vel, scaleV3(hit.normal, vn * 1.05));
          car.onGround = true;
          car.groundNormal = { ...hit.normal };
        } else {
          // Bounce off wall / roof landing
          car.vel = subV3(car.vel, scaleV3(hit.normal, vn * 1.28));
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
      // Probe slightly below wheels to see if car drove off a ramp or wall edge
      const probePos = subV3(car.pos, scaleV3(car.groundNormal, 0.25));
      const probe = resolveArenaSphere(probePos, CAR_RIDE_HEIGHT);
      if (probe.hit && probe.isFloorOrRamp) {
        car.groundNormal = { ...probe.normal };
      } else {
        car.onGround = false;
      }
    }

    // Boost Pad Pickups
    for (const pad of state.boostPads) {
      if (!pad.active) continue;
      const pickupRadius = pad.isBig ? 2.4 : 1.7;
      const dx = car.pos.x - pad.pos.x;
      const dy = car.pos.y - pad.pos.y;
      const dz = car.pos.z - pad.pos.z;
      if (dx * dx + dy * dy + dz * dz < pickupRadius * pickupRadius && car.boost < 99.9) {
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
  const ball = state.ball;

  // Gravity & air drag
  ball.vel.y += GRAVITY * dt;
  const airDrag = 1 - 0.03 * dt;
  ball.vel = scaleV3(ball.vel, airDrag);
  ball.angVel = scaleV3(ball.angVel, 1 - 0.15 * dt);

  // Clamp max ball speed
  const speed = lenV3(ball.vel);
  if (speed > 62) {
    ball.vel = scaleV3(ball.vel, 62 / speed);
  }

  // Integrate ball pos
  ball.pos = addV3(ball.pos, scaleV3(ball.vel, dt));

  // Arena surface bounce
  const hit = resolveArenaSphere(ball.pos, ball.radius);
  if (hit.hit) {
    ball.pos = addV3(ball.pos, scaleV3(hit.normal, hit.penetration));
    const vn = dotV3(ball.vel, hit.normal);
    if (vn < 0) {
      const restitution = hit.normal.y > 0.8 ? 0.62 : 0.72;
      const bounceSpeed = -vn;
      ball.vel = subV3(ball.vel, scaleV3(hit.normal, (1 + restitution) * vn));

      // Rolling friction + spin coupling
      const tangentVel = subV3(ball.vel, scaleV3(hit.normal, dotV3(ball.vel, hit.normal)));
      ball.vel = subV3(ball.vel, scaleV3(tangentVel, 0.04));
      const spinAxis = crossV3(hit.normal, tangentVel);
      ball.angVel = scaleV3(spinAxis, 1 / ball.radius);

      if (bounceSpeed > 6.0) {
        events.push({ type: 'wall_hit', speed: bounceSpeed, pos: { ...ball.pos } });
      }
    }
  }
}

function resolveCarBallCollisions(
  state: GameStateSnapshot,
  events: SimulationEvent[],
): void {
  const ball = state.ball;

  for (const car of state.cars) {
    if (car.demolishedTimer > 0) continue;

    // Transform ball center into car's local OBB space
    const rel = subV3(ball.pos, car.pos);
    const localBall = rotateVecByInvQuat(rel, car.quat);

    // Closest point on car chassis OBB
    const closestLocal: Vec3 = {
      x: clamp(localBall.x, -CAR_HALF_EXTENTS.x, CAR_HALF_EXTENTS.x),
      y: clamp(localBall.y, -CAR_HALF_EXTENTS.y, CAR_HALF_EXTENTS.y),
      z: clamp(localBall.z, -CAR_HALF_EXTENTS.z, CAR_HALF_EXTENTS.z),
    };

    const diffLocal = subV3(localBall, closestLocal);
    const distSq = lenSqV3(diffLocal);
    if (distSq >= ball.radius * ball.radius) continue;

    const dist = Math.sqrt(distSq);
    const localNormal =
      dist > 1e-5
        ? scaleV3(diffLocal, 1 / dist)
        : normV3(localBall, v3(0, 1, 0));
    const worldNormal = normV3(rotateVecByQuat(localNormal, car.quat));
    const penetration = ball.radius - dist;

    // Separate ball out of car
    ball.pos = addV3(ball.pos, scaleV3(worldNormal, penetration + 0.02));

    // Relative velocity along contact normal
    const relVel = subV3(ball.vel, car.vel);
    const vn = dotV3(relVel, worldNormal);

    if (vn < 0) {
      const carSpeed = lenV3(car.vel);
      const powerBoost = car.isFlipping ? 1.38 : 1.12;
      const restitution = 0.72;
      const impulseMag = -(1 + restitution) * vn * powerBoost;

      ball.vel = addV3(ball.vel, scaleV3(worldNormal, impulseMag));
      // Add forward car momentum + natural Rocket League upward pop
      ball.vel = addV3(ball.vel, scaleV3(car.vel, 0.25));
      if (worldNormal.y > -0.2 && carSpeed > 6) {
        ball.vel.y += clamp(carSpeed * 0.14, 1.5, 5.2);
      }

      // Spin impulse from tangential hit
      const contactTangent = subV3(relVel, scaleV3(worldNormal, vn));
      ball.angVel = addV3(ball.angVel, scaleV3(crossV3(worldNormal, contactTangent), 0.22));

      // Mild recoil on car
      car.vel = subV3(car.vel, scaleV3(worldNormal, impulseMag * 0.12));

      const hitSpeed = lenV3(ball.vel);
      ball.lastTouchTeam = car.team;
      ball.lastTouchPlayerId = car.id;
      ball.lastTouchName = car.name;
      ball.lastHitSpeed = hitSpeed;
      car.score += 2;

      // Detect Save (clearing ball away from own goal when ball was fast toward goal)
      const ownGoalZ = car.team === 'blue' ? -ARENA_HALF_Z : ARENA_HALF_Z;
      const nearOwnGoal =
        Math.abs(ball.pos.z - ownGoalZ) < 16 && Math.abs(ball.pos.x) < GOAL_HALF_X + 5;
      if (nearOwnGoal && Math.sign(ball.vel.z) !== Math.sign(ownGoalZ)) {
        car.saves += 1;
        car.score += 50;
        events.push({
          type: 'save',
          playerId: car.id,
          playerName: car.name,
          team: car.team,
        });
      }

      // Detect Shot on target
      const targetGoalZ = car.team === 'blue' ? ARENA_HALF_Z : -ARENA_HALF_Z;
      const towardTarget = Math.sign(ball.vel.z) === Math.sign(targetGoalZ);
      if (towardTarget && hitSpeed > 18 && Math.abs(ball.pos.x) < GOAL_HALF_X + 12) {
        car.shots += 1;
        car.score += 10;
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

      // Check Rocket League Supersonic Demolition!
      if (a.team !== b.team) {
        const aIntoB = dotV3(a.vel, n);
        const bIntoA = -dotV3(b.vel, n);
        if (a.supersonic && aIntoB > 20 && aIntoB > bIntoA + 5) {
          b.demolishedTimer = 3.0;
          a.demos += 1;
          a.score += 25;
          events.push({ type: 'demo', attackerId: a.id, victimId: b.id, pos: { ...b.pos } });
          continue;
        }
        if (b.supersonic && bIntoA > 20 && bIntoA > aIntoB + 5) {
          a.demolishedTimer = 3.0;
          b.demos += 1;
          b.score += 25;
          events.push({ type: 'demo', attackerId: b.id, victimId: a.id, pos: { ...a.pos } });
          continue;
        }
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
