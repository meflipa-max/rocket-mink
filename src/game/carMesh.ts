import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  BODY_GEOMETRY_SPECS,
  WINDOW_TINT_OPTIONS,
  wheelCenterY,
  type CarBodySpec,
} from '../shared/customization';
import type { CarBodyStyle, CarCustomization, SpoilerStyle, TopperStyle } from '../shared/types';

export interface CarVisualRig {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  wheelPivots: THREE.Group[]; // [FL, FR, RL, RR]
  wheelMeshes: THREE.Group[];
  flameCones: THREE.Mesh[];
  innerFlameCones: THREE.Mesh[];
  primaryMat: THREE.MeshPhysicalMaterial;
  accentMat: THREE.MeshStandardMaterial;
  flameMat: THREE.MeshBasicMaterial;
  innerFlameMat: THREE.MeshBasicMaterial;
  contactShadow: THREE.Mesh;
  dispose: () => void;
}

function createDecalTexture(
  primaryColor: string,
  accentColor: string,
  decal: CarCustomization['decal'],
  paintFinish: NonNullable<CarCustomization['paintFinish']>,
): THREE.CanvasTexture {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = primaryColor;
  ctx.fillRect(0, 0, S, S);

  if (decal === 'stripes') {
    ctx.fillStyle = accentColor;
    ctx.fillRect(172, 0, 56, S);
    ctx.fillRect(284, 0, 56, S);
    // Crisp outer racing pinstripes
    ctx.fillRect(150, 0, 10, S);
    ctx.fillRect(352, 0, 10, S);
  } else if (decal === 'flames') {
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(0, S);
    ctx.lineTo(0, 235);
    ctx.quadraticCurveTo(88, 145, 142, 282);
    ctx.quadraticCurveTo(212, 82, 256, 248);
    ctx.quadraticCurveTo(300, 82, 370, 282);
    ctx.quadraticCurveTo(424, 145, S, 235);
    ctx.lineTo(S, S);
    ctx.closePath();
    ctx.fill();

    // Inner bright flame tongues
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(0, S);
    ctx.lineTo(0, 325);
    ctx.quadraticCurveTo(96, 260, 148, 360);
    ctx.quadraticCurveTo(222, 200, 256, 330);
    ctx.quadraticCurveTo(290, 200, 364, 360);
    ctx.quadraticCurveTo(416, 260, S, 325);
    ctx.lineTo(S, S);
    ctx.closePath();
    ctx.fill();
  } else if (decal === 'cyber') {
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(92, 0);
    ctx.lineTo(92, 178);
    ctx.lineTo(164, 250);
    ctx.lineTo(164, S);
    ctx.moveTo(420, 0);
    ctx.lineTo(420, 178);
    ctx.lineTo(348, 250);
    ctx.lineTo(348, S);
    ctx.moveTo(256, 48);
    ctx.lineTo(256, 464);
    ctx.stroke();

    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(32, 120);
    ctx.lineTo(164, 120);
    ctx.moveTo(480, 390);
    ctx.lineTo(348, 390);
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.fillRect(224, 212, 64, 64);
    ctx.fillRect(148, 344, 32, 32);
    ctx.fillRect(332, 136, 32, 32);
  } else if (decal === 'wings') {
    ctx.fillStyle = accentColor;
    for (const offset of [78, 232, 386]) {
      ctx.beginPath();
      ctx.moveTo(256, offset - 60);
      ctx.lineTo(476, offset + 48);
      ctx.lineTo(476, offset + 102);
      ctx.lineTo(256, offset - 8);
      ctx.lineTo(36, offset + 102);
      ctx.lineTo(36, offset + 48);
      ctx.closePath();
      ctx.fill();
    }
  } else if (decal === 'checkers') {
    const cell = 32;
    for (let y = 0; y < S; y += cell) {
      for (let x = 0; x < S; x += cell) {
        const row = y / cell;
        const col = x / cell;
        // Concentrated along flanks and rear deck
        const inBand = (x < 160 || x >= 352) || y > 320;
        if (inBand && (row + col) % 2 === 0) {
          ctx.fillStyle = accentColor;
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
    ctx.fillStyle = accentColor;
    ctx.fillRect(244, 0, 24, S);
  } else if (decal === 'lightning') {
    ctx.fillStyle = accentColor;
    const drawBolt = (cx: number, scale: number) => {
      ctx.beginPath();
      ctx.moveTo(cx + 24 * scale, 0);
      ctx.lineTo(cx - 44 * scale, 210);
      ctx.lineTo(cx + 12 * scale, 210);
      ctx.lineTo(cx - 38 * scale, 390);
      ctx.lineTo(cx + 48 * scale, 240);
      ctx.lineTo(cx - 6 * scale, 240);
      ctx.lineTo(cx + 52 * scale, 0);
      ctx.closePath();
      ctx.fill();
    };
    drawBolt(256, 1.35);
    drawBolt(104, 0.75);
    drawBolt(408, 0.75);
  } else if (decal === 'carbon_fade') {
    // Twill carbon weave across upper/rear section fading cleanly into paint
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 210, S, S - 210);
    for (let y = 210; y < S; y += 16) {
      for (let x = 0; x < S; x += 16) {
        ctx.fillStyle = ((x + y) / 16) % 2 === 0 ? '#1e293b' : '#090d16';
        ctx.fillRect(x, y, 8, 8);
        ctx.fillRect(x + 8, y + 8, 8, 8);
      }
    }
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 198, S, 18);
    ctx.fillRect(236, 0, 40, 200);
  }

  // Subtle hood/panel seam lines for machined automotive realism
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 168);
  ctx.lineTo(S, 168);
  ctx.moveTo(0, 356);
  ctx.lineTo(S, 356);
  ctx.stroke();

  // Paint finish metallic micro-flake
  const flakeAlpha =
    paintFinish === 'metallic' || paintFinish === 'pearlescent'
      ? 0.08
      : paintFinish === 'chrome'
        ? 0.04
        : paintFinish === 'matte'
          ? 0.025
          : 0.03;
  ctx.fillStyle = `rgba(255,255,255,${flakeAlpha})`;
  for (let i = 0; i < 360; i++) {
    ctx.fillRect((i * 97) % S, (i * 173) % S, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.68)');
  grad.addColorStop(0.65, 'rgba(0,0,0,0.30)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createUnderglowTexture(hexColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const col = new THREE.Color(hexColor);
  const r = Math.round(col.r * 255);
  const g = Math.round(col.g * 255);
  const b = Math.round(col.b * 255);
  const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.42)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Extrudes a 2D side silhouette (X = Z forward/back, Y = height) symmetrically around X=0
 * WITHOUT shifting Z/Y via geo.center(), so exact coordinates match attached car parts.
 */
function extrudeSideProfile(
  points: Array<[number, number]>,
  width: number,
  bevelThickness = 0.08,
  bevelSize = 0.06,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();

  const innerDepth = Math.max(0.12, width - bevelThickness * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerDepth,
    bevelEnabled: bevelThickness > 0,
    bevelThickness,
    bevelSize,
    bevelSegments: 3,
  });

  // Center only along extrusion Z axis, then rotate -PI/2 around Y so Shape.X -> World.+Z (front)
  geo.translate(0, 0, -innerDepth / 2);
  geo.rotateY(-Math.PI / 2);

  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < posAttr.count; i++) {
    const px = posAttr.getX(i);
    const pz = posAttr.getZ(i);
    uvAttr.setXY(i, (px + 1.05) / 2.1, (pz + 2.0) / 4.0);
  }
  uvAttr.needsUpdate = true;
  geo.userData.hasPlanarUVs = true;
  geo.computeVertexNormals();
  return geo;
}

