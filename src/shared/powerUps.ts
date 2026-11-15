import { carTouchesBoostPad } from './boostPickup';
import { v3 } from './math3d';
import type { GameStateSnapshot } from './types';
import type { SimulationEvent } from './physics';

export const GOD_MODE_DURATION = 6;
export const GOD_MODE_SPEED = 40;
export const GOD_MODE_SPAWN_TIMES = [10, 120, 240] as const;

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
