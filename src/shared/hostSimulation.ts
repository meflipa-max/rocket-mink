import { createCar, createMatchState, NEUTRAL_INPUT, stepSimulation, type PlayerSeed } from './physics';
import type { ArenaId, MatchMode, PlayerInput } from './types';

/** Simulation owned by one room host. Transport and lifecycle are managed by the caller. */
export class HostSimulation {
  readonly state;
  private readonly inputs: Record<string, PlayerInput> = {};
  private readonly inputAge: Record<string, number> = {};
  private readonly playerIds: Set<string>;

  constructor(mode: MatchMode, arena: ArenaId, players: PlayerSeed[]) {
    this.state = createMatchState(mode, arena, players);
    this.playerIds = new Set(players.filter((player) => !player.isBot).map((player) => player.id));
  }

  addOrReplacePlayer(seed: PlayerSeed): boolean {
    if (this.playerIds.has(seed.id)) return true;
    const botSlot =
      this.state.cars.find((car) => car.isBot && car.team === seed.team) ||
      this.state.cars.find((car) => car.isBot);
    if (botSlot) {
      botSlot.id = seed.id;
      botSlot.name = seed.name;
      botSlot.team = seed.team;
      botSlot.isBot = false;
      if (seed.customization) {
        botSlot.customization = { ...seed.customization };
      }
      this.playerIds.add(seed.id);
      this.inputs[seed.id] = { ...NEUTRAL_INPUT };
      this.inputAge[seed.id] = 0;
      return true;
    }

    const slotIdx = this.state.cars.filter((car) => car.team === seed.team).length;
    const car = createCar({ ...seed, isBot: false }, slotIdx);
    this.state.cars.push(car);
    this.playerIds.add(seed.id);
    this.inputs[seed.id] = { ...NEUTRAL_INPUT };
    this.inputAge[seed.id] = 0;
    return true;
  }

  demoteToBot(id: string) {
    this.playerIds.delete(id);
    this.inputs[id] = { ...NEUTRAL_INPUT };
    delete this.inputAge[id];
    const car = this.state.cars.find((c) => c.id === id);
    if (car) {
      car.isBot = true;
      if (!car.name.endsWith('[BOT]')) {
        car.name = `${car.name} [BOT]`;
      }
    }
  }

  setInput(id: string, input: PlayerInput) {
    if (!this.playerIds.has(id) || !input || typeof input !== 'object') return;
    const axis = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
      ? Math.max(-1, Math.min(1, value)) : 0;
    this.inputs[id] = {
      throttle: axis(input.throttle), steer: axis(input.steer), pitch: axis(input.pitch),
      yaw: axis(input.yaw), roll: axis(input.roll), boost: input.boost === true,
      handbrake: input.handbrake === true, jump: input.jump === true,
    };
    this.inputAge[id] = 0;
  }

  removeInput(id: string) {
    this.inputs[id] = { ...NEUTRAL_INPUT };
    delete this.inputAge[id];
  }

  step(dt: number) {
    const stepDt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.05));
    for (const id of this.playerIds) {
      if (this.inputs[id]) {
        const nextAge = (this.inputAge[id] ?? 0) + stepDt;
        this.inputAge[id] = nextAge;
        if (nextAge > 1.25) {
          this.inputs[id] = { ...NEUTRAL_INPUT };
        }
      }
    }
    return stepSimulation(this.state, this.inputs, stepDt);
  }
}
