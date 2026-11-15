import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARENA_HALF_X, ARENA_HALF_Z, ARENA_HEIGHT, CAR_RIDE_HEIGHT, GOAL_HEIGHT } from '../shared/arena';
import { clamp, lerp } from '../shared/math3d';
import { ClientPrediction } from '../shared/clientPrediction';
import { buildFollowCamera, constrainCamera, smoothCameraUp } from '../shared/cameraRig';
import { NEUTRAL_INPUT, skipGoalReplay, stepSimulation, type SimulationEvent } from '../shared/physics';
import {
  GOAL_REPLAY_DURATION,
  GoalReplayRecorder,
  sampleReplayFrame,
  replayTimelineProgress,
  type ReplayClip,
} from '../shared/replay';
import type {
  ArenaId,
  CarCustomization,
  CarState,
  GameStateSnapshot,
  PlayerInput,
  Team,
} from '../shared/types';
import { DEFAULT_CUSTOMIZATION_BLUE, DEFAULT_CUSTOMIZATION_ORANGE } from '../shared/types';
import { buildCarVisualRig, type CarVisualRig } from './carMesh';
import { ParticlePool } from './particles';
import { soundEngine } from './sound';
import { buildSoccerBallMesh, buildStadium, type StadiumRig } from './stadium';
import { animateGodModeCar, createGodModeItemVisual } from './godModeVisual';
import { BODY_GEOMETRY_SPECS } from '../shared/customization';
import {
  computeExhaustPlumeTint,
  getBoostEffectSpec,
  sampleBoostParticleColor,
} from '../shared/boostEffects';

export type ViewportMode = 'title' | 'garage' | 'playing' | 'paused' | 'gameover';

export interface HudTelemetry {
  fps?: number;
  network?: { transport: 'host' | 'p2p' | 'relay'; rttMs: number | null };
  godModeSeconds: number;
  godModeItemMarker?: { x: number; y: number; distance: number; offscreen: boolean; angle: number } | null;
  boost: number;
  speedKph: number;
  supersonic: boolean;
  onWall: boolean;
  ballCam: boolean;
  scoreBlue: number;
  scoreOrange: number;
  clockSeconds: number;
  isOvertime: boolean;
  phase: GameStateSnapshot['phase'];
  phaseTimer: number;
  lastGoalScorer: string | null;
  lastGoalTeam: GameStateSnapshot['lastGoalTeam'];
  lastGoalSpeedKph: number;
  winner: GameStateSnapshot['winner'];
}

export interface NameplateProjection {
  id: string;
  name: string;
  team: 'blue' | 'orange';
  x: number;
  y: number;
  visible: boolean;
}

export interface GoalMarkerProjection {
  team: Team;
  x: number;
  y: number;
  inFront: boolean;
  visible: boolean;
  side: 'left' | 'right' | 'center';
}

