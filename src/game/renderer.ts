import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARENA_HALF_X, ARENA_HALF_Z, ARENA_HEIGHT, CAR_RIDE_HEIGHT, GOAL_HEIGHT } from '../shared/arena';
import { clamp, lerp } from '../shared/math3d';
import { reconcilePredictedSnapshot } from '../shared/netSnapshot';
import { NEUTRAL_INPUT, skipGoalReplay, stepSimulation, type SimulationEvent } from '../shared/physics';
import {
  GOAL_REPLAY_DURATION,
  GoalReplayRecorder,
  sampleReplayFrame,
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

export type ViewportMode = 'title' | 'garage' | 'playing' | 'paused' | 'gameover';

export interface HudTelemetry {
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
  private carRigs = new Map<string, CarVisualRig>();
  private garageRig: CarVisualRig | null = null;
  private garageCustomization: CarCustomization = { ...DEFAULT_CUSTOMIZATION_BLUE };

  private mode: ViewportMode = 'title';
  private localPlayerId = 'local-player';
  private isMultiplayer = false;
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
  private prevInput: PlayerInput = { ...NEUTRAL_INPUT };
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
  public onSendInput?: (input: PlayerInput) => void;
  public onBallCamChange?: (enabled: boolean) => void;
  public onNameplates?: (plates: NameplateProjection[]) => void;
  public onGoalMarkers?: (markers: GoalMarkerProjection[]) => void;
  public onPauseToggle?: () => void;
  public onQuickChatKey?: (slot: number) => void;
  public onSkipReplay?: () => void;

  private hudAccum = 0;
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
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

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

  public setGaragePreview(customization: CarCustomization): void {
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
  }

  public setMode(mode: ViewportMode): void {
    this.mode = mode;
    this.paused = mode === 'paused';

    if (mode === 'title') {
      this.activeState = null;
      this.targetNetState = null;
      if (this.garageRig) {
        this.garageRig.group.visible = false;
        this.garageRig.contactShadow.visible = false;
      }
      this.ballRig.group.visible = true;
      this.ballRig.indicatorRing.visible = true;
      this.spawnTitleShowcaseCars();
      soundEngine.updateContinuous(false, 0, false);
    } else if (mode === 'garage') {
      this.clearCarRigs();
      this.ballRig.group.visible = false;
      this.ballRig.indicatorRing.visible = false;
      this.setGaragePreview(this.garageCustomization);
      soundEngine.updateContinuous(false, 0, false);
    } else {
      if (this.garageRig) {
        this.garageRig.group.visible = false;
        this.garageRig.contactShadow.visible = false;
      }
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

  public startMultiplayerMatch(snapshot: GameStateSnapshot, localId: string): void {
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
    if (!this.activeState) {
      this.activeState = structuredClone(snapshot);
      this.syncCarRigsFromState(this.activeState);
      return;
    }

    // Check if cars roster changed (count or player IDs, e.g. hot-join replacing a bot)
    const rosterChanged =
      this.activeState.cars.length !== snapshot.cars.length ||
      this.activeState.cars.some((car, idx) => car.id !== snapshot.cars[idx]?.id);
    if (rosterChanged) {
      this.activeState = structuredClone(snapshot);
      this.syncCarRigsFromState(this.activeState);
    } else {
      reconcilePredictedSnapshot(this.activeState, snapshot, this.localPlayerId);
    }
  }

  public getCarsSnapshot(): CarState[] {
    return this.activeState ? this.activeState.cars : [];
  }

  public handleSimulationEvents(events: SimulationEvent[], fromLocalPred = false): void {
    for (const ev of events) {
      if (ev.type === 'ball_hit') {
        soundEngine.playBallHit(ev.speed);
        this.particles.spawnBurst(ev.pos.x, ev.pos.y, ev.pos.z, 10, 12, '#fde047', 0.85, 0.38);
        if (ev.speed > 26) this.trauma = Math.min(1, this.trauma + 0.35);
      } else if (ev.type === 'wall_hit') {
        soundEngine.playBallHit(ev.speed * 0.7);
      } else if (ev.type === 'jump' && ev.carId === this.localPlayerId) {
        if (this.isMultiplayer && !fromLocalPred) continue;
        soundEngine.playJump(false);
        this.particles.spawnBurst(ev.pos.x, ev.pos.y, ev.pos.z, 6, 6, '#e2e8f0', 0.65, 0.3);
      } else if (ev.type === 'flip' && ev.carId === this.localPlayerId) {
        if (this.isMultiplayer && !fromLocalPred) continue;
        soundEngine.playJump(true);
        this.particles.spawnBurst(ev.pos.x, ev.pos.y, ev.pos.z, 10, 9, '#38bdf8', 0.75, 0.35);
      } else if (ev.type === 'boost_pickup' && ev.carId === this.localPlayerId) {
        soundEngine.playBoostPickup(ev.isBig);
      } else if (ev.type === 'save') {
        soundEngine.playSave();
      } else if (ev.type === 'countdown') {
        soundEngine.playCountdown(ev.secondsLeft);
      } else if (ev.type === 'demo') {
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
    _q1.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
    _v1.set(0, 0, 1).applyQuaternion(_q1).normalize();
    this.cameraPos.set(car.pos.x - _v1.x * 11.5, car.pos.y + 4.2, car.pos.z - _v1.z * 11.5);
    this.cameraLook.set(car.pos.x + _v1.x * 6, car.pos.y + 1.5, car.pos.z + _v1.z * 6);
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
      this.keys.has('KeyK') || this.keys.has('KeyX') || this.keys.has('ControlLeft');
    const jump = this.keys.has('Space');
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
      e.code === 'ArrowRight'
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
    if (this.mode !== 'playing') return;
    if (e.button === 2) {
      this.mouseBoost = true;
    }
    soundEngine.unlock();
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 2) this.mouseBoost = false;
  };

  private handleContextMenu = (e: MouseEvent) => {
    if (this.mode === 'playing') e.preventDefault();
  };

  private handleBlur = () => {
    this.keys.clear();
    this.mouseBoost = false;
  };

  private bindInputs(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
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
            this.frameId = window.setTimeout(cb, 80);
          }
        };
        this.frameId = window.setTimeout(poll, 5);
      } else {
        this.frameId = window.setTimeout(cb, 80);
      }
    };

    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const rawDt = (now - this.lastTimeMs) / 1000;
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
      this.particles.update(dt);
      return;
    }

    if (this.mode === 'garage' && this.garageRig) {
      const angle = this.elapsed * 0.45;
      this.camera.position.set(3.5 + Math.cos(angle) * 6.2, 2.3, Math.sin(angle) * 6.2);
      this.camera.lookAt(1.3, 0.78, 0);
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
      this.garageRig.group.rotation.y = this.elapsed * 0.25;
      const flamePulse = 0.6 + Math.sin(this.elapsed * 14) * 0.2;
      for (const cone of this.garageRig.flameCones) {
        cone.visible = true;
        cone.scale.set(0.85, 0.85, flamePulse);
      }
      this.stadium.update(this.elapsed, []);
      this.particles.update(dt);
      return;
    }

    if (!this.activeState) return;

    const input = this.mode === 'playing' ? this.readCurrentInput() : NEUTRAL_INPUT;

    if (this.mode === 'playing' && !this.paused) {
      if (this.isMultiplayer) {
        // Stream local inputs immediately on change, at 45Hz while active, and >=10Hz keepalive when idle
        this.inputSendAccum += dt;
        const discreteChanged =
          input.jump !== this.prevInput.jump ||
          input.boost !== this.prevInput.boost ||
          input.handbrake !== this.prevInput.handbrake ||
          input.throttle !== this.prevInput.throttle ||
          input.steer !== this.prevInput.steer ||
          input.roll !== this.prevInput.roll;
        const isNonNeutral =
          input.throttle !== 0 ||
          input.steer !== 0 ||
          input.roll !== 0 ||
          input.boost ||
          input.handbrake ||
          input.jump;
        if (
          discreteChanged ||
          (isNonNeutral && this.inputSendAccum >= 1 / 45) ||
          this.inputSendAccum >= 1 / 10
        ) {
          this.inputSendAccum = 0;
          this.onSendInput?.(input);
        }
        this.prevInput = input;

        // 60fps local prediction only while host packets are fresh (<1.2s); freeze on stall so timelines never diverge
        const netFresh = performance.now() - this.lastNetPacketMs < 1200;
        if (this.activeState.phase === 'active' && netFresh) {
          const predEvents = stepSimulation(
            this.activeState,
            { [this.localPlayerId]: input },
            dt,
            false,
          );
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
    if (this.prevPhase !== 'goal_replay' && phase === 'goal_replay') {
      this.activeReplayClip = this.replayRecorder.captureClip(this.activeState);
      soundEngine.playReplayTransition();
    } else if (this.prevPhase !== 'countdown' && phase === 'countdown') {
      this.activeReplayClip = null;
      this.replayRecorder.clear();
      this.snapCameraBehindLocalCar();
    }
    this.prevPhase = phase;

    if (phase === 'active' || phase === 'goal_scored') {
      this.replayRecorder.record(this.activeState, this.elapsed);
    }

    // Instant Goal Replay Director Playback
    if (phase === 'goal_replay' && this.activeReplayClip) {
      const progress = clamp(1 - this.activeState.phaseTimer / GOAL_REPLAY_DURATION, 0, 1);
      const frame = sampleReplayFrame(this.activeReplayClip, progress);
      if (frame) {
        this.displayBallPos.set(frame.ballPos.x, frame.ballPos.y, frame.ballPos.z);
        this.ballRig.group.position.copy(this.displayBallPos);
        this.ballRig.group.rotation.x += frame.ballAngVel.x * dt * 0.75;
        this.ballRig.group.rotation.y += frame.ballAngVel.y * dt * 0.75;
        this.ballRig.group.rotation.z += frame.ballAngVel.z * dt * 0.75;
        this.ballRig.indicatorRing.position.set(frame.ballPos.x, 0.03, frame.ballPos.z);
        const hScale = clamp(1 - (frame.ballPos.y - 1.65) / 24, 0.35, 1.0);
        this.ballRig.indicatorRing.scale.setScalar(hScale);

        let scorerCarFrame =
          frame.cars.find((c) => c.id === this.activeReplayClip?.scorerId) || frame.cars[0];
        for (const rCar of frame.cars) {
          const rig = this.carRigs.get(rCar.id);
          if (!rig) continue;
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
          for (const cone of rig.flameCones) {
            cone.visible = rCar.supersonic;
            if (rCar.supersonic) cone.scale.set(1, 1, 0.9 + Math.random() * 0.45);
          }
        }

        // Broadcast Director Camera: Tracks Scorer -> Sweeps to Goal-Line Angle
        if (progress < 0.72 && scorerCarFrame) {
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
          this.cameraPos.lerp(_v3, clamp(9 * dt, 0, 1));
          _v1.copy(this.displayBallPos).lerp(_v4, 0.35);
          _v1.y = Math.max(1.2, _v1.y + 0.5);
          this.cameraLook.lerp(_v1, clamp(11 * dt, 0, 1));
        } else {
          const scoredBlueGoal = this.activeReplayClip.goalTeam === 'orange';
          const goalZ = scoredBlueGoal ? -ARENA_HALF_Z : ARENA_HALF_Z;
          const dirInward = scoredBlueGoal ? 1 : -1;
          _v3.set(
            this.displayBallPos.x >= 0 ? -15 : 15,
            6.2,
            goalZ + dirInward * 18,
          );
          this.cameraPos.lerp(_v3, clamp(7 * dt, 0, 1));
          _v1.copy(this.displayBallPos);
          _v1.y = Math.max(1.2, _v1.y);
          this.cameraLook.lerp(_v1, clamp(11 * dt, 0, 1));
        }
        this.camera.fov = lerp(this.camera.fov, 64, clamp(6 * dt, 0, 1));
        this.camera.updateProjectionMatrix();
        this.camera.position.copy(this.cameraPos);
        this.camera.lookAt(this.cameraLook);
      }

      soundEngine.updateContinuous(false, 0, false);
      this.onNameplates?.([]);
      this.onGoalMarkers?.([]);
      this.stadium.update(this.elapsed, this.activeState.boostPads);
      this.particles.update(dt);
      this.hudAccum += dt;
      if (this.hudAccum >= 1 / 15) {
        this.hudAccum = 0;
        this.emitHudNow();
      }
      return;
    }

    // Visual interpolation & boost particle emission
    const interpFactor = this.isMultiplayer ? clamp(1 - Math.exp(-36 * dt), 0, 1) : 1;
    this.displayBallPos.lerp(
      _v1.set(
        this.activeState.ball.pos.x,
        this.activeState.ball.pos.y,
        this.activeState.ball.pos.z,
      ),
      interpFactor,
    );
    this.ballRig.group.position.copy(this.displayBallPos);
    this.ballRig.group.rotation.x += this.activeState.ball.angVel.x * dt;
    this.ballRig.group.rotation.y += this.activeState.ball.angVel.y * dt;
    this.ballRig.group.rotation.z += this.activeState.ball.angVel.z * dt;

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

      const hidden = car.demolishedTimer > 0;
      const carOnWall = car.onGround && car.groundNormal.y < 0.7;
      rig.group.visible = !hidden;
      rig.contactShadow.visible = !hidden && (car.onGround || car.pos.y < 10);

      if (hidden) continue;

      _v1.set(car.pos.x, car.pos.y, car.pos.z);
      _q1.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
      disp.pos.lerp(_v1, interpFactor);
      disp.quat.slerp(_q1, interpFactor);

      rig.group.position.copy(disp.pos);
      rig.group.quaternion.copy(disp.quat);

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

      // Boost flame & particles
      const isBoosting =
        car.id === this.localPlayerId
          ? input.boost && car.boost > 0.2 && this.activeState.phase === 'active'
          : car.supersonic || (car.boost < 99 && Math.hypot(car.vel.x, car.vel.z) > 26);

      for (const cone of rig.flameCones) {
        cone.visible = isBoosting;
        if (isBoosting) {
          cone.scale.set(1, 1, 0.8 + Math.random() * 0.55);
        }
      }

      if (isBoosting && Math.random() < 0.75) {
        _v2.set(0, 0.15, -2.0).applyQuaternion(disp.quat).add(disp.pos);
        _v3.set(0, 0, -8).applyQuaternion(disp.quat);
        this.particles.spawn(
          _v2.x + (Math.random() - 0.5) * 0.35,
          _v2.y + (Math.random() - 0.5) * 0.25,
          _v2.z + (Math.random() - 0.5) * 0.35,
          _v3.x,
          _v3.y + 1.5,
          _v3.z,
          car.customization.boostColor,
          0.95,
          0.05,
          0.26,
        );
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

    this.onNameplates?.(plates);

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
    this.onGoalMarkers?.(goalMarkers);

    // Camera Follow Rig (Ball Cam or Car Cam)
    if (localCar) {
      const disp = this.displayCars.get(localCar.id);
      const carPos = disp ? disp.pos : _v1.set(localCar.pos.x, localCar.pos.y, localCar.pos.z);
      const carQuat = disp
        ? disp.quat
        : _q2.set(localCar.quat.x, localCar.quat.y, localCar.quat.z, localCar.quat.w);
      const onWall = localCar.onGround && localCar.groundNormal.y < 0.7;
      _v4.set(localCar.groundNormal.x, localCar.groundNormal.y, localCar.groundNormal.z).normalize();

      if (this.ballCam) {
        // Direction from ball to car (horizontal)
        _v2.subVectors(carPos, this.displayBallPos);
        _v2.y = 0;
        if (_v2.lengthSq() < 0.2) _v2.set(0, 0, -1);
        _v2.normalize();

        // Desired camera offset behind car relative to ball line (pull inward when riding a wall)
        _v3.copy(carPos).addScaledVector(_v2, 10.6);
        if (onWall) {
          _v3.addScaledVector(_v4, 4.8);
          _v3.y = clamp(carPos.y + 2.6, 2.2, ARENA_HEIGHT - 2.0);
        } else {
          _v3.y = clamp(carPos.y + 3.85, 2.2, ARENA_HEIGHT - 2.0);
        }
        _v3.x = clamp(_v3.x, -ARENA_HALF_X + 1.5, ARENA_HALF_X - 1.5);
        _v3.z = clamp(_v3.z, -ARENA_HALF_Z + 1.5, ARENA_HALF_Z - 1.5);

        const camDamp = clamp(1 - Math.exp(-12 * dt), 0, 1);
        this.cameraPos.lerp(_v3, camDamp);

        // Look midway toward ball while keeping car clearly framed in lower third
        _v2.copy(this.displayBallPos).lerp(carPos, 0.34);
        _v2.y = Math.max(1.2, _v2.y + 0.65);
        this.cameraLook.lerp(_v2, clamp(1 - Math.exp(-14 * dt), 0, 1));
      } else {
        // Car Cam: aligned behind car heading (with wall-normal pull inward on walls)
        _v2.set(0, 0, 1).applyQuaternion(carQuat);
        if (onWall) {
          _v2.normalize();
          _v3.copy(carPos).addScaledVector(_v2, -10.4).addScaledVector(_v4, 4.4);
          _v3.y = clamp(_v3.y + 1.1, 2.0, ARENA_HEIGHT - 2.0);
          _v3.x = clamp(_v3.x, -ARENA_HALF_X + 1.5, ARENA_HALF_X - 1.5);
          _v3.z = clamp(_v3.z, -ARENA_HALF_Z + 1.5, ARENA_HALF_Z - 1.5);
          this.cameraPos.lerp(_v3, clamp(1 - Math.exp(-11 * dt), 0, 1));

          _v2.multiplyScalar(9).add(carPos).addScaledVector(_v4, 1.4);
          this.cameraLook.lerp(_v2, clamp(1 - Math.exp(-14 * dt), 0, 1));
        } else {
          _v2.y = 0;
          if (_v2.lengthSq() < 0.05) _v2.set(0, 0, 1);
          _v2.normalize();

          _v3.copy(carPos).addScaledVector(_v2, -10.8);
          _v3.y = clamp(carPos.y + 3.6, 2.0, ARENA_HEIGHT - 2.0);
          _v3.x = clamp(_v3.x, -ARENA_HALF_X + 1.5, ARENA_HALF_X - 1.5);
          _v3.z = clamp(_v3.z, -ARENA_HALF_Z + 1.5, ARENA_HALF_Z - 1.5);

          this.cameraPos.lerp(_v3, clamp(1 - Math.exp(-11 * dt), 0, 1));

          _v2.multiplyScalar(9).add(carPos);
          _v2.y += 1.4;
          this.cameraLook.lerp(_v2, clamp(1 - Math.exp(-14 * dt), 0, 1));
        }
      }

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
      soundEngine.updateContinuous(this.mode === 'playing' && !this.paused, speed, isActiveBoost);
    }

    this.stadium.update(this.elapsed, this.activeState.boostPads);
    this.particles.update(dt);

    // Throttle React HUD updates to <= 15Hz (only discrete/telemetry refresh)
    this.hudAccum += dt;
    if (this.hudAccum >= 1 / 15 && localCar && this.activeState) {
      this.hudAccum = 0;
      const speed = Math.hypot(localCar.vel.x, localCar.vel.y, localCar.vel.z);
      const onWall = localCar.onGround && localCar.groundNormal.y < 0.7;
      this.onHudUpdate?.({
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

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
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
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
