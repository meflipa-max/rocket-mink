import * as THREE from 'three';
import type { CarCustomization } from '../shared/types';

export interface CarVisualRig {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  wheelPivots: THREE.Group[]; // [FL, FR, RL, RR]
  wheelMeshes: THREE.Group[];
  flameCones: THREE.Mesh[];
  primaryMat: THREE.MeshPhysicalMaterial;
  accentMat: THREE.MeshStandardMaterial;
  flameMat: THREE.MeshBasicMaterial;
  contactShadow: THREE.Mesh;
  dispose: () => void;
}

function createDecalTexture(
  primaryColor: string,
  accentColor: string,
  decal: CarCustomization['decal'],
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = primaryColor;
  ctx.fillRect(0, 0, 256, 256);

  if (decal === 'stripes') {
    ctx.fillStyle = accentColor;
    ctx.fillRect(88, 0, 28, 256);
    ctx.fillRect(140, 0, 28, 256);
  } else if (decal === 'flames') {
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(0, 256);
    ctx.lineTo(0, 125);
    ctx.quadraticCurveTo(48, 80, 74, 150);
    ctx.quadraticCurveTo(110, 40, 128, 128);
    ctx.quadraticCurveTo(150, 40, 184, 150);
    ctx.quadraticCurveTo(210, 80, 256, 125);
    ctx.lineTo(256, 256);
    ctx.closePath();
    ctx.fill();
  }

  // Subtle metallic flake speckle
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 180; i++) {
    ctx.fillRect((i * 73) % 256, (i * 137) % 256, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.65)');
  grad.addColorStop(0.65, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function createExtrudedHull(body: CarCustomization['body']): THREE.BufferGeometry {
  // Side profile in 2D (X = Z forward axis, Y = vertical up axis), then extruded along width and centered
  const shape = new THREE.Shape();
  if (body === 'octane') {
    // Classic nimble Octane silhouette: wedge nose, tall cabin, kicked-up rear engine bay
    shape.moveTo(-1.72, -0.18);
    shape.lineTo(1.76, -0.18);
    shape.lineTo(1.84, 0.04);
    shape.lineTo(1.42, 0.24);
    shape.lineTo(0.65, 0.34);
    shape.lineTo(0.18, 0.68);
    shape.lineTo(-0.72, 0.66);
    shape.lineTo(-1.26, 0.38);
    shape.lineTo(-1.74, 0.34);
    shape.closePath();
  } else {
    // Low-slung Dominus muscle battle-car silhouette
    shape.moveTo(-1.82, -0.18);
    shape.lineTo(1.86, -0.18);
    shape.lineTo(1.9, 0.08);
    shape.lineTo(1.62, 0.24);
    shape.lineTo(0.55, 0.28);
    shape.lineTo(0.08, 0.56);
    shape.lineTo(-0.88, 0.54);
    shape.lineTo(-1.45, 0.32);
    shape.lineTo(-1.84, 0.28);
    shape.closePath();
  }

  const width = body === 'octane' ? 1.48 : 1.56;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.09,
    bevelSegments: 2,
  });

  // Rotate so extrusion is along X, profile X aligns with +Z forward!
  geo.center();
  geo.rotateY(-Math.PI / 2);

  // Project clean top-down planar UVs so racing stripes & flames flow front-to-back
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < posAttr.count; i++) {
    const px = posAttr.getX(i);
    const pz = posAttr.getZ(i);
    uvAttr.setXY(i, (px + 1.0) / 2.0, (pz + 2.0) / 4.0);
  }
  uvAttr.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function buildCarVisualRig(
  customization: CarCustomization,
  isSoftwareGl: boolean,
): CarVisualRig {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const decalTex = createDecalTexture(
    customization.primaryColor,
    customization.accentColor,
    customization.decal,
  );

  // 1. Primary Metallic Clearcoat Chassis Material
  const primaryMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: decalTex,
    metalness: 0.45,
    roughness: 0.28,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
  });

  // 2. Accent Matte/Metallic Trim Material
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(customization.accentColor),
    metalness: 0.6,
    roughness: 0.35,
  });

  // 3. Dark Carbon Chassis / Bumper Material
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x161b26,
    metalness: 0.2,
    roughness: 0.78,
  });

  // 4. Tinted Glass Canopy Material
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1220,
    metalness: 0.1,
    roughness: 0.08,
    clearcoat: 1.0,
    opacity: isSoftwareGl ? 0.85 : 0.92,
    transparent: true,
  });

  // 5. Metallic Rim & Thruster Nozzle Material
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd1d5db,
    metalness: 0.88,
    roughness: 0.18,
  });

  // --- Part 1: Main Sculpted Extruded Hull ---
  const hullGeo = createExtrudedHull(customization.body);
  const hullMesh = new THREE.Mesh(hullGeo, primaryMat);
  hullMesh.position.y = 0.08;
  hullMesh.castShadow = !isSoftwareGl;
  hullMesh.receiveShadow = !isSoftwareGl;
  bodyGroup.add(hullMesh);

  // --- Part 2: Lower Carbon Underbody & Front Splitter ---
  const splitterGeo = new THREE.BoxGeometry(1.68, 0.12, 3.36);
  const splitterMesh = new THREE.Mesh(splitterGeo, carbonMat);
  splitterMesh.position.set(0, -0.14, 0.0);
  splitterMesh.castShadow = !isSoftwareGl;
  bodyGroup.add(splitterMesh);

  // --- Part 3: Tinted Windshield & Cabin Canopy ---
  const canopyGeo = new THREE.BoxGeometry(1.16, 0.28, 1.18);
  const canopyMesh = new THREE.Mesh(canopyGeo, glassMat);
  canopyMesh.position.set(0, customization.body === 'octane' ? 0.36 : 0.3, -0.14);
  canopyMesh.rotation.x = 0.14;
  bodyGroup.add(canopyMesh);

  // --- Part 4: Rear Spoiler Wing & Twin Struts ---
  const wingY = customization.body === 'octane' ? 0.72 : 0.56;
  const wingZ = -1.55;
  const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.08, 0.42), accentMat);
  wingBlade.position.set(0, wingY, wingZ);
  wingBlade.rotation.x = -0.16;
  wingBlade.castShadow = !isSoftwareGl;
  bodyGroup.add(wingBlade);

  const strutGeo = new THREE.BoxGeometry(0.08, 0.36, 0.22);
  for (const sx of [-0.54, 0.54]) {
    const strut = new THREE.Mesh(strutGeo, carbonMat);
    strut.position.set(sx, wingY - 0.18, wingZ + 0.05);
    strut.rotation.x = -0.2;
    bodyGroup.add(strut);
  }

  // --- Part 5: Side Accent Skirts ---
  const skirtGeo = new THREE.BoxGeometry(0.1, 0.12, 2.25);
  for (const sx of [-0.86, 0.86]) {
    const skirt = new THREE.Mesh(skirtGeo, accentMat);
    skirt.position.set(sx, -0.06, 0);
    bodyGroup.add(skirt);
  }

  // --- Part 6: Headlights & Taillights ---
  const headMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const lightGeo = new THREE.BoxGeometry(0.32, 0.08, 0.08);
  for (const lx of [-0.54, 0.54]) {
    const hl = new THREE.Mesh(lightGeo, headMat);
    hl.position.set(lx, 0.02, 1.72);
    bodyGroup.add(hl);

    const tl = new THREE.Mesh(lightGeo, tailMat);
    tl.position.set(lx, 0.1, -1.78);
    bodyGroup.add(tl);
  }

  // --- Part 7: Twin Rocket Thruster Nozzles & Boost Flame Cones ---
  const nozzleGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.34, 14);
  nozzleGeo.rotateX(Math.PI / 2);
  const flameGeo = new THREE.ConeGeometry(0.2, 1.65, 12);
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.translate(0, 0, -0.82);

  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.boostColor),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const flameCones: THREE.Mesh[] = [];
  for (const nx of [-0.36, 0.36]) {
    const nozzle = new THREE.Mesh(nozzleGeo, chromeMat);
    nozzle.position.set(nx, 0.18, -1.78);
    bodyGroup.add(nozzle);

    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(nx, 0.18, -1.9);
    flame.visible = false;
    bodyGroup.add(flame);
    flameCones.push(flame);
  }

  // --- Part 8-11: 4 Articulated Wheels (Tire + Deep-Dish Rim + Spokes) ---
  const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.31, 14);
  rimGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.33, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.32, 0.045, 0.44);

  const wheelPositions: Array<[number, number, number]> = [
    [0.86, -0.2, 1.12], // Front Left
    [-0.86, -0.2, 1.12], // Front Right
    [0.88, -0.2, -1.08], // Rear Left
    [-0.88, -0.2, -1.08], // Rear Right
  ];

  const wheelPivots: THREE.Group[] = [];
  const wheelMeshes: THREE.Group[] = [];
  const rimMat = customization.wheelStyle === 'aero' ? accentMat : chromeMat;

  for (const [wx, wy, wz] of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    const wheel = new THREE.Group();

    const tire = new THREE.Mesh(tireGeo, carbonMat);
    tire.castShadow = !isSoftwareGl;
    wheel.add(tire);

    const rim = new THREE.Mesh(rimGeo, rimMat);
    wheel.add(rim);

    const hub = new THREE.Mesh(hubGeo, accentMat);
    wheel.add(hub);

    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(spokeGeo, chromeMat);
      spoke.rotation.x = (s * Math.PI) / 3;
      wheel.add(spoke);
    }

    pivot.add(wheel);
    group.add(pivot);
    wheelPivots.push(pivot);
    wheelMeshes.push(wheel);
  }

  // --- Contact Shadow Disc ---
  const shadowTex = createContactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.4), shadowMat);
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.025;

  const dispose = () => {
    decalTex.dispose();
    shadowTex.dispose();
    hullGeo.dispose();
    splitterGeo.dispose();
    canopyGeo.dispose();
    wingBlade.geometry.dispose();
    strutGeo.dispose();
    skirtGeo.dispose();
    lightGeo.dispose();
    nozzleGeo.dispose();
    flameGeo.dispose();
    tireGeo.dispose();
    rimGeo.dispose();
    hubGeo.dispose();
    spokeGeo.dispose();
    contactShadow.geometry.dispose();
    primaryMat.dispose();
    accentMat.dispose();
    carbonMat.dispose();
    glassMat.dispose();
    chromeMat.dispose();
    headMat.dispose();
    tailMat.dispose();
    flameMat.dispose();
    shadowMat.dispose();
  };

  return {
    group,
    bodyGroup,
    wheelPivots,
    wheelMeshes,
    flameCones,
    primaryMat,
    accentMat,
    flameMat,
    contactShadow,
    dispose,
  };
}
