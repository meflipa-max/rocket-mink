import { createMatchState, NEUTRAL_INPUT, stepSimulation, type PlayerSeed } from './physics';
import type { ArenaId, MatchMode, PlayerInput } from './types';

/** Simulation owned by one room host. Transport and lifecycle are managed by the caller. */
export class HostSimulation {
  readonly state;
  private readonly inputs: Record<string, PlayerInput> = {};
  private readonly playerIds: Set<string>;

  constructor(mode: MatchMode, arena: ArenaId, players: PlayerSeed[]) {
    this.state = createMatchState(mode, arena, players);
    this.playerIds = new Set(players.filter((player) => !player.isBot).map((player) => player.id));
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
  }

  removeInput(id: string) {
    this.inputs[id] = { ...NEUTRAL_INPUT };
  }

  step(dt: number) {
    return stepSimulation(this.state, this.inputs, Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.05)));
  }
}
