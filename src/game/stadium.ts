import * as THREE from 'three';
import {
  ARENA_HALF_X,
  ARENA_HALF_Z,
  ARENA_HEIGHT,
  CORNER_CHAMFER,
  GOAL_DEPTH,
  GOAL_HALF_X,
  GOAL_HEIGHT,
  createBoostPads,
} from '../shared/arena';
import type { ArenaId, BoostPadState } from '../shared/types';

export interface StadiumRig {
  group: THREE.Group;
  boostPadVisuals: Array<{
    id: number;
    isBig: boolean;
    orb: THREE.Mesh | null;
    ring: THREE.Mesh;
  }>;
  setArenaTheme: (arenaId: ArenaId) => void;
  update: (time: number, pads: BoostPadState[]) => void;
  dispose: () => void;
}

function createPitchTexture(arenaId: ArenaId): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const isDay = arenaId === 'mannfield_day';
  const isNeo = arenaId === 'neo_tokyo';

  // Alternating mowed grass stripes
  const stripeCount = 14;
  const stripeH = canvas.height / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    if (isNeo) {
      ctx.fillStyle = i % 2 === 0 ? '#111827' : '#162033';
    } else if (isDay) {
      ctx.fillStyle = i % 2 === 0 ? '#1f6f3b' : '#257d44';
    } else {
      ctx.fillStyle = i % 2 === 0 ? '#164d32' : '#1b5a3b';
    }
    ctx.fillRect(0, i * stripeH, canvas.width, stripeH + 1);
  }

  // Subtle turf grain
  ctx.fillStyle = isNeo ? 'rgba(56, 189, 248, 0.03)' : 'rgba(255,255,255,0.025)';
  for (let i = 0; i < 1600; i++) {
    ctx.fillRect((i * 197) % 1024, (i * 313) % 1024, 3, 2);
  }

  // Team-tinted half zones
  const blueGrad = ctx.createLinearGradient(0, 0, 0, 512);
  blueGrad.addColorStop(0, 'rgba(37, 99, 235, 0.24)');
  blueGrad.addColorStop(1, 'rgba(37, 99, 235, 0)');
  ctx.fillStyle = blueGrad;
  ctx.fillRect(0, 0, 1024, 512);

  const orangeGrad = ctx.createLinearGradient(0, 512, 0, 1024);
  orangeGrad.addColorStop(0, 'rgba(234, 88, 12, 0)');
  orangeGrad.addColorStop(1, 'rgba(234, 88, 12, 0.24)');
  ctx.fillStyle = orangeGrad;
  ctx.fillRect(0, 512, 1024, 512);

  // Crisp field lines
  ctx.strokeStyle = isNeo ? 'rgba(186, 230, 253, 0.72)' : 'rgba(255, 255, 255, 0.78)';
  ctx.lineWidth = 7;

  // Outer pitch touchlines
  ctx.strokeRect(32, 32, 960, 960);

  // Midfield line & center circle
  ctx.beginPath();
  ctx.moveTo(32, 512);
  ctx.lineTo(992, 512);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(512, 512, 118, 0, Math.PI * 2);
  ctx.stroke();

  // Inner midfield hexagon emblem
  ctx.strokeStyle = isNeo ? 'rgba(56, 189, 248, 0.6)' : 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = 512 + Math.cos(a) * 58;
    const y = 512 + Math.sin(a) * 58;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  // Penalty boxes
  ctx.strokeStyle = isNeo ? 'rgba(186, 230, 253, 0.65)' : 'rgba(255, 255, 255, 0.72)';
  ctx.lineWidth = 6;
  ctx.strokeRect(272, 32, 480, 155);
  ctx.strokeRect(272, 837, 480, 155);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createWallGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(148, 210, 255, 0.34)';
  ctx.lineWidth = 2;

  const r = 32;
  const dx = r * 1.5;
  const dy = r * Math.sqrt(3);
  for (let row = -1; row < 10; row++) {
    for (let col = -1; col < 10; col++) {
      const cx = col * dx;
      const cy = row * dy + (col % 2 === 0 ? 0 : dy / 2);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 4);
  return tex;
}

function createSoccerBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, 512, 256);

  // Geometric tech-panel pentagons & glowing seams
  ctx.fillStyle = '#1e293b';
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const cx = x * 64 + (y % 2 === 0 ? 16 : 48);
      const cy = y * 64 + 32;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const px = cx + Math.cos(a) * 18;
        const py = cy + Math.sin(a) * 18;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // Cyan / Orange tech equator band
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSoccerBallMesh(isSoftwareGl: boolean): {
  group: THREE.Group;
  indicatorRing: THREE.Mesh;
  dispose: () => void;
} {
  const group = new THREE.Group();
  const ballTex = createSoccerBallTexture();
  const sphereGeo = new THREE.SphereGeometry(1.65, 28, 22);
  const ballMat = new THREE.MeshPhysicalMaterial({
    map: ballTex,
    roughness: 0.28,
    metalness: 0.35,
    clearcoat: 0.65,
    clearcoatRoughness: 0.2,
  });
  const mesh = new THREE.Mesh(sphereGeo, ballMat);
  mesh.castShadow = !isSoftwareGl;
  mesh.receiveShadow = !isSoftwareGl;
  group.add(mesh);

  // Glowing ground projection ring directly beneath ball on turf
  const ringGeo = new THREE.RingGeometry(1.3, 1.7, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const indicatorRing = new THREE.Mesh(ringGeo, ringMat);
  indicatorRing.position.y = 0.03;

  return {
    group,
    indicatorRing,
    dispose: () => {
      ballTex.dispose();
      sphereGeo.dispose();
      ballMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}

export function buildStadium(
  scene: THREE.Scene,
  isSoftwareGl: boolean,
  initialTheme: ArenaId = 'dfh_night',
): StadiumRig {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // Lighting rig (warm key + cool hemisphere + rim)
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85);
  group.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.85);
  keyLight.position.set(36, 58, 28);
  keyLight.castShadow = !isSoftwareGl;
  if (!isSoftwareGl) {
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -62;
    keyLight.shadow.camera.right = 62;
    keyLight.shadow.camera.top = 62;
    keyLight.shadow.camera.bottom = -62;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 150;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
  }
  group.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
  rimLight.position.set(-40, 32, -55);
  group.add(rimLight);

  // Extended surrounding stadium apron (never floating in a void!)
  const apronGeo = new THREE.PlaneGeometry(420, 420);
  apronGeo.rotateX(-Math.PI / 2);
  const apronMat = new THREE.MeshStandardMaterial({
    color: 0x0b1220,
    roughness: 0.9,
    metalness: 0.05,
  });
  const apron = new THREE.Mesh(apronGeo, apronMat);
  apron.position.y = -0.15;
  group.add(apron);
  disposables.push(apronGeo, apronMat);

  // Main Pitch Floor
  let pitchTex = createPitchTexture(initialTheme);
  const pitchGeo = new THREE.PlaneGeometry(ARENA_HALF_X * 2, ARENA_HALF_Z * 2);
  pitchGeo.rotateX(-Math.PI / 2);
  const pitchMat = new THREE.MeshStandardMaterial({
    map: pitchTex,
    roughness: 0.72,
    metalness: 0.06,
  });
  const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
  pitchMesh.receiveShadow = !isSoftwareGl;
  group.add(pitchMesh);
  disposables.push(pitchGeo, pitchMat);

  // Octagonal Stadium Barrier Walls (translucent hex energy glass + lower neon kickplate)
  const wallTex = createWallGridTexture();
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    color: 0x93c5fd,
    transparent: true,
    opacity: 0.34,
    roughness: 0.25,
    metalness: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  disposables.push(wallTex, wallMat);

  const addWallSegment = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    height = ARENA_HEIGHT,
    yBase = 0,
    colorTint?: number,
  ) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const geo = new THREE.PlaneGeometry(len, height);
    const mat = colorTint
      ? new THREE.MeshStandardMaterial({
          map: wallTex,
          color: colorTint,
          transparent: true,
          opacity: 0.38,
          roughness: 0.25,
          metalness: 0.4,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      : wallMat;
    if (colorTint) disposables.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x1 + x2) / 2, yBase + height / 2, (z1 + z2) / 2);
    mesh.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    group.add(mesh);
    disposables.push(geo);

    // Solid bottom steel kickplate rail for crisp visual grounding
    const railGeo = new THREE.BoxGeometry(len, 1.1, 0.55);
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.6,
    });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set((x1 + x2) / 2, yBase + 0.55, (z1 + z2) / 2);
    rail.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    group.add(rail);
    disposables.push(railGeo, railMat);
  };

  const hx = ARENA_HALF_X;
  const hz = ARENA_HALF_Z;
  const c = CORNER_CHAMFER;

  // Left & Right sidelines
  addWallSegment(-hx, -hz + c, -hx, hz - c);
  addWallSegment(hx, -hz + c, hx, hz - c);

  // 45-degree corner chamfers
  addWallSegment(-hx, -hz + c, -hx + c, -hz, ARENA_HEIGHT, 0, 0x3b82f6);
  addWallSegment(hx - c, -hz, hx, -hz + c, ARENA_HEIGHT, 0, 0x3b82f6);
  addWallSegment(-hx, hz - c, -hx + c, hz, ARENA_HEIGHT, 0, 0xf97316);
  addWallSegment(hx - c, hz, hx, hz - c, ARENA_HEIGHT, 0, 0xf97316);

  // End walls flanking the goal mouths + wall above crossbar
  const gx = GOAL_HALF_X;
  // Blue end (-Z)
  addWallSegment(-hx + c, -hz, -gx, -hz, ARENA_HEIGHT, 0, 0x3b82f6);
  addWallSegment(gx, -hz, hx - c, -hz, ARENA_HEIGHT, 0, 0x3b82f6);
  addWallSegment(-gx, -hz, gx, -hz, ARENA_HEIGHT - GOAL_HEIGHT, GOAL_HEIGHT, 0x3b82f6);
  // Orange end (+Z)
  addWallSegment(-hx + c, hz, -gx, hz, ARENA_HEIGHT, 0, 0xf97316);
  addWallSegment(gx, hz, hx - c, hz, ARENA_HEIGHT, 0, 0xf97316);
  addWallSegment(-gx, hz, gx, hz, ARENA_HEIGHT - GOAL_HEIGHT, GOAL_HEIGHT, 0xf97316);

  // Build Recessed 3D Goals (Blue at -Z, Orange at +Z)
  const buildGoal = (zDir: -1 | 1, colorHex: number) => {
    const zLine = zDir * ARENA_HALF_Z;
    const zBack = zDir * (ARENA_HALF_Z + GOAL_DEPTH);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.85,
      roughness: 0.22,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: colorHex,
    });
    const netMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      color: colorHex,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    disposables.push(frameMat, glowMat, netMat);

    // Goal posts & crossbar
    const postGeo = new THREE.CylinderGeometry(0.28, 0.28, GOAL_HEIGHT, 12);
    for (const px of [-GOAL_HALF_X, GOAL_HALF_X]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(px, GOAL_HEIGHT / 2, zLine);
      group.add(post);
    }
    const barGeo = new THREE.CylinderGeometry(0.28, 0.28, GOAL_HALF_X * 2 + 0.56, 12);
    barGeo.rotateZ(Math.PI / 2);
    const crossbar = new THREE.Mesh(barGeo, frameMat);
    crossbar.position.set(0, GOAL_HEIGHT, zLine);
    group.add(crossbar);

    // Neon goal-line strip
    const lineGeo = new THREE.BoxGeometry(GOAL_HALF_X * 2, 0.08, 0.25);
    const lineStrip = new THREE.Mesh(lineGeo, glowMat);
    lineStrip.position.set(0, 0.04, zLine);
    group.add(lineStrip);

    // Goal floor, back net, side nets, roof net
    const gFloorGeo = new THREE.PlaneGeometry(GOAL_HALF_X * 2, GOAL_DEPTH);
    gFloorGeo.rotateX(-Math.PI / 2);
    const gFloorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.7,
    });
    const gFloor = new THREE.Mesh(gFloorGeo, gFloorMat);
    gFloor.position.set(0, 0.02, (zLine + zBack) / 2);
    group.add(gFloor);

    const gBackGeo = new THREE.PlaneGeometry(GOAL_HALF_X * 2, GOAL_HEIGHT);
    const gBack = new THREE.Mesh(gBackGeo, netMat);
    gBack.position.set(0, GOAL_HEIGHT / 2, zBack);
    group.add(gBack);

    const gSideGeo = new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HEIGHT);
    for (const sx of [-GOAL_HALF_X, GOAL_HALF_X]) {
      const gSide = new THREE.Mesh(gSideGeo, netMat);
      gSide.position.set(sx, GOAL_HEIGHT / 2, (zLine + zBack) / 2);
      gSide.rotation.y = Math.PI / 2;
      group.add(gSide);
    }

    const gRoofGeo = new THREE.PlaneGeometry(GOAL_HALF_X * 2, GOAL_DEPTH);
    gRoofGeo.rotateX(Math.PI / 2);
    const gRoof = new THREE.Mesh(gRoofGeo, netMat);
    gRoof.position.set(0, GOAL_HEIGHT, (zLine + zBack) / 2);
    group.add(gRoof);

    disposables.push(postGeo, barGeo, lineGeo, gFloorGeo, gFloorMat, gBackGeo, gSideGeo, gRoofGeo);
  };

  buildGoal(-1, 0x3b82f6); // Blue goal (-Z)
  buildGoal(1, 0xf97316); // Orange goal (+Z)

  // Glowing Midfield Perimeter Arch Ribbing (landmarks visible from any camera angle)
  const archMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.75,
    roughness: 0.3,
  });
  const archGeo = new THREE.TorusGeometry(48, 0.65, 8, 36, Math.PI);
  disposables.push(archMat, archGeo);
  for (const az of [-34, 0, 34]) {
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(0, 0, az);
    group.add(arch);
  }

  // Tiered Stadium Grandstands (Sides + End-Zones) outside perimeter
  const standGeo = new THREE.BoxGeometry(8, 10, 92);
  const endStandGeo = new THREE.BoxGeometry(82, 9, 8);
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.85,
  });
  disposables.push(standGeo, endStandGeo, standMat);
  for (const sx of [-52, 52]) {
    const stand = new THREE.Mesh(standGeo, standMat);
    stand.position.set(sx, 5, 0);
    group.add(stand);
  }
  for (const sz of [-72, 72]) {
    const endStand = new THREE.Mesh(endStandGeo, standMat);
    endStand.position.set(0, 4.5, sz);
    group.add(endStand);
  }

  // Exterior City Skyline Silhouettes framing the stadium horizon
  const skylineGeo = new THREE.BoxGeometry(12, 36, 12);
  const skylineMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.7,
    metalness: 0.3,
  });
  disposables.push(skylineGeo, skylineMat);
  const skylineCoords: Array<[number, number, number]> = [
    [-75, 18, -88],
    [-40, 26, -102],
    [38, 24, -98],
    [76, 20, -86],
    [-78, 22, 86],
    [-36, 28, 100],
    [40, 22, 96],
    [74, 18, 88],
  ];
  for (const [bx, by, bz] of skylineCoords) {
    const bldg = new THREE.Mesh(skylineGeo, skylineMat);
    bldg.position.set(bx, by, bz);
    bldg.scale.y = by / 18;
    group.add(bldg);
  }

  // Instanced Crowd Spectating Dots in Grandstands
  const crowdGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const crowdMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const crowdCount = 260;
  const crowdInst = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
  const dummy = new THREE.Object3D();
  const cColor = new THREE.Color();
  for (let i = 0; i < crowdCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const tier = i % 5;
    dummy.position.set(
      side * (47.8 + tier * 1.1),
      2.2 + tier * 1.6,
      ((i * 19) % 86) - 43,
    );
    dummy.updateMatrix();
    crowdInst.setMatrixAt(i, dummy.matrix);
    cColor.setHex(i % 3 === 0 ? 0x60a5fa : i % 3 === 1 ? 0xfb923c : 0xe2e8f0);
    crowdInst.setColorAt(i, cColor);
  }
  crowdInst.instanceMatrix.needsUpdate = true;
  if (crowdInst.instanceColor) crowdInst.instanceColor.needsUpdate = true;
  crowdInst.computeBoundingSphere();
  group.add(crowdInst);
  disposables.push(crowdGeo, crowdMat);

  // 4 Corner Floodlight Towers (tall spawn landmarks)
  const towerGeo = new THREE.CylinderGeometry(0.8, 1.2, 34, 8);
  const lampGeo = new THREE.BoxGeometry(5.5, 2.2, 1.2);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
  disposables.push(towerGeo, lampGeo, lampMat);

  const towerPositions: Array<[number, number]> = [
    [-46, -54],
    [46, -54],
    [-46, 54],
    [46, 54],
  ];
  for (const [tx, tz] of towerPositions) {
    const tower = new THREE.Mesh(towerGeo, archMat);
    tower.position.set(tx, 17, tz);
    group.add(tower);

    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(tx, 33.5, tz);
    lamp.lookAt(0, 0, 0);
    group.add(lamp);
  }

  // 34 Boost Pads (6 big spinning orbs + 28 glowing floor sockets)
  const padBaseGeo = new THREE.CylinderGeometry(0.95, 1.15, 0.12, 14);
  const padBaseMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.7,
    roughness: 0.35,
  });
  const orbGeo = new THREE.OctahedronGeometry(0.68, 1);
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.4,
  });
  const ringGeo = new THREE.RingGeometry(0.42, 0.72, 16);
  ringGeo.rotateX(-Math.PI / 2);
  disposables.push(padBaseGeo, padBaseMat, orbGeo, orbMat, ringGeo);

  const padTemplates = createBoostPads();
  const boostPadVisuals: StadiumRig['boostPadVisuals'] = [];

  for (const pad of padTemplates) {
    const base = new THREE.Mesh(padBaseGeo, padBaseMat);
    base.position.set(pad.pos.x, 0.06, pad.pos.z);
    base.scale.setScalar(pad.isBig ? 1.25 : 0.72);
    group.add(base);

    const rMat = new THREE.MeshBasicMaterial({
      color: pad.isBig ? 0xfbbf24 : 0xf59e0b,
      side: THREE.DoubleSide,
    });
    disposables.push(rMat);

    const ring = new THREE.Mesh(ringGeo, rMat);
    ring.position.set(pad.pos.x, 0.13, pad.pos.z);
    ring.scale.setScalar(pad.isBig ? 1.35 : 0.78);
    group.add(ring);

    let orb: THREE.Mesh | null = null;
    if (pad.isBig) {
      orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.set(pad.pos.x, 1.15, pad.pos.z);
      group.add(orb);
    }

    boostPadVisuals.push({
      id: pad.id,
      isBig: pad.isBig,
      orb,
      ring,
    });
  }

  const applyTheme = (arenaId: ArenaId) => {
    const newTex = createPitchTexture(arenaId);
    pitchMat.map = newTex;
    pitchMat.needsUpdate = true;
    pitchTex.dispose();
    pitchTex = newTex;

    if (arenaId === 'mannfield_day') {
      scene.background = new THREE.Color(0x60a5fa);
      scene.fog = new THREE.FogExp2(0x60a5fa, 0.0042);
      hemiLight.color.setHex(0xe0f2fe);
      hemiLight.groundColor.setHex(0x1e3a2f);
      hemiLight.intensity = 1.05;
      keyLight.color.setHex(0xfffbeb);
      keyLight.intensity = 2.1;
      apronMat.color.setHex(0x164e32);
    } else if (arenaId === 'neo_tokyo') {
      scene.background = new THREE.Color(0x0b0f1d);
      scene.fog = new THREE.FogExp2(0x0b0f1d, 0.0052);
      hemiLight.color.setHex(0x38bdf8);
      hemiLight.groundColor.setHex(0x090d16);
      hemiLight.intensity = 0.9;
      keyLight.color.setHex(0xe0f2fe);
      keyLight.intensity = 1.75;
      apronMat.color.setHex(0x070a14);
    } else {
      // dfh_night
      scene.background = new THREE.Color(0x0a1324);
      scene.fog = new THREE.FogExp2(0x0a1324, 0.0048);
      hemiLight.color.setHex(0x93c5fd);
      hemiLight.groundColor.setHex(0x111827);
      hemiLight.intensity = 0.9;
      keyLight.color.setHex(0xfff3d6);
      keyLight.intensity = 1.9;
      apronMat.color.setHex(0x0b1220);
    }
  };

  applyTheme(initialTheme);
  scene.add(group);

  return {
    group,
    boostPadVisuals,
    setArenaTheme: applyTheme,
    update: (time: number, pads: BoostPadState[]) => {
      for (let i = 0; i < boostPadVisuals.length; i++) {
        const vis = boostPadVisuals[i];
        const pad = pads[i];
        const isActive = pad ? pad.active : true;
        vis.ring.visible = isActive;
        if (vis.orb) {
          vis.orb.visible = isActive;
          if (isActive) {
            vis.orb.rotation.y = time * 2.2 + i;
            vis.orb.position.y = 1.12 + Math.sin(time * 3.4 + i) * 0.16;
          }
        }
      }
    },
    dispose: () => {
      pitchTex.dispose();
      for (const d of disposables) d.dispose();
      scene.remove(group);
    },
  };
}