interface BuildContext {
  bodyGroup: THREE.Group;
  primaryMat: THREE.MeshPhysicalMaterial;
  accentMat: THREE.MeshStandardMaterial;
  emissiveAccentMat: THREE.MeshBasicMaterial;
  trimMat: THREE.MeshStandardMaterial;
  carbonMat: THREE.MeshStandardMaterial;
  chromeMat: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshPhysicalMaterial;
  headMat: THREE.MeshBasicMaterial;
  tailMat: THREE.MeshBasicMaterial;
  disposableGeos: THREE.BufferGeometry[];
  castShadow: boolean;
  receiveShadow: boolean;
}

function applyPlanarBodyUVs(geo: THREE.BufferGeometry, xOffset = 0, zOffset = 0) {
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  if (!posAttr || !uvAttr) return;
  for (let i = 0; i < posAttr.count; i++) {
    const px = posAttr.getX(i) + xOffset;
    const pz = posAttr.getZ(i) + zOffset;
    uvAttr.setXY(i, (px + 1.05) / 2.1, (pz + 2.0) / 4.0);
  }
  uvAttr.needsUpdate = true;
}

function addPart(
  ctx: BuildContext,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  parent: THREE.Object3D = ctx.bodyGroup,
): THREE.Mesh {
  if (mat === ctx.primaryMat && !geo.userData.hasPlanarUVs) {
    applyPlanarBodyUVs(geo, x, z);
  }
  ctx.disposableGeos.push(geo);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  m.castShadow = ctx.castShadow;
  m.receiveShadow = ctx.receiveShadow;
  parent.add(m);
  return m;
}

function addSuspensionArm(
  ctx: BuildContext,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  radius: number,
  mat: THREE.Material,
) {
  const start = new THREE.Vector3(x1, y1, z1);
  const end = new THREE.Vector3(x2, y2, z2);
  const len = start.distanceTo(end);
  const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
  const mesh = addPart(
    ctx,
    geo,
    mat,
    (x1 + x2) * 0.5,
    (y1 + y2) * 0.5,
    (z1 + z2) * 0.5,
  );
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    end.sub(start).normalize(),
  );
}

// ---------------------------------------------------------------------------
// 1. OCTANE TURBO: Nimble Rally Buggy with Tapered Nose, Exposed Suspension & Twin Turbos
// ---------------------------------------------------------------------------
function buildOctaneBody(ctx: BuildContext, spec: CarBodySpec) {
  // Narrow central tapered buggy tub
  const tubGeo = extrudeSideProfile(
    [
      [-1.58, -0.14],
      [1.64, -0.14],
      [1.76, 0.02],
      [1.22, 0.24],
      [0.62, 0.30],
      [0.14, 0.68],
      [-0.74, 0.66],
      [-1.18, 0.40],
      [-1.62, 0.38],
    ],
    1.14,
    0.09,
    0.06,
  );
  addPart(ctx, tubGeo, ctx.primaryMat, 0, 0, 0);

  // Tapered stepped front nose cone
  addPart(ctx, new RoundedBoxGeometry(0.74, 0.18, 0.92, 3, 0.06), ctx.primaryMat, 0, 0.08, 1.38, 0.14);
  // Front tubular steel bumper bar + skid plate
  addPart(ctx, new RoundedBoxGeometry(1.06, 0.07, 0.20, 2, 0.03), ctx.trimMat, 0, -0.14, 1.80, -0.15);
  const barGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.96, 8);
  barGeo.rotateZ(Math.PI / 2);
  addPart(ctx, barGeo, ctx.accentMat, 0, -0.02, 1.84);

  // Exposed front A-arm suspension pushrods connecting narrow nose to front wheels
  const fy = wheelCenterY(spec.frontWheelRadius);
  for (const sx of [-1, 1]) {
    addSuspensionArm(ctx, sx * 0.34, 0.02, 1.24, sx * 0.80, fy + 0.06, spec.frontAxleZ, 0.032, ctx.chromeMat);
    addSuspensionArm(ctx, sx * 0.32, -0.14, 1.12, sx * 0.80, fy - 0.04, spec.frontAxleZ, 0.032, ctx.trimMat);
  }

  // Wrap-around raked glasshouse
  addPart(ctx, new RoundedBoxGeometry(0.96, 0.30, 1.04, 3, 0.07), ctx.glassMat, 0, 0.44, -0.18, 0.16);
  // Roof rally intake scoop
  addPart(ctx, new RoundedBoxGeometry(0.36, 0.10, 0.44, 2, 0.03), ctx.accentMat, 0, 0.67, -0.16);

  // Sculpted wide rear flared fenders flanking the mid-rear engine bay
  for (const sx of [-1, 1]) {
    addPart(ctx, new RoundedBoxGeometry(0.34, 0.34, 1.18, 3, 0.08), ctx.primaryMat, sx * 0.72, 0.16, -1.04, 0.06);
    // Side pod accent rail
    addPart(ctx, new RoundedBoxGeometry(0.12, 0.12, 1.44, 2, 0.03), ctx.accentMat, sx * 0.70, -0.10, -0.04);
  }

  // Exposed mid-rear Twin-Turbo V6 Engine Block & Chrome Intercooler Stacks
  addPart(ctx, new RoundedBoxGeometry(0.66, 0.24, 0.64, 2, 0.04), ctx.trimMat, 0, 0.40, -1.16);
  for (const sx of [-0.20, 0.20]) {
    const manifold = new THREE.CylinderGeometry(0.09, 0.11, 0.44, 10);
    manifold.rotateX(Math.PI / 2.4);
    addPart(ctx, manifold, ctx.chromeMat, sx, 0.50, -1.14);
  }

  // Angled Rally Headlights & Rear Taillight Pods
  for (const sx of [-0.40, 0.40]) {
    addPart(ctx, new RoundedBoxGeometry(0.24, 0.09, 0.10, 2, 0.02), ctx.headMat, sx, 0.06, 1.72, 0, sx > 0 ? -0.25 : 0.25);
    addPart(ctx, new RoundedBoxGeometry(0.26, 0.09, 0.08, 2, 0.02), ctx.tailMat, sx * 1.4, 0.22, -1.64);
  }
}

