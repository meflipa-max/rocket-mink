export type Team = 'blue' | 'orange';

export type MatchMode = '1v1' | '2v2' | '3v3' | 'freeplay';

export type ArenaId = 'dfh_night' | 'neo_tokyo' | 'mannfield_day';

export type CarBodyStyle = 'octane' | 'dominus';

export type DecalStyle = 'stripes' | 'flames' | 'clean';

export type WheelStyle = 'sport' | 'aero';

export interface CarCustomization {
  body: CarBodyStyle;
  primaryColor: string;
  accentColor: string;
  boostColor: string;
  decal: DecalStyle;
  wheelStyle: WheelStyle;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PlayerInput {
  throttle: number; // -1 to 1
  steer: number; // -1 to 1 (left = +1 or -1? Let's define: +1 = left, -1 = right or vice versa; we'll be explicit in physics)
  boost: boolean;
  handbrake: boolean;
  jump: boolean;
  pitch: number; // -1 (nose down) to 1 (nose up)
  yaw: number; // -1 (right) to 1 (left)
  roll: number; // -1 (roll left) to 1 (roll right)
}

export interface CarState {
  id: string;
  name: string;
  team: Team;
  isBot: boolean;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: Vec3;
  boost: number; // 0..100
  onGround: boolean;
  groundNormal: Vec3;
  hasDoubleJump: boolean;
  airTimeSinceJump: number;
  isFlipping: boolean;
  flipTimer: number;
  flipAxis: Vec3;
  supersonic: boolean;
  demolishedTimer: number;
  prevJumpInput: boolean;
  wheelSpin: number;
  steerAngle: number;
  score: number;
  goals: number;
  shots: number;
  saves: number;
  demos: number;
  customization: CarCustomization;
}

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  angVel: Vec3;
  radius: number;
  lastTouchTeam: Team | null;
  lastTouchPlayerId: string | null;
  lastTouchName: string | null;
  lastHitSpeed: number;
}

export interface BoostPadState {
  id: number;
  pos: Vec3;
  isBig: boolean;
  active: boolean;
  respawnTimer: number;
}

export type MatchPhase =
  | 'waiting'
  | 'countdown'
  | 'active'
  | 'goal_scored'
  | 'ended';

export interface GameStateSnapshot {
  tick: number;
  phase: MatchPhase;
  phaseTimer: number;
  clockSeconds: number;
  isOvertime: boolean;
  scoreBlue: number;
  scoreOrange: number;
  lastGoalScorer: string | null;
  lastGoalTeam: Team | null;
  lastGoalSpeedKph: number;
  winner: Team | null;
  arenaId: ArenaId;
  mode: MatchMode;
  cars: CarState[];
  ball: BallState;
  boostPads: BoostPadState[];
}

export interface LobbyPlayer {
  id: string;
  name: string;
  team: Team;
  ready: boolean;
  isHost: boolean;
  customization: CarCustomization;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: MatchMode;
  arenaId: ArenaId;
  playerCount: number;
  maxPlayers: number;
  inProgress: boolean;
  fillBots: boolean;
}

export interface RoomDetail extends RoomSummary {
  hostId: string;
  players: LobbyPlayer[];
}

export interface QuickChatEvent {
  id: string;
  playerName: string;
  team: Team;
  text: string;
  timestamp: number;
}

export interface GameEventNotification {
  id: string;
  kind: 'goal' | 'save' | 'demo' | 'shot' | 'overtime';
  title: string;
  subtitle: string;
  team?: Team;
}

export const DEFAULT_CUSTOMIZATION_BLUE: CarCustomization = {
  body: 'octane',
  primaryColor: '#1d4ed8',
  accentColor: '#38bdf8',
  boostColor: '#38bdf8',
  decal: 'stripes',
  wheelStyle: 'sport',
};

export const DEFAULT_CUSTOMIZATION_ORANGE: CarCustomization = {
  body: 'octane',
  primaryColor: '#ea580c',
  accentColor: '#fbbf24',
  boostColor: '#f97316',
  decal: 'flames',
  wheelStyle: 'sport',
};