// Pre-allocated math helpers (Zero GC inside render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qIdentity = new THREE.Quaternion();
const _proj = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class GameViewportController {
  public readonly isSoftwareGl: boolean;
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private stadium: StadiumRig;
  private ballRig: ReturnType<typeof buildSoccerBallMesh>;
  private particles: ParticlePool;
  private godModeItem = createGodModeItemVisual();
  private carRigs = new Map<string, CarVisualRig>();
  private garageRig: CarVisualRig | null = null;
  private garageCustomization: CarCustomization = { ...DEFAULT_CUSTOMIZATION_BLUE };
  private garageOrbit = 0.72;
  private garageTargetOrbit: number | null = null;
  private garageZoom = 5.4;
  private garageDragX: number | null = null;
  private boomSprites: Array<{ sprite: THREE.Sprite; age: number }> = [];
  private replaySampleTime: number | null = null;

  private mode: ViewportMode = 'title';
  private localPlayerId = 'local-player';
  private isMultiplayer = false;
  private isLocalHost = false;
  private ballCam = true;
  private paused = false;

  private activeState: GameStateSnapshot | null = null;
  private targetNetState: GameStateSnapshot | null = null;
  private displayCars = new Map<
    string,
    { pos: THREE.Vector3; quat: THREE.Quaternion; wheelSpin: number; steerAngle: number }
  >();
  private displayBallPos = new THREE.Vector3(0, 1.7, 0);

  private keys = new Set<string>();
  private mouseBoost = false;
  private mouseJump = false;
  private prediction = new ClientPrediction();
  private prevInput: PlayerInput = { ...NEUTRAL_INPUT };
  private localInputSeq = 0;
  private localVisualPosOffset = new THREE.Vector3();
  private localVisualQuatOffset = new THREE.Quaternion();
  private cameraPos = new THREE.Vector3(0, 16, -42);
  private cameraLook = new THREE.Vector3(0, 2, 0);
  private trauma = 0;
  private elapsed = 0;
  private lastTimeMs = performance.now();
  private frameId = 0;
  private disposed = false;

  // Callbacks
  public onHudUpdate?: (hud: HudTelemetry) => void;
  public onEvents?: (events: SimulationEvent[]) => void;
  public onSendInput?: (input: PlayerInput, time: number, seq: number) => boolean | void;
  public onBallCamChange?: (enabled: boolean) => void;
  public onNameplates?: (plates: NameplateProjection[]) => void;
  public onGoalMarkers?: (markers: GoalMarkerProjection[]) => void;
  public onPauseToggle?: () => void;
  public onQuickChatKey?: (slot: number) => void;
  public onSkipReplay?: () => void;

  private hudAccum = 0;
  private overlayAccum = 0;
  private currentFps = 60;
  private inputSendAccum = 0;
  private lastNetPacketMs = 0;
  private replayRecorder = new GoalReplayRecorder();
  private activeReplayClip: ReplayClip | null = null;
  private prevPhase: GameStateSnapshot['phase'] = 'countdown';
  private wasLocalSupersonic = false;
  private wasLocalOnGround = true;
  private prevLocalVelY = 0;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.setAttribute('data-testid', 'game-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, width / height, 0.25, 450);

    // Mandatory Studio Environment Reflection on every device
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.stadium = buildStadium(this.scene, this.isSoftwareGl, 'dfh_night');
    this.ballRig = buildSoccerBallMesh(this.isSoftwareGl);
    this.scene.add(this.ballRig.group);
    this.scene.add(this.ballRig.indicatorRing);

    this.particles = new ParticlePool();
    this.scene.add(this.particles.mesh);
    this.scene.add(this.godModeItem.group);

    // Build Title Showcase Idle Cars
    this.spawnTitleShowcaseCars();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindInputs();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    this.handleResize();

    this.lastTimeMs = performance.now();
    this.startLoop();
  }

  private spawnTitleShowcaseCars(): void {
    this.clearCarRigs();
    const blueRig = buildCarVisualRig(DEFAULT_CUSTOMIZATION_BLUE, this.isSoftwareGl);
    blueRig.group.position.set(-14, 0.56, -16);
    blueRig.group.rotation.y = Math.atan2(14, 16);
    this.scene.add(blueRig.group);
    this.scene.add(blueRig.contactShadow);
    blueRig.contactShadow.position.set(-14, 0.025, -16);
    this.carRigs.set('title-blue', blueRig);

    const orangeRig = buildCarVisualRig(DEFAULT_CUSTOMIZATION_ORANGE, this.isSoftwareGl);
    orangeRig.group.position.set(14, 0.56, 16);
    orangeRig.group.rotation.y = Math.atan2(-14, -16);
    this.scene.add(orangeRig.group);
    this.scene.add(orangeRig.contactShadow);
    orangeRig.contactShadow.position.set(14, 0.025, 16);
    this.carRigs.set('title-orange', orangeRig);
  }

  private clearCarRigs(): void {
    for (const rig of this.carRigs.values()) {
      this.scene.remove(rig.group);
      this.scene.remove(rig.contactShadow);
      rig.dispose();
    }
    this.carRigs.clear();
    this.displayCars.clear();
  }

  public setArenaTheme(arenaId: ArenaId): void {
    this.stadium.setArenaTheme(arenaId);
  }

  public setGarageFocus(focus: 'front' | 'rear'): void {
    this.garageTargetOrbit = focus === 'rear' ? -2.32 : 0.72;
  }

  public setGaragePreview(customization: CarCustomization): void {
    const effectChanged =
      this.garageCustomization.boostEffect !== customization.boostEffect ||
      this.garageCustomization.boostColor !== customization.boostColor;
    this.garageCustomization = { ...customization };
    if (this.garageRig) {
      this.scene.remove(this.garageRig.group);
      this.scene.remove(this.garageRig.contactShadow);
      this.garageRig.dispose();
      this.garageRig = null;
    }
    this.garageRig = buildCarVisualRig(this.garageCustomization, this.isSoftwareGl);
    this.garageRig.group.position.set(3.5, 0.56, 0);
    this.garageRig.contactShadow.position.set(3.5, 0.025, 0);
    this.scene.add(this.garageRig.group);
    this.scene.add(this.garageRig.contactShadow);
    this.garageRig.group.visible = this.mode === 'garage';
    this.garageRig.contactShadow.visible = this.mode === 'garage';
    for (const cone of this.garageRig.flameCones) {
      cone.visible = this.mode === 'garage';
    }
    for (const cone of this.garageRig.innerFlameCones) {
      cone.visible = this.mode === 'garage';
    }
    if (this.mode === 'garage' && effectChanged) {
      this.particles.clear();
      _v4.set(3.5, 0.56, 0);
      this.emitBoostEffect(this.garageRig, _v4, _qIdentity, this.garageCustomization, 0.14, true, true);
    }
  }

  public setMode(mode: ViewportMode): void {
    if (mode !== 'garage') this.camera.clearViewOffset();
    this.mode = mode;
    this.paused = mode === 'paused';

    if (mode === 'title') {
      this.camera.up.set(0, 1, 0);
      this.activeState = null;
      this.targetNetState = null;
      if (this.garageRig) {
        this.garageRig.group.visible = false;
        this.garageRig.contactShadow.visible = false;
      }
      this.ballRig.group.visible = true;
      this.ballRig.indicatorRing.visible = true;
      this.particles.clear();
      this.spawnTitleShowcaseCars();
      soundEngine.updateContinuous(false, 0, false);
    } else if (mode === 'garage') {
      this.camera.up.set(0, 1, 0);
      this.garageOrbit = 0.72;
      this.garageTargetOrbit = null;
      this.clearCarRigs();
      this.particles.clear();
      this.ballRig.group.visible = false;
      this.ballRig.indicatorRing.visible = false;
      this.setGaragePreview(this.garageCustomization);
      soundEngine.updateContinuous(false, 0, false);
    } else {
      if (this.garageRig) {
        this.garageRig.group.visible = false;
        this.garageRig.contactShadow.visible = false;
      }
      this.particles.clear();
      this.ballRig.group.visible = true;
      this.ballRig.indicatorRing.visible = true;
      if (mode !== 'playing') {
        soundEngine.updateContinuous(false, 0, false);
      }
    }
  }

  private emitHudNow(): void {
    if (!this.activeState) return;
    const localCar =
      this.activeState.cars.find((c) => c.id === this.localPlayerId) || this.activeState.cars[0];
    if (!localCar) return;
    const speed = Math.hypot(localCar.vel.x, localCar.vel.y, localCar.vel.z);
    const onWall = localCar.onGround && localCar.groundNormal.y < 0.7;
    this.onHudUpdate?.({
      fps: Math.round(this.currentFps),
      godModeSeconds: localCar.godModeTimer ?? 0,
      godModeItemMarker: this.getGodModeItemMarker(),
      boost: Math.round(localCar.boost),
      speedKph: Math.round(speed * 3.6),
      supersonic: localCar.supersonic,
      onWall,
      ballCam: this.ballCam,
      scoreBlue: this.activeState.scoreBlue,
      scoreOrange: this.activeState.scoreOrange,
      clockSeconds: this.activeState.clockSeconds,
      isOvertime: this.activeState.isOvertime,
      phase: this.activeState.phase,
      phaseTimer: this.activeState.phaseTimer,
      lastGoalScorer: this.activeState.lastGoalScorer,
      lastGoalTeam: this.activeState.lastGoalTeam,
      lastGoalSpeedKph: this.activeState.lastGoalSpeedKph,
      winner: this.activeState.winner,
    });
  }

  public startLocalMatch(snapshot: GameStateSnapshot, localId: string): void {
    this.isMultiplayer = false;
    this.localVisualPosOffset.set(0, 0, 0);
    this.localVisualQuatOffset.identity();
    this.localPlayerId = localId;
    this.replayRecorder.clear();
    this.activeReplayClip = null;
    this.prevPhase = snapshot.phase;
    this.wasLocalSupersonic = false;
    this.wasLocalOnGround = true;
    this.prevLocalVelY = 0;
    this.activeState = structuredClone(snapshot);
    this.targetNetState = null;
    this.stadium.setArenaTheme(snapshot.arenaId);
    this.syncCarRigsFromState(this.activeState);
    this.snapCameraBehindLocalCar();
    this.setMode('playing');
    this.emitHudNow();
  }

  public startMultiplayerMatch(snapshot: GameStateSnapshot, localId: string, isHost = false): void {
    this.isLocalHost = isHost;
    this.prediction.reset();
    this.localInputSeq = 0;
    this.localVisualPosOffset.set(0, 0, 0);
    this.localVisualQuatOffset.identity();
    this.inputSendAccum = 1;
    this.prevInput = { ...NEUTRAL_INPUT };
    this.isMultiplayer = true;
    this.localPlayerId = localId;
    this.lastNetPacketMs = performance.now();
    this.replayRecorder.clear();
    this.activeReplayClip = null;
    this.prevPhase = snapshot.phase;
    this.wasLocalSupersonic = false;
    this.wasLocalOnGround = true;
    this.prevLocalVelY = 0;
    this.activeState = structuredClone(snapshot);
    this.targetNetState = structuredClone(snapshot);
    this.stadium.setArenaTheme(snapshot.arenaId);
    this.syncCarRigsFromState(this.activeState);
    this.snapCameraBehindLocalCar();
    this.setMode('playing');
    this.emitHudNow();
  }

  public skipGoalReplayOffline(): void {
    if (this.isMultiplayer || !this.activeState) return;
    const evs = skipGoalReplay(this.activeState);
    if (evs.length > 0) this.handleSimulationEvents(evs);
    if (this.activeState.phase === 'countdown') {
      this.activeReplayClip = null;
      this.replayRecorder.clear();
      this.snapCameraBehindLocalCar();
    }
    this.emitHudNow();
  }

  public applyNetworkSnapshot(snapshot: GameStateSnapshot): void {
    this.lastNetPacketMs = performance.now();
    this.targetNetState = snapshot;
    if (this.isLocalHost) {
      this.activeState = snapshot;
      return;
    }
    if (!this.activeState) {
      this.activeState = structuredClone(snapshot);
      this.syncCarRigsFromState(this.activeState);
      return;
    }

    // Capture pre-reconciliation visual pose so any correction glides out smoothly
    const prevLocal = this.activeState.cars.find((c) => c.id === this.localPlayerId);
    const prevLocalX = prevLocal?.pos.x ?? 0;
    const prevLocalY = prevLocal?.pos.y ?? 0;
    const prevLocalZ = prevLocal?.pos.z ?? 0;
    if (prevLocal) {
      _q2.set(prevLocal.quat.x, prevLocal.quat.y, prevLocal.quat.z, prevLocal.quat.w).multiply(this.localVisualQuatOffset);
    } else {
      _q2.identity();
    }
    const prevPhase = this.activeState.phase;
    const prevDemo = (prevLocal?.demolishedTimer ?? 0) > 0;

    // Check if cars roster changed (count or player IDs, e.g. hot-join replacing a bot)
    const rosterChanged =
      this.activeState.cars.length !== snapshot.cars.length ||
      this.activeState.cars.some((car, idx) => car.id !== snapshot.cars[idx]?.id);
    if (rosterChanged) {
      this.activeState = this.prediction.reconcile(this.activeState, snapshot, this.localPlayerId);
      this.syncCarRigsFromState(this.activeState);
      this.localVisualPosOffset.set(0, 0, 0);
      this.localVisualQuatOffset.identity();
    } else {
      this.activeState = this.prediction.reconcile(this.activeState, snapshot, this.localPlayerId);
      const nextLocal = this.activeState.cars.find((c) => c.id === this.localPlayerId);
      if (
        prevLocal &&
        nextLocal &&
        prevPhase === 'active' &&
        this.activeState.phase === 'active' &&
        prevDemo === (nextLocal.demolishedTimer > 0)
      ) {
        const dx = prevLocalX + this.localVisualPosOffset.x - nextLocal.pos.x;
        const dy = prevLocalY + this.localVisualPosOffset.y - nextLocal.pos.y;
        const dz = prevLocalZ + this.localVisualPosOffset.z - nextLocal.pos.z;
        const err = Math.hypot(dx, dy, dz);
        if (err > 0.005 && err < 3.5) {
          this.localVisualPosOffset.set(dx, dy, dz);
        } else if (err >= 3.5) {
          this.localVisualPosOffset.set(0, 0, 0);
        }
        _q3.set(nextLocal.quat.x, nextLocal.quat.y, nextLocal.quat.z, nextLocal.quat.w).invert().multiply(_q2).normalize();
        if (_q3.angleTo(_qIdentity) < Math.PI * 0.45 && err < 3.5) {
          this.localVisualQuatOffset.copy(_q3);
        } else {
          this.localVisualQuatOffset.identity();
        }
      } else {
        this.localVisualPosOffset.set(0, 0, 0);
        this.localVisualQuatOffset.identity();
      }
    }
  }

  public getCarsSnapshot(): CarState[] {
    return this.activeState ? this.activeState.cars : [];
  }

  public handleSimulationEvents(events: SimulationEvent[], fromLocalPred = false): void {
    for (const ev of events) {
      if (ev.type === 'god_mode_spawn') {
        soundEngine.playGodModeAvailable();
        this.particles.spawnBurst(ev.pos.x, ev.pos.y + 1, ev.pos.z, 32, 12, '#ffee55', 1.7, 1.2);
      } else if (ev.type === 'god_mode_pickup') {
        soundEngine.playBoostPickup(true);
        for (const color of ['#ff44cc', '#44ffff', '#ffee44']) this.particles.spawnBurst(ev.pos.x, ev.pos.y + 1, ev.pos.z, 10, 9, color, 1.1, 0.9);
      } else if (ev.type === 'ball_hit') {
        const dx = ev.pos.x - this.camera.position.x;
        const dz = ev.pos.z - this.camera.position.z;
        const distance = Math.hypot(dx, dz);
        const right = this.camera.matrixWorld.elements;
        soundEngine.playBallHit(ev.speed, (dx * right[0] + dz * right[2]) / Math.max(1, distance), 1 / (1 + distance / 55));
        this.particles.spawnBurst(ev.pos.x, ev.pos.y, ev.pos.z, 10, 12, '#fde047', 0.85, 0.38);
        if (ev.speed > 26) this.trauma = Math.min(1, this.trauma + 0.35);
      } else if (ev.type === 'wall_hit') {
        soundEngine.playBallHit(ev.speed * 0.7, 0, 1 / (1 + Math.hypot(ev.pos.x - this.camera.position.x, ev.pos.z - this.camera.position.z) / 55), true);
      } else if (ev.type === 'jump' && ev.carId === this.localPlayerId) {
        if (this.isMultiplayer && !this.isLocalHost && !fromLocalPred) continue;
        soundEngine.playJump(false);
        this.particles.spawnBurst(ev.pos.x, ev.pos.y, ev.pos.z, 6, 6, '#e2e8f0', 0.65, 0.3);
      } else if (ev.type === 'flip' && ev.carId === this.localPlayerId) {
        if (this.isMultiplayer && !this.isLocalHost && !fromLocalPred) continue;
        soundEngine.playJump(true);
        this.particles.spawnBurst(ev.pos.x, ev.pos.y, ev.pos.z, 10, 9, '#38bdf8', 0.75, 0.35);
      } else if (ev.type === 'boost_pickup' && ev.carId === this.localPlayerId) {
        soundEngine.playBoostPickup(ev.isBig);
      } else if (ev.type === 'save') {
        soundEngine.playSave();
      } else if (ev.type === 'countdown') {
        soundEngine.playCountdown(ev.secondsLeft);
      } else if (ev.type === 'demo') {
        this.spawnBoom(ev.pos.x, ev.pos.y, ev.pos.z);
        soundEngine.playDemoExplosion();
        this.trauma = Math.min(1, this.trauma + 0.65);
        this.particles.spawnBurst(ev.pos.x, ev.pos.y, ev.pos.z, 26, 22, '#f97316', 1.5, 0.85);
      } else if (ev.type === 'goal') {
        soundEngine.playGoalExplosion();
        this.trauma = 1.0;
        const color = ev.team === 'blue' ? '#38bdf8' : '#fb923c';
        this.particles.spawnBurst(ev.pos.x, ev.pos.y + 1.5, ev.pos.z, 48, 34, color, 2.2, 1.3);
        this.particles.spawnBurst(ev.pos.x, ev.pos.y + 1.5, ev.pos.z, 24, 24, '#ffffff', 1.6, 1.0);
      }
    }
    this.onEvents?.(events);
  }

  public toggleBallCam(): boolean {
    this.ballCam = !this.ballCam;
    this.onBallCamChange?.(this.ballCam);
    return this.ballCam;
  }

  public isBallCam(): boolean {
    return this.ballCam;
  }

  private syncCarRigsFromState(state: GameStateSnapshot): void {
    this.clearCarRigs();
    for (const car of state.cars) {
      const rig = buildCarVisualRig(car.customization, this.isSoftwareGl);
      rig.group.position.set(car.pos.x, car.pos.y, car.pos.z);
      rig.group.quaternion.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
      this.scene.add(rig.group);
      this.scene.add(rig.contactShadow);
      this.carRigs.set(car.id, rig);
      this.displayCars.set(car.id, {
        pos: new THREE.Vector3(car.pos.x, car.pos.y, car.pos.z),
        quat: new THREE.Quaternion(car.quat.x, car.quat.y, car.quat.z, car.quat.w),
        wheelSpin: car.wheelSpin,
        steerAngle: car.steerAngle,
      });
    }
    this.displayBallPos.set(state.ball.pos.x, state.ball.pos.y, state.ball.pos.z);
  }

  private snapCameraBehindLocalCar(): void {
    if (!this.activeState) return;
    const car = this.activeState.cars.find((c) => c.id === this.localPlayerId) || this.activeState.cars[0];
    if (!car) return;
    const view = buildFollowCamera(car, this.activeState.ball.pos, this.ballCam);
    this.cameraPos.set(view.position.x, view.position.y, view.position.z);
    this.cameraLook.set(view.lookAt.x, view.lookAt.y, view.lookAt.z);
    this.camera.up.set(view.up.x, view.up.y, view.up.z);
  }

  private readCurrentInput(): PlayerInput {
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');

    const throttle = (up ? 1 : 0) - (down ? 1 : 0);
    const steer = (left ? 1 : 0) - (right ? 1 : 0);
    const boost =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.keys.has('KeyJ') ||
      this.mouseBoost;
    const handbrake =
      this.keys.has('KeyK') || this.keys.has('KeyX') || this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    const jump = this.keys.has('Space') || this.mouseJump;
    const rollLeft = this.keys.has('KeyQ');
    const rollRight = this.keys.has('KeyE');

    return {
      throttle,
      steer,
      boost,
      handbrake,
      jump,
      pitch: (down ? 1 : 0) - (up ? 1 : 0),
      yaw: steer,
      roll: (rollRight ? 1 : 0) - (rollLeft ? 1 : 0),
    };
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    // Ignore typing in inputs
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (this.mode === 'playing') {
      if (e.code === 'Space' && this.activeState?.phase === 'goal_replay') {
        e.preventDefault();
        this.onSkipReplay?.();
        return;
      }
      if (e.code === 'KeyY' || e.code === 'KeyC') {
        this.toggleBallCam();
        return;
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPauseToggle?.();
        return;
      }
      if (e.code === 'Digit1') this.onQuickChatKey?.(0);
      if (e.code === 'Digit2') this.onQuickChatKey?.(1);
      if (e.code === 'Digit3') this.onQuickChatKey?.(2);
      if (e.code === 'Digit4') this.onQuickChatKey?.(3);
    } else if (this.mode === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) {
      this.onPauseToggle?.();
      return;
    }

    if (
      e.code === 'Space' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      (this.mode === 'playing' && (e.ctrlKey || e.code === 'ControlLeft' || e.code === 'ControlRight'))
    ) {
      e.preventDefault();
    }

    soundEngine.unlock();
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (this.mode === 'garage' && e.button === 0 && e.target === this.renderer.domElement) {
      this.garageDragX = e.clientX;
      this.garageTargetOrbit = null;
    }
    if (this.mode !== 'playing') return;
    if (e.target !== this.renderer.domElement) return;
    if (e.button === 0) {
      e.preventDefault();
      this.mouseJump = true;
    }
    if (e.button === 2) {
      this.mouseBoost = true;
    }
    soundEngine.unlock();
  };

  private handleMouseUp = (e: MouseEvent) => {
    this.garageDragX = null;
    if (e.button === 0) this.mouseJump = false;
    if (e.button === 2) this.mouseBoost = false;
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (this.garageDragX === null || this.mode !== 'garage') return;
    this.garageOrbit -= (e.clientX - this.garageDragX) * 0.008;
    this.garageDragX = e.clientX;
  };

  private handleWheel = (e: WheelEvent) => {
    if (this.mode === 'garage' && e.target === this.renderer.domElement) {
      this.garageZoom = clamp(this.garageZoom + e.deltaY * 0.005, 3.8, 10);
    }
  };

  private handleContextMenu = (e: MouseEvent) => {
    if (this.mode === 'playing') e.preventDefault();
  };

  private handleBlur = () => {
    soundEngine.setGodModeMusic(false);
    this.keys.clear();
    this.mouseBoost = false;
    this.mouseJump = false;
    this.garageDragX = null;
    soundEngine.updateContinuous(false, 0, false);
  };

  private bindInputs(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleBlur);
  }

  private handleResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private startLoop(): void {
    const afterDraw = (cb: () => void) => {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (this.disposed) return;
          const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
          if (state === gl.UNSIGNALED) {
            this.frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            this.frameId = window.setTimeout(cb, 8);
          }
        };
        this.frameId = window.setTimeout(poll, 5);
      } else {
        this.frameId = window.setTimeout(cb, 8);
      }
    };

    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const rawDt = (now - this.lastTimeMs) / 1000;
      if (rawDt > 0) this.currentFps = lerp(this.currentFps, 1 / rawDt, 0.12);
      this.lastTimeMs = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      this.update(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(tick, 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private update(dt: number): void {
    this.elapsed += dt;
    this.overlayAccum += dt;
    const updateOverlays = this.overlayAccum >= 1 / 20;
    if (updateOverlays) this.overlayAccum %= 1 / 20;
    if (this.mode !== 'playing' || this.paused || document.hidden) soundEngine.setGodModeMusic(false);
    this.godModeItem.update(this.activeState?.powerUps?.item, this.elapsed, (this.mode === 'playing' || this.mode === 'paused') && this.activeState?.phase === 'active');
    for (let i = this.boomSprites.length - 1; i >= 0; i--) {
      const boom = this.boomSprites[i];
      boom.age += dt;
      const scale = 1 + Math.min(1, boom.age / 0.16) * 0.3;
      boom.sprite.scale.set(10 * scale, 5 * scale, 1);
      boom.sprite.material.opacity = clamp((1.2 - boom.age) / 0.35, 0, 1);
      if (boom.age > 1.2) {
        boom.sprite.removeFromParent();
        boom.sprite.material.map?.dispose();
        boom.sprite.material.dispose();
        this.boomSprites.splice(i, 1);
      }
    }

    if (this.mode === 'title') {
      // Live world stadium orbital flyover
      const angle = this.elapsed * 0.14;
      this.camera.position.set(
        Math.cos(angle) * 62,
        21 + Math.sin(this.elapsed * 0.4) * 3.0,
        Math.sin(angle) * 74,
      );
      this.camera.lookAt(0, 3.0, 0);
      this.camera.fov = 68;
      this.camera.updateProjectionMatrix();

      this.ballRig.group.position.set(0, 1.7 + Math.sin(this.elapsed * 2) * 0.12, 0);
      this.ballRig.group.rotation.y = this.elapsed * 0.6;
      this.ballRig.indicatorRing.position.set(0, 0.03, 0);
      this.stadium.update(this.elapsed, []);
      this.particles.update(dt, this.camera.quaternion);
      return;
    }

    if (this.mode === 'garage' && this.garageRig) {
      if (this.garageTargetOrbit !== null) {
        const diff = this.garageTargetOrbit - this.garageOrbit;
        if (Math.abs(diff) < 0.008) {
          this.garageOrbit = this.garageTargetOrbit;
          this.garageTargetOrbit = null;
        } else {
          this.garageOrbit += diff * (1 - Math.exp(-8 * dt));
        }
      }
      const angle = this.garageOrbit;
      const rearBlend = clamp((-angle - 0.6) / 1.4, 0, 1);
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      const compact = w < 768;
      const zoom = this.garageZoom * (compact ? 1.42 : 1 + rearBlend * 0.16);
      this.camera.position.set(
        3.5 + Math.cos(angle) * zoom,
        2.25 + rearBlend * 0.25,
        Math.sin(angle) * zoom,
      );
      this.camera.lookAt(3.5, 0.50 + rearBlend * 0.12, -0.95 * rearBlend);
      this.camera.setViewOffset(
        w,
        h,
        compact ? 0 : -w * (0.18 - rearBlend * 0.02),
        compact ? h * 0.27 : 0,
        w,
        h,
      );
      this.camera.fov = compact ? 56 : 48;
      this.camera.updateProjectionMatrix();
      this.garageRig.group.rotation.y = 0;

      const effectStyle = this.garageCustomization.boostEffect ?? 'classic_flame';
      const plume = computeExhaustPlumeTint(effectStyle, this.garageCustomization.boostColor, this.elapsed);
      this.garageRig.flameMat.color.set(plume.outerHex);
      this.garageRig.innerFlameMat.color.set(plume.innerHex);
      for (const cone of this.garageRig.flameCones) {
        cone.visible = true;
        cone.scale.set(0.88, 0.88, plume.pulseScale * 0.85);
      }
      for (const cone of this.garageRig.innerFlameCones) {
        cone.visible = true;
        cone.scale.set(0.82, 0.82, plume.pulseScale * 0.8);
      }

      _v4.set(3.5, 0.56, 0);
      this.emitBoostEffect(this.garageRig, _v4, _qIdentity, this.garageCustomization, dt, false, true);

      this.stadium.update(this.elapsed, []);
      this.particles.update(dt, this.camera.quaternion);
      return;
    }

    if (!this.activeState) return;

    const input = this.mode === 'playing' ? this.readCurrentInput() : NEUTRAL_INPUT;

    if ((this.mode === 'playing' && !this.paused) || (this.isMultiplayer && this.mode === 'paused')) {
      if (this.isMultiplayer) {
        // Stream local inputs immediately on change, at 60Hz while active, and >=10Hz keepalive when idle
        this.inputSendAccum += dt;
        const discreteChanged =
          input.jump !== this.prevInput.jump ||
          input.boost !== this.prevInput.boost ||
          input.handbrake !== this.prevInput.handbrake ||
          input.throttle !== this.prevInput.throttle ||
          input.steer !== this.prevInput.steer ||
          input.pitch !== this.prevInput.pitch ||
          input.yaw !== this.prevInput.yaw ||
          input.roll !== this.prevInput.roll;
        const isNonNeutral =
          input.throttle !== 0 ||
          input.steer !== 0 ||
          input.roll !== 0 ||
          input.pitch !== 0 ||
          input.yaw !== 0 ||
          input.boost ||
          input.handbrake ||
          input.jump;
        if (
          discreteChanged ||
          (isNonNeutral && this.inputSendAccum >= 1 / 62) ||
          this.inputSendAccum >= 1 / 10
        ) {
          this.inputSendAccum = 0;
          const candidateSeq = this.localInputSeq + 1;
          const sent = this.onSendInput?.(input, this.prediction.time, candidateSeq);
          if (sent !== false) {
            this.localInputSeq = candidateSeq;
          }
        }
        this.prevInput = input;

        // 60fps local prediction only while host packets are fresh (<1.2s); freeze on stall so timelines never diverge
        const netFresh = performance.now() - this.lastNetPacketMs < 1200;
        const predEvents = this.prediction.advance(
          this.activeState,
          this.localPlayerId,
          input,
          dt,
          netFresh && !this.isLocalHost,
          this.localInputSeq,
        );
        if (this.activeState.phase === 'active' && netFresh) {
          // Trigger local jump/flip feedback immediately without waiting for host round-trip
          for (const ev of predEvents) {
            if ((ev.type === 'jump' || ev.type === 'flip') && ev.carId === this.localPlayerId) {
              this.handleSimulationEvents([ev], true);
            }
          }
        } else if (this.activeState.phase === 'goal_replay') {
          this.activeState.phaseTimer = Math.max(0, this.activeState.phaseTimer - dt);
        }
      } else {
        // Offline local simulation
        const events = stepSimulation(
          this.activeState,
          { [this.localPlayerId]: input },
          dt,
        );
        if (events.length > 0) {
          this.handleSimulationEvents(events);
        }
      }
    }

    // Track phase transitions for Instant Goal Replay recording & kickoff resets
    const phase = this.activeState.phase;
    if (this.prevPhase === 'active' && phase === 'goal_scored') {
      this.replayRecorder.record(this.activeState, this.elapsed, true);
      this.activeReplayClip = this.replayRecorder.captureClip(this.activeState);
    }
    if (this.prevPhase !== 'goal_replay' && phase === 'goal_replay') {
      this.activeReplayClip ??= this.replayRecorder.captureClip(this.activeState);
      this.replaySampleTime = null;
      soundEngine.playReplayTransition();
    } else if (this.prevPhase !== 'countdown' && phase === 'countdown') {
      this.activeReplayClip = null;
      this.replayRecorder.clear();
      this.snapCameraBehindLocalCar();
    }
    this.prevPhase = phase;

    if (phase === 'active') {
      this.replayRecorder.record(this.activeState, this.elapsed);
    }

    // Instant Goal Replay Director Playback
    if (phase === 'goal_replay' && this.activeReplayClip) {
      this.camera.up.set(0, 1, 0);
      const progress = clamp(1 - this.activeState.phaseTimer / GOAL_REPLAY_DURATION, 0, 1);
      const timeline = replayTimelineProgress(progress);
      const frame = sampleReplayFrame(this.activeReplayClip, timeline);
      if (frame) {
        const replayStarting = this.replaySampleTime === null;
        this.displayBallPos.set(frame.ballPos.x, frame.ballPos.y, frame.ballPos.z);
        this.ballRig.group.position.copy(this.displayBallPos);
        this.rotateBall(frame.ballAngVel, this.replaySampleTime === null ? 0 : frame.t - this.replaySampleTime);
        this.replaySampleTime = frame.t;
        this.ballRig.indicatorRing.position.set(frame.ballPos.x, 0.03, frame.ballPos.z);
        const hScale = clamp(1 - (frame.ballPos.y - 1.65) / 24, 0.35, 1.0);
        this.ballRig.indicatorRing.scale.setScalar(hScale);

        let scorerCarFrame =
          frame.cars.find((c) => c.id === this.activeReplayClip?.scorerId) || frame.cars[0];
        for (const rCar of frame.cars) {
          const rig = this.carRigs.get(rCar.id);
          if (!rig) continue;
          animateGodModeCar(rig, false, this.elapsed);
          rig.group.visible = !rCar.demolished;
          rig.contactShadow.visible = !rCar.demolished && (rCar.onGround || rCar.pos.y < 10);
          if (rCar.demolished) continue;
          rig.group.position.set(rCar.pos.x, rCar.pos.y, rCar.pos.z);
          rig.group.quaternion.set(rCar.quat.x, rCar.quat.y, rCar.quat.z, rCar.quat.w);
          for (let i = 0; i < 4; i++) {
            if (i < 2) rig.wheelPivots[i].rotation.y = rCar.steerAngle;
            rig.wheelMeshes[i].rotation.x = rCar.wheelSpin;
          }
          if (rCar.onGround) {
            _v4.set(rCar.groundNormal.x, rCar.groundNormal.y, rCar.groundNormal.z).normalize();
            rig.contactShadow.position
              .copy(rig.group.position)
              .addScaledVector(_v4, -(CAR_RIDE_HEIGHT - 0.03));
            rig.contactShadow.quaternion.setFromUnitVectors(_up, _v4);
          } else {
            rig.contactShadow.position.set(rCar.pos.x, 0.025, rCar.pos.z);
            rig.contactShadow.quaternion.identity();
          }
          const replayCarState = this.activeState.cars.find((c) => c.id === rCar.id);
          const rCust = replayCarState?.customization ?? DEFAULT_CUSTOMIZATION_BLUE;
          const rStyle = rCust.boostEffect ?? 'classic_flame';
          const rPlume = computeExhaustPlumeTint(rStyle, rCust.boostColor, this.elapsed);
          rig.flameMat.color.set(rPlume.outerHex);
          rig.innerFlameMat.color.set(rPlume.innerHex);
          for (const cone of rig.flameCones) {
            cone.visible = rCar.supersonic;
            if (rCar.supersonic) cone.scale.set(1, 1, rPlume.pulseScale + Math.random() * 0.25);
          }
          for (const cone of rig.innerFlameCones) {
            cone.visible = rCar.supersonic;
            if (rCar.supersonic) cone.scale.set(1, 1, rPlume.pulseScale + Math.random() * 0.2);
          }
          if (rCar.supersonic) {
            this.emitBoostEffect(rig, rig.group.position, rig.group.quaternion, rCust, dt, true, false);
          }
        }

        // Broadcast Director Camera: Tracks Scorer -> Sweeps to Goal-Line Angle
        if (progress < 0.60 && scorerCarFrame) {
          _q1.set(scorerCarFrame.quat.x, scorerCarFrame.quat.y, scorerCarFrame.quat.z, scorerCarFrame.quat.w);
          _v2.set(0, 0, 1).applyQuaternion(_q1).normalize();
          _v4.set(scorerCarFrame.pos.x, scorerCarFrame.pos.y, scorerCarFrame.pos.z);
          _v3
            .copy(_v4)
            .addScaledVector(_v2, -9.8)
            .addScaledVector(_up, 4.1);
          _v3.x += (scorerCarFrame.pos.x >= 0 ? -4.2 : 4.2);
          _v3.x = clamp(_v3.x, -ARENA_HALF_X + 2.5, ARENA_HALF_X - 2.5);
          _v3.z = clamp(_v3.z, -ARENA_HALF_Z + 2.5, ARENA_HALF_Z - 2.5);
          _v3.y = clamp(_v3.y, 2.4, ARENA_HEIGHT - 2.5);
          this.cameraPos.lerp(_v3, replayStarting ? 1 : 1 - Math.exp(-9 * dt));
          _v1.copy(this.displayBallPos).lerp(_v4, 0.35);
          _v1.y = Math.max(1.2, _v1.y + 0.5);
          this.cameraLook.lerp(_v1, replayStarting ? 1 : 1 - Math.exp(-11 * dt));
        } else {
          const scoredBlueGoal = this.activeReplayClip.goalTeam === 'orange';
          const goalZ = scoredBlueGoal ? -ARENA_HALF_Z : ARENA_HALF_Z;
          const dirInward = scoredBlueGoal ? 1 : -1;
          _v3.set(
            this.displayBallPos.x >= 0 ? -15 : 15,
            6.2,
            goalZ + dirInward * 18,
          );
          this.cameraPos.lerp(_v3, replayStarting ? 1 : 1 - Math.exp(-7 * dt));
          _v1.copy(this.displayBallPos);
          _v1.y = Math.max(1.2, _v1.y);
          this.cameraLook.lerp(_v1, replayStarting ? 1 : 1 - Math.exp(-11 * dt));
        }
        this.camera.fov = lerp(this.camera.fov, progress > 0.65 ? 54 : 68, 1 - Math.exp(-6 * dt));
        this.camera.updateProjectionMatrix();
        this.camera.position.copy(this.cameraPos);
        this.camera.lookAt(this.cameraLook);
      }

      soundEngine.updateContinuous(false, 0, false);
      if (updateOverlays) {
        this.onNameplates?.([]);
        this.onGoalMarkers?.([]);
      }
      this.stadium.update(this.elapsed, this.activeState.boostPads);
      this.particles.update(dt, this.camera.quaternion);
      this.hudAccum += dt;
      if (this.hudAccum >= 1 / 15) {
        this.hudAccum = 0;
        this.emitHudNow();
      }
      return;
    }

    // Visual interpolation & boost particle emission
    const ballInterp = this.isMultiplayer ? clamp(1 - Math.exp(-26 * dt), 0, 1) : 1;
    const remoteInterp = this.isMultiplayer ? clamp(1 - Math.exp(-24 * dt), 0, 1) : 1;
    const visualDecay = 1 - Math.exp(-16 * dt);
    this.localVisualPosOffset.multiplyScalar(1 - visualDecay);
    if (this.localVisualPosOffset.lengthSq() < 1e-6) this.localVisualPosOffset.set(0, 0, 0);
    this.localVisualQuatOffset.slerp(_qIdentity, visualDecay);
    if (this.localVisualQuatOffset.angleTo(_qIdentity) < 1e-4) this.localVisualQuatOffset.identity();

    _v1.set(
      this.activeState.ball.pos.x,
      this.activeState.ball.pos.y,
      this.activeState.ball.pos.z,
    );
    if (this.displayBallPos.distanceTo(_v1) > 8) {
      this.displayBallPos.copy(_v1);
    } else {
      this.displayBallPos.lerp(_v1, ballInterp);
    }
    this.ballRig.group.position.copy(this.displayBallPos);
    this.rotateBall(this.activeState.ball.angVel, dt);

    // Ground projection indicator ring scales cleanly with ball height
    this.ballRig.indicatorRing.position.set(this.displayBallPos.x, 0.03, this.displayBallPos.z);
    const heightScale = clamp(1 - (this.displayBallPos.y - 1.65) / 24, 0.35, 1.0);
    this.ballRig.indicatorRing.scale.setScalar(heightScale);

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const plates: NameplateProjection[] = [];

    let localCar: CarState | undefined;
    for (const car of this.activeState.cars) {
      if (car.id === this.localPlayerId) localCar = car;
      const rig = this.carRigs.get(car.id);
      const disp = this.displayCars.get(car.id);
      if (!rig || !disp) continue;
      const godMode = car.godModeTimer > 0 && this.activeState.phase === 'active';
      animateGodModeCar(rig, godMode, this.elapsed);

      const hidden = car.demolishedTimer > 0;
      const carOnWall = car.onGround && car.groundNormal.y < 0.7;
      rig.group.visible = !hidden;
      rig.contactShadow.visible = !hidden && (car.onGround || car.pos.y < 10);

      if (hidden) continue;

      _v1.set(car.pos.x, car.pos.y, car.pos.z);
      _q1.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
      if (car.id === this.localPlayerId && this.isMultiplayer && !this.isLocalHost) {
        // Guest local car renders with 0ms driving lag + smooth error decay
        disp.pos.copy(_v1).add(this.localVisualPosOffset);
        disp.quat.copy(_q1).multiply(this.localVisualQuatOffset).normalize();
      } else if (disp.pos.distanceTo(_v1) > 8) {
        disp.pos.copy(_v1);
        disp.quat.copy(_q1);
      } else {
        const carFactor = car.id === this.localPlayerId ? clamp(1 - Math.exp(-36 * dt), 0, 1) : remoteInterp;
        disp.pos.lerp(_v1, carFactor);
        disp.quat.slerp(_q1, carFactor);
      }

      rig.group.position.copy(disp.pos);
      rig.group.quaternion.copy(disp.quat);
      if (godMode && Math.random() < Math.min(1, dt * 45)) {
        _v2.set((Math.random() - 0.5) * 2.6, 0.4, -2).applyQuaternion(disp.quat).add(disp.pos);
        this.particles.spawn(_v2.x, _v2.y, _v2.z, -car.vel.x * 0.1, 1.6, -car.vel.z * 0.1, rig.primaryMat.emissive.getHex(), 0.8, 0.02, 0.6);
      }

      // Surface-aligned contact shadow (projects onto walls/ramps when grounded so wall grip is unmistakable)
      if (car.onGround) {
        _v4.set(car.groundNormal.x, car.groundNormal.y, car.groundNormal.z).normalize();
        rig.contactShadow.position
          .copy(disp.pos)
          .addScaledVector(_v4, -(CAR_RIDE_HEIGHT - 0.03));
        rig.contactShadow.quaternion.setFromUnitVectors(_up, _v4);
        rig.contactShadow.scale.setScalar(carOnWall ? 1.14 : 1.0);
        (rig.contactShadow.material as THREE.MeshBasicMaterial).opacity = carOnWall ? 0.68 : 0.55;
      } else {
        rig.contactShadow.position.set(disp.pos.x, 0.025, disp.pos.z);
        rig.contactShadow.quaternion.identity();
        rig.contactShadow.scale.setScalar(1.0);
        const shadowAlpha = clamp(0.55 - disp.pos.y * 0.05, 0.08, 0.55);
        (rig.contactShadow.material as THREE.MeshBasicMaterial).opacity = shadowAlpha;
      }

      // Wheel spin & front axle steering visual
      disp.wheelSpin = car.wheelSpin;
      disp.steerAngle = lerp(disp.steerAngle, car.steerAngle, clamp(15 * dt, 0, 1));
      for (let i = 0; i < 4; i++) {
        if (i < 2) rig.wheelPivots[i].rotation.y = disp.steerAngle;
        rig.wheelMeshes[i].rotation.x = disp.wheelSpin;
      }

      // Subtle wall-grip wheel dust/sparks so riding walls feels distinct
      const carSpeed = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
      if (carOnWall && carSpeed > 7 && Math.random() < 0.35) {
        _v4.set(car.groundNormal.x, car.groundNormal.y, car.groundNormal.z).normalize();
        _v2.set(0, -0.25, -1.6).applyQuaternion(disp.quat).add(disp.pos);
        this.particles.spawn(
          _v2.x + (Math.random() - 0.5) * 0.8,
          _v2.y + (Math.random() - 0.5) * 0.4,
          _v2.z + (Math.random() - 0.5) * 0.8,
          _v4.x * 3.5,
          _v4.y * 3.5,
          _v4.z * 3.5,
          '#7dd3fc',
          0.55,
          0.03,
          0.2,
        );
      }

      // Boost flame & multi-layer custom smoke/effect particles
      const isBoosting = godMode || (
        car.id === this.localPlayerId
          ? input.boost && car.boost > 0.2 && this.activeState.phase === 'active'
          : car.supersonic || (car.boost < 99 && Math.hypot(car.vel.x, car.vel.z) > 26));

      const effectStyle = car.customization.boostEffect ?? 'classic_flame';
      if (!godMode) {
        const plume = computeExhaustPlumeTint(effectStyle, car.customization.boostColor, this.elapsed);
        rig.flameMat.color.set(plume.outerHex);
        rig.innerFlameMat.color.set(plume.innerHex);
      }

      for (const cone of rig.flameCones) {
        cone.visible = isBoosting;
        if (isBoosting) {
          const surge = car.supersonic ? 1.55 : 0.8 + clamp(carSpeed / 31, 0, 1) * 0.4;
          cone.scale.set(car.supersonic ? 1.2 : 1, car.supersonic ? 1.2 : 1, surge + Math.random() * 0.25);
        }
      }
      for (const cone of rig.innerFlameCones) {
        cone.visible = isBoosting;
        if (isBoosting) {
          const surge = car.supersonic ? 1.45 : 0.78 + clamp(carSpeed / 31, 0, 1) * 0.35;
          cone.scale.set(car.supersonic ? 1.15 : 1, car.supersonic ? 1.15 : 1, surge + Math.random() * 0.2);
        }
      }

      if (isBoosting) {
        this.emitBoostEffect(rig, disp.pos, disp.quat, car.customization, dt, car.supersonic, false);
      }

      // Project remote car nameplates
      if (car.id !== this.localPlayerId) {
        _proj.set(disp.pos.x, disp.pos.y + 2.2, disp.pos.z);
        _proj.project(this.camera);
        const visible =
          _proj.z >= -1 &&
          _proj.z <= 1 &&
          Math.abs(_proj.x) <= 1.05 &&
          Math.abs(_proj.y) <= 1.05;
        plates.push({
          id: car.id,
          name: car.name,
          team: car.team,
          x: (_proj.x * 0.5 + 0.5) * w,
          y: (-_proj.y * 0.5 + 0.5) * h,
          visible,
        });
      }
    }

    if (updateOverlays) this.onNameplates?.(plates);

    // Project Blue (-Z) and Orange (+Z) goal markers so players always know which goal to attack/defend
    const goalMarkers: GoalMarkerProjection[] = [];
    for (const [team, gz] of [
      ['blue', -ARENA_HALF_Z],
      ['orange', ARENA_HALF_Z],
    ] as const) {
      _proj.set(0, GOAL_HEIGHT + 5.8, gz);
      _v2.copy(_proj).sub(this.camera.position);
      this.camera.getWorldDirection(_v3);
      const inFront = _v2.dot(_v3) > 0;
      _proj.project(this.camera);
      const sx = (_proj.x * 0.5 + 0.5) * w;
      const sy = (-_proj.y * 0.5 + 0.5) * h;
      const visible =
        inFront &&
        _proj.z >= -1 &&
        _proj.z <= 1 &&
        Math.abs(_proj.x) <= 0.96 &&
        Math.abs(_proj.y) <= 0.92;
      const relX = inFront ? _proj.x : -_proj.x;
      const side = relX < -0.15 ? 'left' : relX > 0.15 ? 'right' : 'center';
      goalMarkers.push({ team, x: sx, y: sy, inFront, visible, side });
    }
    if (updateOverlays) this.onGoalMarkers?.(goalMarkers);

    // Camera Follow Rig (Ball Cam or Car Cam)
    if (localCar) {
      const disp = this.displayCars.get(localCar.id);
      const carPos = disp ? disp.pos : _v1.set(localCar.pos.x, localCar.pos.y, localCar.pos.z);
      const carQuat = disp
        ? disp.quat
        : _q2.set(localCar.quat.x, localCar.quat.y, localCar.quat.z, localCar.quat.w);
      const view = buildFollowCamera({ ...localCar, pos: carPos, quat: carQuat }, this.displayBallPos, this.ballCam);
      this.cameraPos.lerp(_v3.set(view.position.x, view.position.y, view.position.z), 1 - Math.exp(-12 * dt));
      // Recheck the smoothed path: lerping between safe points can cut through a goal post.
      const safe = constrainCamera(view.pivot, this.cameraPos);
      this.cameraPos.set(safe.x, safe.y, safe.z);
      this.cameraLook.lerp(_v2.set(view.lookAt.x, view.lookAt.y, view.lookAt.z), 1 - Math.exp(-14 * dt));
      const cameraUp = smoothCameraUp(this.camera.up, view.up, dt, localCar.onGround);
      this.camera.up.set(cameraUp.x, cameraUp.y, cameraUp.z);
      // Trauma shake + speed FOV kick
      const speed = Math.hypot(localCar.vel.x, localCar.vel.y, localCar.vel.z);
      const targetFov = localCar.supersonic ? 86 : 74 + clamp((speed - 18) / 20, 0, 1) * 9;
      this.camera.fov = lerp(this.camera.fov, targetFov, clamp(8 * dt, 0, 1));
      this.camera.updateProjectionMatrix();

      this.camera.position.copy(this.cameraPos);
      if (this.trauma > 0.01) {
        const shake = this.trauma * this.trauma * 0.65;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
        this.trauma = Math.max(0, this.trauma - 1.8 * dt);
      }
      this.camera.lookAt(this.cameraLook);

      // Audio edges: Supersonic boom & hard landing suspension thump
      if (this.mode === 'playing' && !this.paused && this.activeState.phase === 'active') {
        if (localCar.supersonic && !this.wasLocalSupersonic) {
          soundEngine.playSupersonic();
        }
        if (localCar.onGround && !this.wasLocalOnGround && Math.abs(this.prevLocalVelY) > 4.5) {
          soundEngine.playLanding(Math.abs(this.prevLocalVelY));
        }
      }
      this.wasLocalSupersonic = localCar.supersonic;
      this.wasLocalOnGround = localCar.onGround;
      this.prevLocalVelY = localCar.vel.y;

      // Update continuous engine & boost audio
      const isActiveBoost =
        input.boost &&
        localCar.boost > 0.2 &&
        this.mode === 'playing' &&
        this.activeState.phase === 'active';
      soundEngine.updateContinuous(this.mode === 'playing' && !this.paused && this.activeState.phase === 'active' && localCar.demolishedTimer <= 0 && !document.hidden, speed, isActiveBoost, input.throttle, localCar.onGround, input.handbrake);
      soundEngine.setGodModeMusic(localCar.godModeTimer > 0 && this.mode === 'playing' && !this.paused && this.activeState.phase === 'active' && !document.hidden);
    }

    this.stadium.update(this.elapsed, this.activeState.boostPads);
    this.particles.update(dt, this.camera.quaternion);

    // Throttle React HUD updates to <= 15Hz (only discrete/telemetry refresh)
    this.hudAccum += dt;
    if (this.hudAccum >= 1 / 15 && localCar && this.activeState) {
      this.hudAccum = 0;
      const speed = Math.hypot(localCar.vel.x, localCar.vel.y, localCar.vel.z);
      const onWall = localCar.onGround && localCar.groundNormal.y < 0.7;
      this.onHudUpdate?.({
        fps: Math.round(this.currentFps),
        godModeSeconds: localCar.godModeTimer ?? 0,
        godModeItemMarker: this.getGodModeItemMarker(),
        boost: Math.round(localCar.boost),
        speedKph: Math.round(speed * 3.6),
        supersonic: localCar.supersonic,
        onWall,
        ballCam: this.ballCam,
        scoreBlue: this.activeState.scoreBlue,
        scoreOrange: this.activeState.scoreOrange,
        clockSeconds: this.activeState.clockSeconds,
        isOvertime: this.activeState.isOvertime,
        phase: this.activeState.phase,
        phaseTimer: this.activeState.phaseTimer,
        lastGoalScorer: this.activeState.lastGoalScorer,
        lastGoalTeam: this.activeState.lastGoalTeam,
        lastGoalSpeedKph: this.activeState.lastGoalSpeedKph,
        winner: this.activeState.winner,
      });
    }
  }

  private getGodModeItemMarker(): HudTelemetry['godModeItemMarker'] {
    const item = this.activeState?.powerUps?.item;
    const car = this.activeState?.cars.find((candidate) => candidate.id === this.localPlayerId);
    if (!item || !car || this.activeState?.phase !== 'active') return null;
    _proj.set(item.pos.x, item.pos.y + 3.4, item.pos.z).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = _proj.z > 0;
    _proj.set(item.pos.x, item.pos.y + 3.4, item.pos.z).project(this.camera);
    const x = behind ? -_proj.x : _proj.x;
    const y = behind ? -_proj.y : _proj.y;
    return {
      x: clamp((x * 0.5 + 0.5) * this.container.clientWidth, 95, this.container.clientWidth - 95),
      y: clamp((-y * 0.5 + 0.5) * this.container.clientHeight, 120, this.container.clientHeight - 110),
      distance: Math.round(Math.hypot(car.pos.x - item.pos.x, car.pos.y - item.pos.y, car.pos.z - item.pos.z)),
      offscreen: behind || Math.abs(x) > 0.85 || Math.abs(y) > 0.75,
      angle: Math.atan2(-y, x) * 180 / Math.PI,
    };
  }

  private emitBoostEffect(
    _rig: CarVisualRig,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    customization: CarCustomization,
    dt: number,
    isSupersonic: boolean,
    isGarage: boolean,
  ): void {
    const style = customization.boostEffect ?? 'classic_flame';
    const spec = getBoostEffectSpec(style);
    const bodySpec = BODY_GEOMETRY_SPECS[customization.body] ?? BODY_GEOMETRY_SPECS.octane;
    const ports = bodySpec.exhausts;
    const portScale = 1 / Math.max(1, ports.length * 0.72);
    const boostMult = isGarage ? 0.95 : isSupersonic ? 1.35 : 1.0;
    const exhaustSpeed = isGarage ? 8.8 : isSupersonic ? 11.8 : 9.5;

    // Backwards exhaust axis in world space
    _v3.set(0, 0, -1).applyQuaternion(quat).normalize();

    const spawnProb = (rate: number) => rate * dt * portScale * boostMult;
    const sampleCount = (rate: number) => {
      const expected = spawnProb(rate);
      const whole = Math.floor(expected);
      return whole + (Math.random() < expected - whole ? 1 : 0);
    };

    for (let p = 0; p < ports.length; p++) {
      const port = ports[p];
      _v2.set(port.x, port.y, port.z - 0.18).applyQuaternion(quat).add(pos);

      // 1. Volumetric Smoke / Mist / Nebula Layer
      const smokeCount = sampleCount(spec.smokeRate);
      for (let i = 0; i < smokeCount; i++) {
        const spread = spec.smokeSpread * (isGarage ? 0.82 : 1.0);
        const col = sampleBoostParticleColor(style, customization.boostColor, 'smoke', this.elapsed, Math.random());
        this.particles.spawnAdvanced({
          layer: 'smoke',
          x: _v2.x + (Math.random() - 0.5) * 0.24,
          y: _v2.y + (Math.random() - 0.5) * 0.20,
          z: _v2.z + (Math.random() - 0.5) * 0.24,
          vx: _v3.x * exhaustSpeed * (0.68 + Math.random() * 0.45) + (Math.random() - 0.5) * spread,
          vy: _v3.y * exhaustSpeed * 0.8 + (Math.random() - 0.5) * spread * 0.7 + (style === 'classic_flame' ? 0.8 : 0),
          vz: _v3.z * exhaustSpeed * (0.68 + Math.random() * 0.45) + (Math.random() - 0.5) * spread,
          colorHex: col,
          startScale: spec.smokeStartScale * (0.85 + Math.random() * 0.35),
          endScale: spec.smokeEndScale * (0.85 + Math.random() * 0.4),
          maxAge: spec.smokeLife * (0.8 + Math.random() * 0.4),
          maxAlpha: spec.smokeMaxAlpha,
          gravity: spec.smokeGravity,
          drag: spec.smokeDrag,
          swirl: spec.swirlStrength,
          swirlAxisX: _v3.x,
          swirlAxisY: _v3.y,
          swirlAxisZ: _v3.z,
          spinSpeed: (Math.random() - 0.5) * 3.5,
        });
      }

      // 2. Additive Starflare / Plasma Glow Layer
      const glowCount = sampleCount(spec.glowRate);
      for (let i = 0; i < glowCount; i++) {
        const col = sampleBoostParticleColor(style, customization.boostColor, 'glow', this.elapsed, Math.random());
        const sp = spec.smokeSpread * 0.55;
        this.particles.spawnAdvanced({
          layer: 'glow',
          x: _v2.x + (Math.random() - 0.5) * 0.20,
          y: _v2.y + (Math.random() - 0.5) * 0.16,
          z: _v2.z + (Math.random() - 0.5) * 0.20,
          vx: _v3.x * exhaustSpeed * (0.85 + Math.random() * 0.45) + (Math.random() - 0.5) * sp,
          vy: _v3.y * exhaustSpeed + (Math.random() - 0.5) * sp,
          vz: _v3.z * exhaustSpeed * (0.85 + Math.random() * 0.45) + (Math.random() - 0.5) * sp,
          colorHex: col,
          startScale: spec.glowStartScale * (0.75 + Math.random() * 0.5),
          endScale: spec.glowEndScale,
          maxAge: spec.glowLife * (0.75 + Math.random() * 0.5),
          maxAlpha: spec.glowMaxAlpha,
          gravity: style === 'frost_blizzard' ? 0.6 : -0.6,
          drag: 1.6,
          swirl: spec.swirlStrength * 0.6,
          swirlAxisX: _v3.x,
          swirlAxisY: _v3.y,
          swirlAxisZ: _v3.z,
        });
      }

      // 3. 3D Fresnel Energy Rings (Cyber Pulse, Prisma Astrale, Vuoto Cosmico)
      if (spec.ringRate > 0) {
        const ringCount = sampleCount(spec.ringRate);
        for (let i = 0; i < ringCount; i++) {
          const col = sampleBoostParticleColor(style, customization.boostColor, 'ring', this.elapsed, Math.random());
          this.particles.spawnAdvanced({
            layer: 'ring',
            x: _v2.x,
            y: _v2.y,
            z: _v2.z,
            vx: _v3.x * exhaustSpeed * 0.9,
            vy: _v3.y * exhaustSpeed * 0.9,
            vz: _v3.z * exhaustSpeed * 0.9,
            colorHex: col,
            startScale: spec.ringStartScale,
            endScale: spec.ringEndScale,
            maxAge: spec.ringLife,
            maxAlpha: 0.92,
            gravity: 0,
            drag: 1.8,
            quat,
            spinSpeed: style === 'black_hole' ? 8 : 2.5,
          });
        }
      }

      // 4. 3D Faceted Shards / Ice Crystals / Embers
      if (spec.shardRate > 0) {
        const shardCount = sampleCount(spec.shardRate);
        for (let i = 0; i < shardCount; i++) {
          const col = sampleBoostParticleColor(style, customization.boostColor, 'shard', this.elapsed, Math.random());
          const sp = spec.smokeSpread * 1.15;
          this.particles.spawnAdvanced({
            layer: 'shard',
            x: _v2.x + (Math.random() - 0.5) * 0.25,
            y: _v2.y + (Math.random() - 0.5) * 0.22,
            z: _v2.z + (Math.random() - 0.5) * 0.25,
            vx: _v3.x * exhaustSpeed * (0.7 + Math.random() * 0.55) + (Math.random() - 0.5) * sp,
            vy: _v3.y * exhaustSpeed * 0.8 + (Math.random() - 0.5) * sp + (style === 'classic_flame' ? 1.5 : 0),
            vz: _v3.z * exhaustSpeed * (0.7 + Math.random() * 0.55) + (Math.random() - 0.5) * sp,
            colorHex: col,
            startScale: spec.shardScale * (0.7 + Math.random() * 0.65),
            endScale: 0.03,
            maxAge: spec.shardLife * (0.75 + Math.random() * 0.5),
            maxAlpha: 0.95,
            gravity: style === 'frost_blizzard' ? 2.4 : style === 'classic_flame' ? 3.5 : 0.4,
            drag: 1.4,
            swirl: spec.swirlStrength,
            swirlAxisX: _v3.x,
            swirlAxisY: _v3.y,
            swirlAxisZ: _v3.z,
            spinSpeed: (Math.random() - 0.5) * 14,
          });
        }
      }
    }
  }

  private rotateBall(omega: { x: number; y: number; z: number }, dt: number): void {
    _v2.set(omega.x, omega.y, omega.z);
    const speed = _v2.length();
    if (speed < 1e-6 || dt <= 0) return;
    _q2.setFromAxisAngle(_v2.multiplyScalar(1 / speed), speed * dt);
    this.ballRig.group.quaternion.premultiply(_q2);
  }

  private spawnBoom(x: number, y: number, z: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2;
      const radius = i % 2 === 0 ? 1 : 0.72;
      const px = 256 + Math.cos(angle) * 248 * radius;
      const py = 128 + Math.sin(angle) * 122 * radius;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#ff7a18';
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#431407';
    ctx.stroke();
    ctx.font = 'italic 900 100px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeText('BOOM!', 256, 137);
    ctx.fillStyle = '#fff5b3';
    ctx.fillText('BOOM!', 256, 137);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y + 3.8, z);
    sprite.scale.set(10, 5, 1);
    this.scene.add(sprite);
    this.boomSprites.push({ sprite, age: 0 });
  }

  public dispose(): void {
    soundEngine.setGodModeMusic(false);
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleBlur);

    soundEngine.updateContinuous(false, 0, false);
    this.clearCarRigs();
    if (this.garageRig) {
      this.garageRig.dispose();
      this.garageRig = null;
    }
    this.stadium.dispose();
    this.ballRig.dispose();
    this.particles.dispose();
    this.godModeItem.dispose();
    for (const { sprite } of this.boomSprites) {
      sprite.removeFromParent();
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.boomSprites = [];
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