// ---------------------------------------------------------------------------
// 2. DOMINUS GT: Long, Low, Wide V8 Muscle Car with Supercharger Blower & Rear Louvers
// ---------------------------------------------------------------------------
function buildDominusBody(ctx: BuildContext) {
  // Long, flat, wide muscle hull
  const hullGeo = extrudeSideProfile(
    [
      [-1.84, -0.16],
      [1.86, -0.16],
      [1.92, 0.06],
      [1.70, 0.20],
      [0.52, 0.24],
      [0.08, 0.54],
      [-0.92, 0.52],
      [-1.48, 0.28],
      [-1.86, 0.26],
    ],
    1.60,
    0.07,
    0.05,
  );
  addPart(ctx, hullGeo, ctx.primaryMat, 0, 0, 0);

  // Aggressive wide front chin splitter + side winglets
  addPart(ctx, new RoundedBoxGeometry(1.76, 0.08, 0.56, 2, 0.02), ctx.trimMat, 0, -0.18, 1.66);
  addPart(ctx, new RoundedBoxGeometry(1.78, 0.05, 0.18, 2, 0.02), ctx.accentMat, 0, -0.15, 1.88);
  // Recessed dark muscle front grille
  addPart(ctx, new THREE.BoxGeometry(1.36, 0.14, 0.08), ctx.carbonMat, 0, 0.04, 1.90);

  // Iconic Chrome V8 Supercharger Blower + Dual Butterflies poking out of the long hood!
  addPart(ctx, new RoundedBoxGeometry(0.46, 0.18, 0.62, 2, 0.04), ctx.chromeMat, 0, 0.30, 1.02);
  addPart(ctx, new RoundedBoxGeometry(0.42, 0.12, 0.28, 2, 0.03), ctx.trimMat, 0, 0.42, 1.06);
  for (const sx of [-0.11, 0.11]) {
    const scoop = new THREE.CylinderGeometry(0.065, 0.065, 0.14, 12);
    scoop.rotateX(Math.PI / 2);
    addPart(ctx, scoop, ctx.accentMat, sx, 0.42, 1.22);
  }

  // Chopped low panoramic cabin + rear fastback window louvers
  addPart(ctx, new RoundedBoxGeometry(1.64, 0.22, 1.06, 3, 0.06), ctx.glassMat, 0, 0.37, -0.34, 0.06);
  for (let i = 0; i < 3; i++) {
    addPart(ctx, new THREE.BoxGeometry(1.24, 0.035, 0.10), ctx.trimMat, 0, 0.46 - i * 0.06, -0.96 - i * 0.16, -0.18);
  }

  // Muscular wide side skirts & rear haunch accents
  for (const sx of [-1, 1]) {
    addPart(ctx, new RoundedBoxGeometry(0.14, 0.14, 2.58, 2, 0.03), ctx.trimMat, sx * 0.85, -0.12, -0.02);
    addPart(ctx, new RoundedBoxGeometry(0.08, 0.06, 2.30, 1, 0.02), ctx.accentMat, sx * 0.89, -0.06, -0.02);
  }

  // Quad Muscle Headlights + Full-Width Rear Light Bar
  for (const sx of [-0.62, -0.42, 0.42, 0.62]) {
    addPart(ctx, new THREE.BoxGeometry(0.14, 0.08, 0.06), ctx.headMat, sx, 0.06, 1.92);
  }
  addPart(ctx, new THREE.BoxGeometry(1.42, 0.09, 0.06), ctx.tailMat, 0, 0.12, -1.87);
}

// ---------------------------------------------------------------------------
// 3. FENNEC RS: Boxy Widebody Group-B Hot-Hatch with Overfenders & Rally Light Pod
// ---------------------------------------------------------------------------
function buildFennecBody(ctx: BuildContext, spec: CarBodySpec) {
  // Tall, muscular boxy rally hatchback profile
  const hullGeo = extrudeSideProfile(
    [
      [-1.66, -0.16],
      [1.68, -0.16],
      [1.74, 0.16],
      [1.48, 0.30],
      [0.66, 0.36],
      [0.24, 0.74],
      [-1.14, 0.72],
      [-1.56, 0.38],
      [-1.68, 0.14],
    ],
    1.44,
    0.08,
    0.05,
  );
  addPart(ctx, hullGeo, ctx.primaryMat, 0, 0, 0);

  // Bluff boxy front bumper grille + Rally 4-Lamp Fog-Light Pod
  addPart(ctx, new RoundedBoxGeometry(1.54, 0.24, 0.18, 2, 0.04), ctx.trimMat, 0, -0.02, 1.70);
  addPart(ctx, new RoundedBoxGeometry(0.96, 0.12, 0.18, 2, 0.03), ctx.carbonMat, 0, 0.28, 1.56);
  for (const fx of [-0.32, -0.11, 0.11, 0.32]) {
    const pod = new THREE.CylinderGeometry(0.065, 0.065, 0.08, 12);
    pod.rotateX(Math.PI / 2);
    addPart(ctx, pod, ctx.headMat, fx, 0.28, 1.66);
  }

  // Hood NACA intake + Upright Hatchback Glasshouse + Roof Scoop
  addPart(ctx, new RoundedBoxGeometry(0.44, 0.06, 0.38, 2, 0.02), ctx.trimMat, 0, 0.34, 1.02);
  addPart(ctx, new RoundedBoxGeometry(1.50, 0.28, 1.24, 3, 0.06), ctx.glassMat, 0, 0.50, -0.44, 0.04);
  addPart(ctx, new RoundedBoxGeometry(0.42, 0.10, 0.46, 2, 0.03), ctx.accentMat, 0, 0.76, -0.26);

  // 4 Chunky Widebody Bolted Wheel-Arch Flares (the signature Fennec silhouette!)
  const archCoords: Array<[number, number]> = [
    [spec.frontTrackHalfWidth - 0.06, spec.frontAxleZ],
    [-spec.frontTrackHalfWidth + 0.06, spec.frontAxleZ],
    [spec.rearTrackHalfWidth - 0.06, spec.rearAxleZ],
    [-spec.rearTrackHalfWidth + 0.06, spec.rearAxleZ],
  ];
  for (const [ax, az] of archCoords) {
    addPart(ctx, new RoundedBoxGeometry(0.24, 0.26, 0.94, 3, 0.06), ctx.primaryMat, ax, 0.04, az);
    addPart(ctx, new RoundedBoxGeometry(0.26, 0.08, 0.96, 2, 0.02), ctx.trimMat, ax, -0.09, az);
  }

  // Chunky rear diffuser with strakes
  addPart(ctx, new RoundedBoxGeometry(1.48, 0.16, 0.24, 2, 0.03), ctx.trimMat, 0, -0.14, -1.64);
  for (const dx of [-0.42, -0.14, 0.14, 0.42]) {
    addPart(ctx, new THREE.BoxGeometry(0.04, 0.16, 0.26), ctx.accentMat, dx, -0.14, -1.67);
  }

  // Rectangular Rally Headlights & Corner Taillights
  for (const sx of [-0.56, 0.56]) {
    addPart(ctx, new THREE.BoxGeometry(0.28, 0.09, 0.08), ctx.headMat, sx, 0.14, 1.72);
    addPart(ctx, new THREE.BoxGeometry(0.28, 0.12, 0.08), ctx.tailMat, sx, 0.18, -1.68);
  }
}

