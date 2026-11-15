import { carTouchesBoostPad } from './boostPickup';
import { BALL_RADIUS, CAR_RIDE_HEIGHT, resolveArenaSphere } from './arena';
import { addV3, dotV3, lenV3, normV3, rotateVecByQuat, scaleV3, subV3, v3 } from './math3d';
import type { GameStateSnapshot } from './types';
import type { SimulationEvent } from './physics';

export const GOD_MODE_DURATION = 12;
export const GOD_MODE_SPEED = 40;
export const GOD_MODE_BALL_SPEED = GOD_MODE_SPEED + 3;
export const GOD_MODE_SPAWN_TIMES = [10, 120, 240] as const;

/** A finite spring in front of the nearest powered car; never teleports or attracts across the field. */
export function applyGodModeMagnet(state: GameStateSnapshot, dt: number): boolean {
  let owner = null as GameStateSnapshot['cars'][number] | null;
  let nearest = 15.0;
  for (const car of state.cars) {
    if (car.godModeTimer <= 0 || car.demolishedTimer > 0) continue;
    const toBall = subV3(state.ball.pos, car.pos);
    const distance = lenV3(toBall);
    const forward = rotateVecByQuat(v3(0, 0, 1), car.quat);
    if (distance < nearest && (distance < 6.0 || dotV3(normV3(toBall, forward), forward) > 0.0)) {
      owner = car;
      nearest = distance;
    }
  }
  if (!owner) return false;
  const forward = rotateVecByQuat(v3(0, 0, 1), owner.quat);
  const up = owner.onGround ? owner.groundNormal : v3(0, 1, 0);
  let target = addV3(addV3(owner.pos, scaleV3(forward, 3.3)), scaleV3(up, BALL_RADIUS - CAR_RIDE_HEIGHT + 0.08));
  for (let i = 0; i < 3; i++) {
    const hit = resolveArenaSphere(target, state.ball.radius);
    if (!hit.hit) break;
    target = addV3(target, scaleV3(hit.normal, hit.penetration + 0.01));
  }
  const closeCapture = nearest < 5.5;
  const posGain = closeCapture ? 24 : 18;
  const velGain = closeCapture ? 11 : 8;
  const maxAccel = closeCapture ? 190 : 145;
  const spring = addV3(scaleV3(subV3(target, state.ball.pos), posGain), scaleV3(subV3(owner.vel, state.ball.vel), velGain));
  const acceleration = scaleV3(spring, Math.min(1, maxAccel / Math.max(1e-8, lenV3(spring))));
  state.ball.vel = addV3(state.ball.vel, scaleV3(acceleration, Math.max(0, Math.min(dt, 0.05))));
  if (nearest < 6.0) {
    state.ball.lastTouchTeam = owner.team;
    state.ball.lastTouchPlayerId = owner.id;
    state.ball.lastTouchName = owner.name;
  }
  return true;
}

/** Host-owned schedule: three appearances across active match time, never during replays. */
export function stepPowerUps(state: GameStateSnapshot, dt: number, events: SimulationEvent[]) {
  const powerUps = state.powerUps;
  powerUps.elapsed += dt;
  if (powerUps.item) {
    powerUps.item.lifetime -= dt;
    if (powerUps.item.lifetime <= 0) powerUps.item = null;
  }
  if (powerUps.spawnCount < GOD_MODE_SPAWN_TIMES.length && powerUps.elapsed + 1e-7 >= GOD_MODE_SPAWN_TIMES[powerUps.spawnCount]) {
    const id = powerUps.spawnCount++;
    powerUps.item = { id, pos: v3([-18, 18, 0][id], 1.8, [0, 0, 24][id]), lifetime: 20 };
    events.push({ type: 'god_mode_spawn', pos: { ...powerUps.item.pos } });
  }
  const item = powerUps.item;
  if (!item) return;
  for (const car of state.cars) {
    if (car.demolishedTimer > 0) continue;
    if (!carTouchesBoostPad(car, { id: item.id, pos: item.pos, isBig: true, active: true, respawnTimer: 0 })) continue;
    car.godModeTimer = GOD_MODE_DURATION;
    powerUps.item = null;
    events.push({ type: 'god_mode_pickup', carId: car.id, playerName: car.name, team: car.team, pos: { ...car.pos } });
    break;
  }
}
