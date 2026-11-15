import * as THREE from 'three';
import {
  ARENA_HALF_X,
  ARENA_HALF_Z,
  ARENA_HEIGHT,
  CEILING_RAMP_RADIUS,
  CORNER_CHAMFER,
  GOAL_DEPTH,
  GOAL_HALF_X,
  GOAL_HEIGHT,
  RAMP_RADIUS,
  createBoostPads,
} from '../shared/arena';
import type { ArenaId, BoostPadState } from '../shared/types';
import { boostPadRadius } from '../shared/boostPickup';

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

  // Team-tinted half zones (clear visual distinction between Blue & Orange sides)
  const blueGrad = ctx.createLinearGradient(0, 0, 0, 512);
  blueGrad.addColorStop(0, 'rgba(37, 99, 235, 0.42)');
  blueGrad.addColorStop(0.45, 'rgba(37, 99, 235, 0.14)');
  blueGrad.addColorStop(1, 'rgba(37, 99, 235, 0)');
  ctx.fillStyle = blueGrad;
  ctx.fillRect(0, 0, 1024, 512);

  const orangeGrad = ctx.createLinearGradient(0, 512, 0, 1024);
  orangeGrad.addColorStop(0, 'rgba(234, 88, 12, 0)');
  orangeGrad.addColorStop(0.55, 'rgba(234, 88, 12, 0.14)');
  orangeGrad.addColorStop(1, 'rgba(234, 88, 12, 0.42)');
  ctx.fillStyle = orangeGrad;
  ctx.fillRect(0, 512, 1024, 512);

  // Crisp field lines
  ctx.strokeStyle = isNeo ? 'rgba(186, 230, 253, 0.72)' : 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 7;

  // Outer pitch touchlines
  ctx.strokeRect(28, 28, 968, 968);

  // Midfield line & center circle
  ctx.beginPath();
  ctx.moveTo(28, 512);
  ctx.lineTo(996, 512);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(512, 512, 118, 0, Math.PI * 2);
  ctx.stroke();

  // Inner midfield hexagon emblem
  ctx.strokeStyle = isNeo ? 'rgba(56, 189, 248, 0.6)' : 'rgba(255,255,255,0.45)';
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

  // Team-colored Penalty boxes & painted goal creases
  ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
  ctx.fillRect(282, 28, 460, 148);
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 7;
  ctx.strokeRect(282, 28, 460, 148);

  ctx.fillStyle = 'rgba(249, 115, 22, 0.25)';
  ctx.fillRect(282, 848, 460, 148);
  ctx.strokeStyle = '#fb923c';
  ctx.lineWidth = 7;
  ctx.strokeRect(282, 848, 460, 148);

  // Subtle turf emblems identifying each half
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 44px sans-serif';
  ctx.fillStyle = 'rgba(147, 197, 253, 0.35)';
  ctx.fillText('BLU', 512, 102);
  ctx.fillStyle = 'rgba(253, 186, 116, 0.35)';
  ctx.fillText('ARANCIONE', 512, 922);
  ctx.restore();

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