// ---------------------------------------------------------------------------
// 4. APEX PROTO: Ultra-Low Le Mans Hypercar with Bubble Canopy, Wheel Pods & Shark Fin
// ---------------------------------------------------------------------------
function buildApexBody(ctx: BuildContext) {
  // Ultra-low sculpted wedge central monocoque
  const hullGeo = extrudeSideProfile(
    [
      [-1.84, -0.18],
      [1.86, -0.18],
      [1.94, -0.04],
      [1.46, 0.14],
      [0.64, 0.18],
      [0.12, 0.42],
      [-0.82, 0.40],
      [-1.44, 0.22],
      [-1.88, 0.14],
    ],
    1.04,
    0.08,
    0.05,
  );
  addPart(ctx, hullGeo, ctx.primaryMat, 0, 0, 0);

  // Teardrop Fighter-Jet Bubble Canopy
  const bubbleGeo = new THREE.SphereGeometry(0.56, 24, 16);
  bubbleGeo.scale(0.74, 0.40, 1.55);
  addPart(ctx, bubbleGeo, ctx.glassMat, 0, 0.28, -0.06);

  // Full-width low ground-effect front aero splitter + dive canards
  addPart(ctx, new RoundedBoxGeometry(1.82, 0.06, 0.68, 2, 0.02), ctx.trimMat, 0, -0.20, 1.60);
  for (const sx of [-1, 1]) {
    addPart(ctx, new THREE.BoxGeometry(0.22, 0.04, 0.34), ctx.accentMat, sx * 0.84, -0.10, 1.64, 0.18, 0, sx * -0.12);
    // Deep carved sidepod aero tunnels + wheel-pod fairings flanking corners cleanly
    addPart(ctx, new RoundedBoxGeometry(0.38, 0.28, 1.02, 4, 0.11), ctx.primaryMat, sx * 0.64, 0.04, 1.18, 0.08);
    addPart(ctx, new RoundedBoxGeometry(0.40, 0.32, 1.08, 4, 0.11), ctx.primaryMat, sx * 0.65, 0.08, -1.16, -0.05);
    // Dark sidepod radiator intake channel bridging front & rear wheel pods
    addPart(ctx, new RoundedBoxGeometry(0.32, 0.22, 1.34, 2, 0.04), ctx.carbonMat, sx * 0.60, -0.06, 0.0);
    addPart(ctx, new RoundedBoxGeometry(0.10, 0.06, 1.56, 2, 0.02), ctx.accentMat, sx * 0.86, -0.18, 0.0);
  }

  // Iconic Central Longitudinal Dorsal Shark-Fin Spine!
  const finGeo = extrudeSideProfile(
    [
      [-1.62, 0.16],
      [-0.45, 0.42],
      [-0.85, 0.62],
      [-1.66, 0.56],
    ],
    0.08,
    0.01,
    0.01,
  );
  addPart(ctx, finGeo, ctx.accentMat, 0, 0, 0);

  // Slim razor-sharp Hypercar LED Blade Headlights & Full-Width Tailbar
  for (const sx of [-0.66, 0.66]) {
    addPart(ctx, new THREE.BoxGeometry(0.34, 0.045, 0.08), ctx.headMat, sx, 0.03, 1.72, 0, sx > 0 ? -0.35 : 0.35);
  }
  addPart(ctx, new THREE.BoxGeometry(1.66, 0.055, 0.06), ctx.tailMat, 0, 0.10, -1.86);
}

// ---------------------------------------------------------------------------
// 5. FORMULA X: Open-Wheel Monoposto with Needle Nose, Multi-Plane Wing, Halo & Pushrods
// ---------------------------------------------------------------------------
function buildFormulaBody(ctx: BuildContext, spec: CarBodySpec) {
  // Narrow central torpedo monocoque + raised engine cover spine
  const monoGeo = extrudeSideProfile(
    [
      [-1.80, -0.16],
      [1.35, -0.16],
      [1.92, -0.08],
      [1.86, 0.05],
      [0.85, 0.24],
      [0.32, 0.26],
      [-0.12, 0.56],
      [-0.95, 0.52],
      [-1.78, 0.22],
    ],
    0.56,
    0.06,
    0.04,
  );
  addPart(ctx, monoGeo, ctx.primaryMat, 0, 0, 0);

  // Low flat underbody carbon floor plank (Venturi floor)
  addPart(ctx, new THREE.BoxGeometry(1.26, 0.05, 2.24), ctx.trimMat, 0, -0.20, -0.14);

  // Iconic Wide Multi-Plane Front Aero Wing + Curved Side Endplates
  addPart(ctx, new THREE.BoxGeometry(1.86, 0.045, 0.34), ctx.accentMat, 0, -0.16, 1.78, 0.08);
  addPart(ctx, new THREE.BoxGeometry(1.78, 0.04, 0.16), ctx.primaryMat, 0, -0.10, 1.66, 0.22);
  for (const sx of [-0.92, 0.92]) {
    addPart(ctx, new RoundedBoxGeometry(0.05, 0.22, 0.44, 2, 0.015), ctx.trimMat, sx, -0.10, 1.74);
  }

  // Sculpted Coke-Bottle Sidepods with angled radiator intakes
  for (const sx of [-1, 1]) {
    addPart(ctx, new RoundedBoxGeometry(0.32, 0.28, 1.24, 3, 0.08), ctx.primaryMat, sx * 0.42, -0.02, -0.22);
    addPart(ctx, new THREE.BoxGeometry(0.24, 0.20, 0.08), ctx.carbonMat, sx * 0.44, 0.0, 0.40);
    // Open-wheel exposed suspension wishbone pushrods (Front & Rear!)
    const fy = wheelCenterY(spec.frontWheelRadius);
    const ry = wheelCenterY(spec.rearWheelRadius);
    addSuspensionArm(ctx, sx * 0.22, 0.04, 1.32, sx * 0.84, fy + 0.06, spec.frontAxleZ, 0.028, ctx.trimMat);
    addSuspensionArm(ctx, sx * 0.22, -0.12, 1.24, sx * 0.84, fy - 0.06, spec.frontAxleZ, 0.028, ctx.trimMat);
    addSuspensionArm(ctx, sx * 0.24, 0.06, -1.16, sx * 0.82, ry + 0.06, spec.rearAxleZ, 0.032, ctx.trimMat);
    addSuspensionArm(ctx, sx * 0.24, -0.12, -1.10, sx * 0.82, ry - 0.06, spec.rearAxleZ, 0.032, ctx.trimMat);
  }

  // Open Cockpit Tub + Driver Racing Helmet + Protective Titanium Halo Bar
  addPart(ctx, new RoundedBoxGeometry(0.46, 0.14, 0.72, 2, 0.04), ctx.carbonMat, 0, 0.18, 0.16);
  const helmetGeo = new THREE.SphereGeometry(0.16, 16, 12);
  addPart(ctx, helmetGeo, ctx.accentMat, 0, 0.34, 0.04);
  addPart(ctx, new THREE.BoxGeometry(0.24, 0.07, 0.14), ctx.glassMat, 0, 0.36, 0.14); // Helmet visor
  // Halo protective cockpit hoop
  const haloArch = new THREE.TorusGeometry(0.26, 0.032, 8, 18, Math.PI);
  haloArch.rotateX(Math.PI / 2);
  addPart(ctx, haloArch, ctx.trimMat, 0, 0.42, 0.12);
  addSuspensionArm(ctx, 0, 0.26, 0.48, 0, 0.42, 0.36, 0.03, ctx.trimMat); // Center Halo pillar

  // Overhead F1 Airbox Intake + T-Cam Pod
  addPart(ctx, new RoundedBoxGeometry(0.24, 0.20, 0.32, 2, 0.04), ctx.primaryMat, 0, 0.56, -0.22);
  addPart(ctx, new THREE.BoxGeometry(0.16, 0.12, 0.06), ctx.carbonMat, 0, 0.58, -0.06);
  addPart(ctx, new THREE.BoxGeometry(0.32, 0.035, 0.06), ctx.accentMat, 0, 0.70, -0.22); // F1 T-Cam bar

  // Nose-tip LED strips & Rear F1 Rain Light
  for (const sx of [-0.14, 0.14]) {
    addPart(ctx, new THREE.BoxGeometry(0.08, 0.035, 0.18), ctx.headMat, sx, -0.02, 1.82);
  }
  addPart(ctx, new THREE.BoxGeometry(0.10, 0.14, 0.08), ctx.tailMat, 0, -0.06, -1.82);
}

// ---------------------------------------------------------------------------
// 6. TITAN RIG: Heavy Armored Pickup / Baja Buggy with Roll Cage, Bull-Bar & Spare Tire
// ---------------------------------------------------------------------------
function buildTitanBody(ctx: BuildContext, spec: CarBodySpec) {
  // Raised muscular armored pickup/Baja hull with recessed rear truck bed
  const hullGeo = extrudeSideProfile(
    [
      [-1.78, -0.08],
      [1.76, -0.08],
      [1.82, 0.20],
      [1.68, 0.42],
      [0.72, 0.48],
      [0.42, 0.84],
      [-0.42, 0.84],
      [-0.58, 0.44],
      [-1.74, 0.42],
    ],
    1.52,
    0.07,
    0.05,
  );
  addPart(ctx, hullGeo, ctx.primaryMat, 0, 0, 0);

  // Heavy-Duty Steel Front Bull-Bar + Bash Skid Plate + Dual Off-Road Floodlights
  addPart(ctx, new RoundedBoxGeometry(1.48, 0.18, 0.24, 2, 0.04), ctx.trimMat, 0, -0.02, 1.80, 0.22);
  const bullH = new THREE.CylinderGeometry(0.04, 0.04, 1.24, 8);
  bullH.rotateZ(Math.PI / 2);
  addPart(ctx, bullH, ctx.chromeMat, 0, 0.34, 1.88);
  for (const sx of [-0.46, 0.46]) {
    addPart(ctx, new THREE.CylinderGeometry(0.04, 0.04, 0.38, 8), ctx.chromeMat, sx, 0.16, 1.86);
    const flood = new THREE.CylinderGeometry(0.10, 0.10, 0.08, 12);
    flood.rotateX(Math.PI / 2);
    addPart(ctx, flood, ctx.headMat, sx * 0.52, 0.28, 1.89);
  }

  // Upright Armored Windshield & Cab Glass + Roof 5-LED Light Bar
  addPart(ctx, new RoundedBoxGeometry(1.56, 0.28, 0.80, 2, 0.05), ctx.glassMat, 0, 0.62, 0.02, 0.06);
  addPart(ctx, new RoundedBoxGeometry(1.16, 0.09, 0.12, 2, 0.02), ctx.trimMat, 0, 0.90, 0.30);
  for (let i = -2; i <= 2; i++) {
    addPart(ctx, new THREE.BoxGeometry(0.16, 0.055, 0.06), ctx.headMat, i * 0.22, 0.90, 0.36);
  }

  // External Tubular Baja Roll-Cage sweeping from cab into rear cargo bed!
  for (const sx of [-0.62, 0.62]) {
    addSuspensionArm(ctx, sx, 0.82, -0.34, sx, 0.44, -1.62, 0.042, ctx.accentMat);
    addPart(ctx, new RoundedBoxGeometry(0.24, 0.22, 0.96, 2, 0.04), ctx.trimMat, sx * 1.32, 0.12, spec.frontAxleZ);
    addPart(ctx, new RoundedBoxGeometry(0.24, 0.22, 0.96, 2, 0.04), ctx.trimMat, sx * 1.32, 0.12, spec.rearAxleZ);
  }
  const crossBar = new THREE.CylinderGeometry(0.04, 0.04, 1.24, 8);
  crossBar.rotateZ(Math.PI / 2);
  addPart(ctx, crossBar, ctx.accentMat, 0, 0.66, -0.88);

  // Angled Full-Size Spare Baja Tire mounted in the rear cargo bed
  const spareTire = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 20);
  spareTire.rotateZ(Math.PI / 2);
  addPart(ctx, spareTire, ctx.carbonMat, 0, 0.48, -1.24, 0, 0, 0);
  const spareMesh = ctx.bodyGroup.children[ctx.bodyGroup.children.length - 1];
  spareMesh.rotation.set(0.55, Math.PI / 2, 0); // Wait: rotate cylinder so tire face points back-upward!
  // Actually let's use Cylinder rotated around X so it lies tilted in bed cleanly:
  spareMesh.rotation.set(0.65, 0, 0);
  const spareHub = new THREE.CylinderGeometry(0.18, 0.18, 0.28, 12);
  addPart(ctx, spareHub, ctx.accentMat, 0, 0.48, -1.24, 0.65, 0, 0);

  // Rugged Headlights & Vertical Rear Taillights
  for (const sx of [-0.58, 0.58]) {
    addPart(ctx, new THREE.BoxGeometry(0.22, 0.14, 0.08), ctx.headMat, sx, 0.28, 1.76);
    addPart(ctx, new THREE.BoxGeometry(0.12, 0.24, 0.08), ctx.tailMat, sx * 1.08, 0.22, -1.78);
  }
}