function createTurfDetail(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    ctx.strokeStyle = i % 2 ? '#999999' : '#666666';
    const x = (i * 73) % 128;
    const y = (i * 47) % 128;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1, y + 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 108);
  tex.anisotropy = 8;
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

  // A real sky dome gives the horizon depth without external textures or requests.
  const skyGeo = new THREE.SphereGeometry(360, 40, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color('#071329') },
      horizon: { value: new THREE.Color('#516b91') },
      daylight: { value: 0 },
    },
    vertexShader: `varying vec3 direction;
      void main() { direction = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 direction;
      uniform vec3 zenith; uniform vec3 horizon; uniform float daylight;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 cell = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x), mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(direction);
        vec3 color = mix(horizon, zenith, pow(max(d.y, 0.0), 0.45));
        float sun = pow(max(dot(d, normalize(vec3(0.5, 0.65, 0.35))), 0.0), 900.0);
        float haze = pow(max(dot(d, normalize(vec3(0.5, 0.65, 0.35))), 0.0), 14.0);
        vec2 cloudUV = d.xz / max(d.y + 0.2, 0.25) * 3.0;
        float cloud = noise(cloudUV) * 0.6 + noise(cloudUV * 2.1) * 0.28 + noise(cloudUV * 4.2) * 0.12;
        color += vec3(0.95, 0.78, 0.52) * (sun + haze * 0.16) * daylight;
        color = mix(color, vec3(0.85, 0.92, 1.0), smoothstep(0.53, 0.8, cloud) * smoothstep(0.05, 0.22, d.y) * 0.28 * daylight);
        vec2 cell = floor(d.xz / max(d.y + 0.35, 0.15) * 320.0);
        float star = step(0.9985, fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453));
        color += star * smoothstep(0.15, 0.6, d.y) * (1.0 - daylight) * 0.55;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  group.add(sky);
  disposables.push(skyGeo, skyMat);

  // Lighting rig (warm key + cool hemisphere + rim)
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85);
  group.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.85);
  keyLight.position.set(48, 76, 38);
  keyLight.castShadow = !isSoftwareGl;
  if (!isSoftwareGl) {
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -98;
    keyLight.shadow.camera.right = 98;
    keyLight.shadow.camera.top = 98;
    keyLight.shadow.camera.bottom = -98;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 220;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
  }
  group.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
  rimLight.position.set(-55, 42, -75);
  group.add(rimLight);

  // Extended surrounding stadium apron (never floating in a void!)
  const apronGeo = new THREE.PlaneGeometry(580, 580);
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
  const turfDetail = createTurfDetail();
  const pitchGeo = new THREE.PlaneGeometry(ARENA_HALF_X * 2, ARENA_HALF_Z * 2);
  pitchGeo.rotateX(-Math.PI / 2);
  const pitchMat = new THREE.MeshStandardMaterial({
    map: pitchTex,
    bumpMap: turfDetail,
    bumpScale: 0.055,
    roughness: 0.72,
    metalness: 0.06,
  });
  const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
  pitchMesh.receiveShadow = !isSoftwareGl;
  group.add(pitchMesh);
  disposables.push(pitchGeo, pitchMat, turfDetail);

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

  // Render the same circular fillet used by resolveArenaSphere. Mitered joins
  // follow the octagon continuously, while both goal mouths stay completely open.
  const perimeter = [
    [-hx, -hz + c], [-hx + c, -hz], [-gx, -hz], [gx, -hz],
    [hx - c, -hz], [hx, -hz + c], [hx, hz - c], [hx - c, hz],
    [gx, hz], [-gx, hz], [-hx + c, hz], [-hx, hz - c],
  ].map(([x, z]) => new THREE.Vector2(x, z));
  const normals = perimeter.map((p, i) => {
    const edge = perimeter[(i + 1) % perimeter.length].clone().sub(p).normalize();
    return new THREE.Vector2(-edge.y, edge.x);
  });
  const insetPoint = (i: number, distance: number) => {
    const prev = normals[(i + normals.length - 1) % normals.length];
    const next = normals[i];
    return perimeter[i].clone().add(prev.clone().add(next).multiplyScalar(distance / (1 + prev.dot(next))));
  };
  const rampMat = new THREE.MeshStandardMaterial({
    color: 0x426078, roughness: 0.58, metalness: 0.28, side: THREE.DoubleSide,
  });
  disposables.push(rampMat);
  for (let segment = 0; segment < perimeter.length; segment++) {
    if (segment === 2 || segment === 8) continue;
    const next = (segment + 1) % perimeter.length;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let j = 0; j <= 24; j++) {
      const angle = j / 24 * Math.PI / 2;
      const distance = RAMP_RADIUS * (1 - Math.sin(angle));
      const y = RAMP_RADIUS * (1 - Math.cos(angle));
      for (const index of [segment, next]) {
        const p = insetPoint(index, distance);
        positions.push(p.x, y + 0.012, p.y);
      }
      if (j < 24) {
        const k = j * 2;
        indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const ramp = new THREE.Mesh(geo, rampMat);
    ramp.receiveShadow = !isSoftwareGl;
    group.add(ramp);
    disposables.push(geo);
    // Three contour lines make the slope readable at driving height.
    for (const angle of [0.08, 0.48, 1.28]) {
      const distance = RAMP_RADIUS * (1 - Math.sin(angle));
      const a = insetPoint(segment, distance);
      const b = insetPoint(next, distance);
      const y = RAMP_RADIUS * (1 - Math.cos(angle)) + 0.045;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, y, a.y), new THREE.Vector3(b.x, y, b.y),
      ]);
      const lineMat = new THREE.LineBasicMaterial({ color: (a.y + b.y) < 0 ? 0x83c9ff : 0xffbd72 });
      group.add(new THREE.Line(lineGeo, lineMat));
      disposables.push(lineGeo, lineMat);
    }
  }

  // Match the tighter physical upper fillet and leave the middle of the roof flat.
  for (let segment = 0; segment < perimeter.length; segment++) {
    const next = (segment + 1) % perimeter.length;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let j = 0; j <= 24; j++) {
      const angle = j / 24 * Math.PI / 2;
      const distance = CEILING_RAMP_RADIUS * (1 - Math.cos(angle));
      const y = ARENA_HEIGHT - CEILING_RAMP_RADIUS + CEILING_RAMP_RADIUS * Math.sin(angle);
      for (const index of [segment, next]) {
        const p = insetPoint(index, distance);
        positions.push(p.x, y, p.y);
      }
      if (j < 24) {
        const k = j * 2;
        indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, rampMat));
    disposables.push(geo);
  }
  const ceilingShape = new THREE.Shape(perimeter.map((_, i) => insetPoint(i, CEILING_RAMP_RADIUS)));
  const ceilingGeo = new THREE.ShapeGeometry(ceilingShape);
  ceilingGeo.rotateX(Math.PI / 2);
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x8bbbd5, map: wallTex, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false, roughness: 0.7,
  });
  const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
  ceiling.position.y = ARENA_HEIGHT;
  group.add(ceiling);
  disposables.push(ceilingGeo, ceilingMat);

  const createGoalSignTexture = (title: string, bgHex: string, borderHex: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = borderHex;
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 256, 66);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  // Build Recessed 3D Goals (Blue at -Z, Orange at +Z) with distinct team frames, beacons & overhead signs
  const buildGoal = (
    zDir: -1 | 1,
    colorHex: number,
    signTitle: string,
    signBgHex: string,
    signBorderHex: string,
  ) => {
    const zLine = zDir * ARENA_HALF_Z;
    const zBack = zDir * (ARENA_HALF_Z + GOAL_DEPTH);
    const frameMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.35,
      metalness: 0.65,
      roughness: 0.25,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: colorHex,
    });
    const netMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      color: colorHex,
      transparent: true,
      opacity: 0.56,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    disposables.push(frameMat, glowMat, netMat);

    // Team-colored Goal posts & crossbar
    const postGeo = new THREE.CylinderGeometry(0.36, 0.36, GOAL_HEIGHT, 12);
    for (const px of [-GOAL_HALF_X, GOAL_HALF_X]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(px, GOAL_HEIGHT / 2, zLine);
      group.add(post);
    }
    const barGeo = new THREE.CylinderGeometry(0.36, 0.36, GOAL_HALF_X * 2 + 0.72, 12);
    barGeo.rotateZ(Math.PI / 2);
    const crossbar = new THREE.Mesh(barGeo, frameMat);
    crossbar.position.set(0, GOAL_HEIGHT, zLine);
    group.add(crossbar);

    // Tall glowing flank beacon pillars outside the posts (visible from anywhere on pitch)
    const beaconGeo = new THREE.BoxGeometry(0.9, GOAL_HEIGHT * 1.85, 0.9);
    for (const bx of [-(GOAL_HALF_X + 1.4), GOAL_HALF_X + 1.4]) {
      const beacon = new THREE.Mesh(beaconGeo, glowMat);
      beacon.position.set(bx, (GOAL_HEIGHT * 1.85) / 2, zLine - zDir * 0.25);
      group.add(beacon);
    }

    // Large 3D Overhead Goal Signboard ("PORTA BLU" / "PORTA ARANCIONE")
    const signTex = createGoalSignTexture(signTitle, signBgHex, signBorderHex);
    const signGeo = new THREE.PlaneGeometry(16, 4);
    const signMat = new THREE.MeshBasicMaterial({
      map: signTex,
      side: THREE.DoubleSide,
    });
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.position.set(0, GOAL_HEIGHT + 3.4, zLine - zDir * 0.3);
    if (zDir === -1) {
      signMesh.rotation.y = 0;
    } else {
      signMesh.rotation.y = Math.PI;
    }
    group.add(signMesh);

    // Bright team-colored goal-line & apron strip
    const lineGeo = new THREE.BoxGeometry(GOAL_HALF_X * 2, 0.09, 0.5);
    const lineStrip = new THREE.Mesh(lineGeo, glowMat);
    lineStrip.position.set(0, 0.045, zLine);
    group.add(lineStrip);

    // Goal floor, back net, side nets, roof net
    const gFloorGeo = new THREE.PlaneGeometry(GOAL_HALF_X * 2, GOAL_DEPTH);
    gFloorGeo.rotateX(-Math.PI / 2);
    const gFloorMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.14,
      roughness: 0.75,
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

    disposables.push(
      postGeo,
      barGeo,
      beaconGeo,
      signTex,
      signGeo,
      signMat,
      lineGeo,
      gFloorGeo,
      gFloorMat,
      gBackGeo,
      gSideGeo,
      gRoofGeo,
    );
  };

  buildGoal(-1, 0x3b82f6, 'PORTA BLU', '#1e3a8a', '#60a5fa'); // Blue goal (-Z)
  buildGoal(1, 0xf97316, 'PORTA ARANCIONE', '#7c2d12', '#fb923c'); // Orange goal (+Z)

  // Glowing Midfield Perimeter Arch Ribbing (landmarks outside the wider field)
  const archMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.75,
    roughness: 0.3,
  });
  const archGeo = new THREE.TorusGeometry(ARENA_HALF_X + 10, 0.85, 8, 36, Math.PI);
  disposables.push(archMat, archGeo);
  for (const az of [-50, 0, 50]) {
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(0, 0, az);
    group.add(arch);
  }

  // Tiered Stadium Grandstands (Sides + End-Zones) outside larger perimeter
  const standGeo = new THREE.BoxGeometry(10, 12, ARENA_HALF_Z * 1.65);
  const endStandGeo = new THREE.BoxGeometry(ARENA_HALF_X * 1.9, 11, 10);
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.85,
  });
  disposables.push(standGeo, endStandGeo, standMat);
  // Individual terraces replace the block silhouette and support the crowd rows.
  const terraceGeo = new THREE.BoxGeometry(1.5, 1, ARENA_HALF_Z * 1.65);
  const endTerraceGeo = new THREE.BoxGeometry(ARENA_HALF_X * 1.9, 1, 1.5);
  const terraceMat = new THREE.MeshStandardMaterial({ color: 0x34445c, roughness: 0.8 });
  disposables.push(terraceGeo, endTerraceGeo, terraceMat);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      const terrace = new THREE.Mesh(terraceGeo, terraceMat);
      const height = 2 + row * 1.55;
      terrace.scale.y = height;
      terrace.position.set(side * (hx + 8.5 + row * 1.5), height / 2, 0);
      group.add(terrace);
      const endTerrace = new THREE.Mesh(endTerraceGeo, terraceMat);
      endTerrace.scale.y = height;
      endTerrace.position.set(0, height / 2, side * (hz + 12 + row * 1.5));
      group.add(endTerrace);
    }
  }
  for (const sx of [-(ARENA_HALF_X + 14), ARENA_HALF_X + 14]) {
    const stand = new THREE.Mesh(standGeo, standMat);
    stand.position.set(sx, 6, 0);
    // The solid backing stays behind the terraces instead of hiding the crowd.
    stand.position.x = Math.sign(sx) * (ARENA_HALF_X + 24);
    group.add(stand);
  }
  for (const sz of [-(ARENA_HALF_Z + 18), ARENA_HALF_Z + 18]) {
    const endStand = new THREE.Mesh(endStandGeo, standMat);
    endStand.position.set(0, 5.5, Math.sign(sz) * (ARENA_HALF_Z + 27));
    group.add(endStand);
  }

  // Exterior City Skyline Silhouettes framing the larger stadium horizon
  const skylineGeo = new THREE.BoxGeometry(14, 42, 14);
  const skylineMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.7,
    metalness: 0.3,
  });
  disposables.push(skylineGeo, skylineMat);
  const skylineCoords: Array<[number, number, number]> = [
    [-108, 22, -124],
    [-55, 32, -138],
    [52, 28, -134],
    [110, 24, -120],
    [-112, 26, 122],
    [-50, 34, 136],
    [56, 26, 132],
    [108, 22, 124],
  ];
  for (const [bx, by, bz] of skylineCoords) {
    const bldg = new THREE.Mesh(skylineGeo, skylineMat);
    bldg.position.set(bx, by, bz);
    bldg.scale.y = by / 21;
    group.add(bldg);
  }

  // Instanced Crowd Spectating Dots in Grandstands
  const crowdGeo = new THREE.BoxGeometry(0.75, 0.75, 0.75);
  const crowdMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const crowdCount = isSoftwareGl ? 560 : 1680;
  const crowdInst = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
  const dummy = new THREE.Object3D();
  const cColor = new THREE.Color();
  for (let i = 0; i < crowdCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const tier = Math.floor(i / 2) % 7;
    dummy.position.set(
      side * (ARENA_HALF_X + 8.5 + tier * 1.5),
      2.6 + tier * 1.55,
      ((i * 29) % 138) - 69,
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

  // 4 Corner Floodlight Towers outside larger stadium corners
  const towerGeo = new THREE.CylinderGeometry(1.0, 1.4, 42, 8);
  const lampGeo = new THREE.BoxGeometry(6.5, 2.6, 1.4);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
  disposables.push(towerGeo, lampGeo, lampMat);

  const towerPositions: Array<[number, number]> = [
    [-(ARENA_HALF_X + 7), -(ARENA_HALF_Z + 5)],
    [ARENA_HALF_X + 7, -(ARENA_HALF_Z + 5)],
    [-(ARENA_HALF_X + 7), ARENA_HALF_Z + 5],
    [ARENA_HALF_X + 7, ARENA_HALF_Z + 5],
  ];
  for (const [tx, tz] of towerPositions) {
    const tower = new THREE.Mesh(towerGeo, archMat);
    tower.position.set(tx, 21, tz);
    group.add(tower);

    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(tx, 41.5, tz);
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
    ring.scale.setScalar(boostPadRadius(pad.isBig) / 0.72);
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
    const day = arenaId === 'mannfield_day';
    skyMat.uniforms.daylight.value = day ? 1 : 0;
    skyMat.uniforms.zenith.value.set(day ? '#1869c4' : arenaId === 'neo_tokyo' ? '#100d2a' : '#071329');
    skyMat.uniforms.horizon.value.set(day ? '#c2e4f4' : arenaId === 'neo_tokyo' ? '#50365f' : '#516b91');
    rampMat.color.setHex(day ? 0x718d97 : 0x426078);

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