function addSpoilerAttachment(
  ctx: BuildContext,
  spec: CarBodySpec,
  style: SpoilerStyle,
) {
  if (style === 'none') return;
  const wy = spec.wingY;
  const wz = spec.wingZ;
  const w = spec.wingWidth;

  if (style === 'ducktail') {
    const duckGeo = new RoundedBoxGeometry(w * 0.92, 0.16, 0.26, 2, 0.04);
    addPart(ctx, duckGeo, ctx.accentMat, 0, wy - 0.20, wz + 0.06, -0.32);
    return;
  }

  // Twin Struts shared by sport, gt_wing, twin_blade
  const strutHeight = style === 'gt_wing' ? 0.44 : 0.32;
  const strutGeo = new THREE.BoxGeometry(0.07, strutHeight, 0.20);
  const sxOffset = w * 0.30;
  for (const sx of [-sxOffset, sxOffset]) {
    addPart(ctx, strutGeo, ctx.trimMat, sx, wy - strutHeight * 0.45, wz + 0.06, -0.18);
  }

  if (style === 'sport') {
    addPart(ctx, new RoundedBoxGeometry(w, 0.08, 0.40, 2, 0.03), ctx.accentMat, 0, wy, wz, -0.16);
  } else if (style === 'gt_wing') {
    // High swan-neck carbon main plane + endplates
    addPart(ctx, new RoundedBoxGeometry(w * 1.06, 0.065, 0.46, 2, 0.02), ctx.trimMat, 0, wy + 0.08, wz - 0.04, -0.14);
    addPart(ctx, new RoundedBoxGeometry(w * 1.02, 0.03, 0.12, 2, 0.01), ctx.accentMat, 0, wy + 0.12, wz - 0.20, -0.26);
    for (const sx of [-w * 0.53, w * 0.53]) {
      addPart(ctx, new RoundedBoxGeometry(0.05, 0.28, 0.54, 2, 0.02), ctx.accentMat, sx, wy + 0.04, wz - 0.04);
    }
  } else if (style === 'twin_blade') {
    addPart(ctx, new RoundedBoxGeometry(w, 0.055, 0.28, 2, 0.02), ctx.accentMat, 0, wy + 0.06, wz - 0.02, -0.18);
    addPart(ctx, new RoundedBoxGeometry(w * 0.92, 0.055, 0.24, 2, 0.02), ctx.primaryMat, 0, wy - 0.10, wz + 0.06, -0.10);
    for (const sx of [-w * 0.49, w * 0.49]) {
      addPart(ctx, new THREE.BoxGeometry(0.045, 0.28, 0.42), ctx.trimMat, sx, wy - 0.02, wz + 0.02);
    }
  }
}

function addTopperAttachment(
  ctx: BuildContext,
  spec: CarBodySpec,
  topper: TopperStyle,
) {
  if (topper === 'none') return;
  const ry = spec.roofY;
  const rz = spec.roofZ;

  if (topper === 'halo') {
    const haloGeo = new THREE.TorusGeometry(0.42, 0.048, 10, 28);
    haloGeo.rotateX(Math.PI / 2);
    addPart(ctx, haloGeo, ctx.emissiveAccentMat, 0, ry + 0.24, rz);
  } else if (topper === 'crown') {
    addPart(ctx, new THREE.CylinderGeometry(0.28, 0.24, 0.16, 6), ctx.accentMat, 0, ry + 0.10, rz);
    const spikeGeo = new THREE.ConeGeometry(0.062, 0.16, 4);
    for (let i = 0; i < 6; i++) {
      const ang = (i * Math.PI) / 3;
      addPart(
        ctx,
        spikeGeo,
        ctx.emissiveAccentMat,
        Math.cos(ang) * 0.20,
        ry + 0.22,
        rz + Math.sin(ang) * 0.20,
      );
    }
  } else if (topper === 'fin') {
    const finGeo = extrudeSideProfile(
      [
        [-0.40, 0],
        [0.30, 0],
        [-0.26, 0.34],
      ],
      0.06,
      0,
      0,
    );
    addPart(ctx, finGeo, ctx.accentMat, 0, ry + 0.02, rz - 0.08);
  } else if (topper === 'horns') {
    for (const sx of [-1, 1]) {
      const base = new THREE.ConeGeometry(0.08, 0.24, 8);
      addPart(ctx, base, ctx.trimMat, sx * 0.24, ry + 0.08, rz + 0.04, -0.22, 0, sx * -0.45);
      const tip = new THREE.ConeGeometry(0.06, 0.26, 8);
      addPart(ctx, tip, ctx.emissiveAccentMat, sx * 0.34, ry + 0.22, rz + 0.10, 0.32, 0, sx * 0.15);
    }
  } else if (topper === 'visor') {
    addPart(ctx, new RoundedBoxGeometry(0.92, 0.10, 0.20, 2, 0.03), ctx.trimMat, 0, ry + 0.08, rz + 0.12);
    addPart(ctx, new THREE.BoxGeometry(0.84, 0.045, 0.06), ctx.emissiveAccentMat, 0, ry + 0.08, rz + 0.21);
  } else if (topper === 'antenna') {
    addPart(ctx, new THREE.CylinderGeometry(0.04, 0.055, 0.08, 8), ctx.trimMat, -0.24, ry + 0.04, rz - 0.28);
    addPart(ctx, new THREE.CylinderGeometry(0.015, 0.022, 0.56, 6), ctx.chromeMat, -0.24, ry + 0.32, rz - 0.28, -0.18);
    addPart(ctx, new THREE.SphereGeometry(0.065, 10, 10), ctx.emissiveAccentMat, -0.24, ry + 0.58, rz - 0.38);
  }
}

export function buildCarVisualRig(
  customization: CarCustomization,
  isSoftwareGl: boolean,
): CarVisualRig {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const bodyStyle: CarBodyStyle = BODY_GEOMETRY_SPECS[customization.body]
    ? customization.body
    : 'octane';
  const spec = BODY_GEOMETRY_SPECS[bodyStyle];
  const paintFinish = customization.paintFinish ?? 'metallic';
  const topper = customization.topper ?? 'none';
  const spoiler = customization.spoiler ?? 'sport';
  const underglow = Boolean(customization.underglow);
  const underglowHex = customization.underglowColor ?? customization.accentColor;
  const trimStyle = customization.trimStyle ?? 'carbon';
  const tintSpec =
    WINDOW_TINT_OPTIONS.find((t) => t.id === customization.windowTint) ?? WINDOW_TINT_OPTIONS[0];

  const decalTex = createDecalTexture(
    customization.primaryColor,
    customization.accentColor,
    customization.decal,
    paintFinish,
  );

  // 1. Primary Chassis Material tuned to selected PaintFinish
  const finishProps =
    paintFinish === 'matte'
      ? { metalness: 0.06, roughness: 0.82, clearcoat: 0.0, clearcoatRoughness: 0.5 }
      : paintFinish === 'anodized'
        ? { metalness: 0.86, roughness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.07 }
        : paintFinish === 'gloss'
          ? { metalness: 0.18, roughness: 0.14, clearcoat: 1.0, clearcoatRoughness: 0.05 }
          : paintFinish === 'chrome'
            ? { metalness: 0.96, roughness: 0.08, clearcoat: 1.0, clearcoatRoughness: 0.03 }
            : paintFinish === 'pearlescent'
              ? {
                  metalness: 0.45,
                  roughness: 0.22,
                  clearcoat: 1.0,
                  clearcoatRoughness: 0.06,
                  sheen: 1.0,
                  sheenRoughness: 0.25,
                  sheenColor: new THREE.Color(customization.accentColor),
                }
              : { metalness: 0.52, roughness: 0.26, clearcoat: 0.9, clearcoatRoughness: 0.12 };

  const primaryMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: decalTex,
    ...finishProps,
  });

  // 2. Accent Trim Material
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(customization.accentColor),
    metalness: 0.62,
    roughness: 0.28,
  });

  // 3. Emissive Accent Material (halo, neon bars, cyber accents)
  const emissiveAccentMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.accentColor),
  });

  // 4. Carbon / Rubber Material
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x161b26,
    metalness: 0.18,
    roughness: 0.8,
  });

  // 5. Chrome Material
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd8dee9,
    metalness: 0.9,
    roughness: 0.16,
  });

  // 6. Selectable Aero Trim Material (carbon / chrome / body-tinted)
  const trimMat =
    trimStyle === 'chrome'
      ? chromeMat
      : trimStyle === 'body'
        ? new THREE.MeshStandardMaterial({
            color: new THREE.Color(customization.primaryColor),
            metalness: 0.45,
            roughness: 0.34,
          })
        : carbonMat;

  // 7. Tinted Glass Canopy Material
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: tintSpec.colorHex,
    metalness: 0.14,
    roughness: 0.08,
    clearcoat: 1.0,
    opacity: isSoftwareGl ? 0.88 : 0.92,
    transparent: true,
  });

  const headMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.headlightColor ?? '#e0f2fe'),
  });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

  const wheelColor = customization.wheelColor ?? customization.accentColor;
  const wheelMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(wheelColor),
    metalness: 0.72,
    roughness: 0.24,
  });
  const wheelGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(wheelColor) });

  const disposableGeos: THREE.BufferGeometry[] = [];
  const disposableMats: THREE.Material[] = [
    primaryMat,
    accentMat,
    emissiveAccentMat,
    carbonMat,
    chromeMat,
    glassMat,
    headMat,
    tailMat,
    wheelMat,
    wheelGlowMat,
  ];
  if (trimMat !== carbonMat && trimMat !== chromeMat) {
    disposableMats.push(trimMat);
  }
  const disposableTex: THREE.Texture[] = [decalTex];

  const ctx: BuildContext = {
    bodyGroup,
    primaryMat,
    accentMat,
    emissiveAccentMat,
    trimMat,
    carbonMat,
    chromeMat,
    glassMat,
    headMat,
    tailMat,
    disposableGeos,
    castShadow: !isSoftwareGl,
    receiveShadow: !isSoftwareGl,
  };

  // --- Body-Specific Sculpted Architecture ---
  if (bodyStyle === 'octane') buildOctaneBody(ctx, spec);
  else if (bodyStyle === 'dominus') buildDominusBody(ctx);
  else if (bodyStyle === 'fennec') buildFennecBody(ctx, spec);
  else if (bodyStyle === 'apex') buildApexBody(ctx);
  else if (bodyStyle === 'formula') buildFormulaBody(ctx, spec);
  else buildTitanBody(ctx, spec);

  // --- Dynamic Spoiler & Roof Topper ---
  addSpoilerAttachment(ctx, spec, spoiler);
  addTopperAttachment(ctx, spec, topper);

  // --- Optional Neon Underglow (Floor Aura + Crisp Side Light Strips) ---
  if (underglow) {
    const glowTex = createUnderglowTexture(underglowHex);
    disposableTex.push(glowTex);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const stripMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(underglowHex),
    });
    disposableMats.push(glowMat, stripMat);

    const glowGeo = new THREE.PlaneGeometry(3.1, 4.5);
    disposableGeos.push(glowGeo);
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.rotation.x = -Math.PI / 2;
    glowMesh.position.set(0, -0.49, 0);
    group.add(glowMesh);

    const stripGeo = new THREE.BoxGeometry(0.04, 0.04, spec.bodyLength * 0.56);
    disposableGeos.push(stripGeo);
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(sx * (spec.bodyWidth * 0.45), -0.22, 0);
      bodyGroup.add(strip);
    }
  }

  // --- Body-Specific Rocket Thruster Nozzles & Dual-Layer Boost Flame Cones ---
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.boostColor),
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerFlameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#fff7ed'),
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposableMats.push(flameMat, innerFlameMat);

  const flameCones: THREE.Mesh[] = [];
  const innerFlameCones: THREE.Mesh[] = [];
  for (const port of spec.exhausts) {
    const nozzleGeo = new THREE.CylinderGeometry(port.radius * 0.88, port.radius * 1.12, 0.34, 14);
    nozzleGeo.rotateX(Math.PI / 2);
    const coreGeo = new THREE.CylinderGeometry(port.radius * 0.72, port.radius * 0.78, 0.355, 14);
    coreGeo.rotateX(Math.PI / 2);
    const flameGeo = new THREE.ConeGeometry(port.radius * 1.15, 1.85, 14);
    flameGeo.rotateX(-Math.PI / 2);
    flameGeo.translate(0, 0, -0.92);
    const innerFlameGeo = new THREE.ConeGeometry(port.radius * 0.58, 1.15, 12);
    innerFlameGeo.rotateX(-Math.PI / 2);
    innerFlameGeo.translate(0, 0, -0.58);
    disposableGeos.push(nozzleGeo, coreGeo, flameGeo, innerFlameGeo);

    const nozzle = new THREE.Mesh(nozzleGeo, chromeMat);
    nozzle.position.set(port.x, port.y, port.z);
    bodyGroup.add(nozzle);

    const core = new THREE.Mesh(coreGeo, carbonMat);
    core.position.set(port.x, port.y, port.z - 0.008);
    bodyGroup.add(core);

    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(port.x, port.y, port.z - 0.12);
    flame.visible = false;
    bodyGroup.add(flame);
    flameCones.push(flame);

    const innerFlame = new THREE.Mesh(innerFlameGeo, innerFlameMat);
    innerFlame.position.set(port.x, port.y, port.z - 0.11);
    innerFlame.visible = false;
    bodyGroup.add(innerFlame);
    innerFlameCones.push(innerFlame);
  }

  // --- 4 Articulated Wheels (Front/Rear Staggered Sizes + Brake Calipers + 6 Rim Styles) ---
  const wheelPivots: THREE.Group[] = [];
  const wheelMeshes: THREE.Group[] = [];
  const wheelPositions: Array<{ x: number; y: number; z: number; r: number; w: number }> = [
    {
      x: spec.frontTrackHalfWidth,
      y: wheelCenterY(spec.frontWheelRadius),
      z: spec.frontAxleZ,
      r: spec.frontWheelRadius,
      w: spec.frontTireWidth,
    },
    {
      x: -spec.frontTrackHalfWidth,
      y: wheelCenterY(spec.frontWheelRadius),
      z: spec.frontAxleZ,
      r: spec.frontWheelRadius,
      w: spec.frontTireWidth,
    },
    {
      x: spec.rearTrackHalfWidth,
      y: wheelCenterY(spec.rearWheelRadius),
      z: spec.rearAxleZ,
      r: spec.rearWheelRadius,
      w: spec.rearTireWidth,
    },
    {
      x: -spec.rearTrackHalfWidth,
      y: wheelCenterY(spec.rearWheelRadius),
      z: spec.rearAxleZ,
      r: spec.rearWheelRadius,
      w: spec.rearTireWidth,
    },
  ];

  // Build shared unit-radius brake caliper geo
  const caliperGeo = new THREE.BoxGeometry(0.08, 0.14, 0.14);
  disposableGeos.push(caliperGeo);

  for (const wp of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wp.x, wp.y, wp.z);
    const sign = wp.x > 0 ? 1 : -1;

    // Stationary brake caliper mounted inside the pivot
    const caliper = new THREE.Mesh(caliperGeo, accentMat);
    caliper.position.set(-sign * wp.w * 0.14, 0.08, -0.09);
    pivot.add(caliper);

    const wheel = new THREE.Group();
    const tireGeo = new THREE.CylinderGeometry(wp.r, wp.r, wp.w, 28);
    tireGeo.rotateZ(Math.PI / 2);
    const rimR = wp.r * (customization.wheelStyle === 'offroad' ? 0.56 : 0.68);
    const rimGeo = new THREE.CylinderGeometry(rimR, rimR, wp.w + 0.012, 16);
    rimGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(wp.r * 0.22, wp.r * 0.22, wp.w + 0.04, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(wp.w + 0.024, wp.r * 0.11, rimR * 1.9);
    const ringGeo = new THREE.TorusGeometry(rimR * 0.92, 0.026, 8, 20);
    ringGeo.rotateY(Math.PI / 2);
    disposableGeos.push(tireGeo, rimGeo, hubGeo, spokeGeo, ringGeo);

    const tire = new THREE.Mesh(tireGeo, carbonMat);
    tire.castShadow = !isSoftwareGl;
    wheel.add(tire);

    const rimMat =
      customization.wheelStyle === 'cyber' || customization.wheelStyle === 'offroad'
        ? carbonMat
        : wheelMat;
    wheel.add(new THREE.Mesh(rimGeo, rimMat));
    wheel.add(
      new THREE.Mesh(
        hubGeo,
        customization.wheelStyle === 'cyber' ? wheelGlowMat : wheelMat,
      ),
    );

    if (customization.wheelStyle === 'cyber') {
      const ring = new THREE.Mesh(ringGeo, wheelGlowMat);
      ring.position.x = sign * (wp.w * 0.5 + 0.008);
      wheel.add(ring);
      for (let s = 0; s < 4; s++) {
        const bar = new THREE.Mesh(spokeGeo, wheelGlowMat);
        bar.rotation.x = (s * Math.PI) / 4;
        wheel.add(bar);
      }
    } else if (customization.wheelStyle === 'turbine') {
      for (let s = 0; s < 8; s++) {
        const blade = new THREE.Mesh(spokeGeo, wheelMat);
        blade.rotation.x = (s * Math.PI) / 8;
        blade.rotation.z = 0.12;
        wheel.add(blade);
      }
    } else if (customization.wheelStyle === 'aero') {
      const discGeo = new THREE.CylinderGeometry(rimR * 1.04, rimR * 1.04, wp.w + 0.025, 20);
      discGeo.rotateZ(Math.PI / 2);
      disposableGeos.push(discGeo);
      wheel.add(new THREE.Mesh(discGeo, wheelMat));
      const ring = new THREE.Mesh(ringGeo, chromeMat);
      ring.position.x = sign * (wp.w * 0.5 + 0.012);
      wheel.add(ring);
    } else if (customization.wheelStyle === 'star') {
      const dishGeo = new THREE.TorusGeometry(rimR * 0.96, 0.032, 8, 22);
      dishGeo.rotateY(Math.PI / 2);
      disposableGeos.push(dishGeo);
      const dish = new THREE.Mesh(dishGeo, chromeMat);
      dish.position.x = sign * (wp.w * 0.5 + 0.006);
      wheel.add(dish);
      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(spokeGeo, chromeMat);
        spoke.rotation.x = (s * Math.PI * 2) / 5;
        wheel.add(spoke);
      }
    } else if (customization.wheelStyle === 'offroad') {
      const ring = new THREE.Mesh(ringGeo, wheelMat);
      ring.position.x = sign * (wp.w * 0.5 + 0.01);
      wheel.add(ring);
      const lugGeo = new THREE.BoxGeometry(wp.w * 0.92, 0.055, 0.09);
      disposableGeos.push(lugGeo);
      for (let t = 0; t < 12; t++) {
        const ang = (t * Math.PI * 2) / 12;
        const lug = new THREE.Mesh(lugGeo, carbonMat);
        lug.position.set(0, Math.cos(ang) * wp.r, Math.sin(ang) * wp.r);
        lug.rotation.x = -ang;
        wheel.add(lug);
      }
      for (let s = 0; s < 6; s++) {
        const spoke = new THREE.Mesh(spokeGeo, wheelMat);
        spoke.rotation.x = (s * Math.PI) / 6;
        wheel.add(spoke);
      }
    } else {
      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(spokeGeo, chromeMat);
        spoke.rotation.x = (s * Math.PI) / 5;
        wheel.add(spoke);
      }
    }

    pivot.add(wheel);
    group.add(pivot);
    wheelPivots.push(pivot);
    wheelMeshes.push(wheel);
  }

  // --- Contact Shadow Disc ---
  const shadowTex = createContactShadowTexture();
  disposableTex.push(shadowTex);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  disposableMats.push(shadowMat);
  const shadowGeo = new THREE.PlaneGeometry(3.2, 4.5);
  disposableGeos.push(shadowGeo);
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.025;

  const dispose = () => {
    disposableTex.forEach((t) => t.dispose());
    disposableGeos.forEach((g) => g.dispose());
    disposableMats.forEach((m) => m.dispose());
  };

  return {
    group,
    bodyGroup,
    wheelPivots,
    wheelMeshes,
    flameCones,
    innerFlameCones,
    primaryMat,
    accentMat,
    flameMat,
    innerFlameMat,
    contactShadow,
    dispose,
  };
}
