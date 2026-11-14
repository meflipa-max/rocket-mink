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
  paintFinish: NonNullable<CarCustomization['paintFinish']>,
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
  } else if (decal === 'cyber') {
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(48, 0);
    ctx.lineTo(48, 92);
    ctx.lineTo(84, 128);
    ctx.lineTo(84, 256);
    ctx.moveTo(208, 0);
    ctx.lineTo(208, 92);
    ctx.lineTo(172, 128);
    ctx.lineTo(172, 256);
    ctx.moveTo(128, 30);
    ctx.lineTo(128, 226);
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.fillRect(114, 108, 28, 28);
  } else if (decal === 'wings') {
    ctx.fillStyle = accentColor;
    for (const offset of [40, 120, 195]) {
      ctx.beginPath();
      ctx.moveTo(128, offset - 32);
      ctx.lineTo(232, offset + 24);
      ctx.lineTo(232, offset + 54);
      ctx.lineTo(128, offset - 2);
      ctx.lineTo(24, offset + 54);
      ctx.lineTo(24, offset + 24);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Paint finish texture micro-grain
  const flakeAlpha = paintFinish === 'metallic' ? 0.08 : paintFinish === 'matte' ? 0.025 : 0.03;
  ctx.fillStyle = `rgba(255,255,255,${flakeAlpha})`;
  for (let i = 0; i < 200; i++) {
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
  const grad = ctx.createRadialGradient(64, 64, 14, 64, 64, 62);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.4)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createExtrudedHull(body: CarCustomization['body']): THREE.BufferGeometry {
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
  } else if (body === 'fennec') {
    // Boxy Fennec rally hatchback silhouette: blunt nose, muscular roofline, steep rear hatch
    shape.moveTo(-1.72, -0.18);
    shape.lineTo(1.76, -0.18);
    shape.lineTo(1.82, 0.14);
    shape.lineTo(1.52, 0.30);
    shape.lineTo(0.70, 0.36);
    shape.lineTo(0.28, 0.72);
    shape.lineTo(-1.12, 0.70);
    shape.lineTo(-1.58, 0.42);
    shape.lineTo(-1.74, 0.18);
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

  const width = body === 'dominus' ? 1.56 : body === 'fennec' ? 1.54 : 1.48;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.09,
    bevelSegments: 2,
  });

  geo.center();
  geo.rotateY(-Math.PI / 2);

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

  const paintFinish = customization.paintFinish ?? 'metallic';
  const topper = customization.topper ?? 'none';
  const underglow = Boolean(customization.underglow);

  const decalTex = createDecalTexture(
    customization.primaryColor,
    customization.accentColor,
    customization.decal,
    paintFinish,
  );

  // 1. Primary Chassis Material tuned to selected PaintFinish
  const finishProps =
    paintFinish === 'matte'
      ? { metalness: 0.08, roughness: 0.78, clearcoat: 0.0, clearcoatRoughness: 0.5 }
      : paintFinish === 'anodized'
        ? { metalness: 0.86, roughness: 0.14, clearcoat: 1.0, clearcoatRoughness: 0.06 }
        : paintFinish === 'gloss'
          ? { metalness: 0.18, roughness: 0.16, clearcoat: 1.0, clearcoatRoughness: 0.06 }
          : { metalness: 0.5, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.12 };

  const primaryMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: decalTex,
    ...finishProps,
  });

  // 2. Accent Matte/Metallic Trim Material
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(customization.accentColor),
    metalness: 0.62,
    roughness: 0.32,
  });

  // 3. Emissive Accent Material (used for halo, cyber wheel rings, underglow)
  const emissiveAccentMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.accentColor),
  });

  // 4. Dark Carbon Chassis / Bumper Material
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x161b26,
    metalness: 0.2,
    roughness: 0.78,
  });

  // 5. Tinted Glass Canopy Material
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1220,
    metalness: 0.1,
    roughness: 0.08,
    clearcoat: 1.0,
    opacity: isSoftwareGl ? 0.85 : 0.92,
    transparent: true,
  });

  // 6. Metallic Rim & Thruster Nozzle Material
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd1d5db,
    metalness: 0.88,
    roughness: 0.18,
  });

  const disposableGeos: THREE.BufferGeometry[] = [];
  const disposableMats: THREE.Material[] = [
    primaryMat,
    accentMat,
    emissiveAccentMat,
    carbonMat,
    glassMat,
    chromeMat,
  ];
  const disposableTex: THREE.Texture[] = [decalTex];

  // --- Part 1: Main Sculpted Extruded Hull ---
  const hullGeo = createExtrudedHull(customization.body);
  disposableGeos.push(hullGeo);
  const hullMesh = new THREE.Mesh(hullGeo, primaryMat);
  hullMesh.position.y = 0.08;
  hullMesh.castShadow = !isSoftwareGl;
  hullMesh.receiveShadow = !isSoftwareGl;
  bodyGroup.add(hullMesh);

  // --- Part 2: Lower Carbon Underbody & Front Splitter ---
  const splitterGeo = new THREE.BoxGeometry(1.68, 0.12, 3.36);
  disposableGeos.push(splitterGeo);
  const splitterMesh = new THREE.Mesh(splitterGeo, carbonMat);
  splitterMesh.position.set(0, -0.14, 0.0);
  splitterMesh.castShadow = !isSoftwareGl;
  bodyGroup.add(splitterMesh);

  // --- Part 3: Tinted Windshield & Cabin Canopy ---
  const canopyGeo = new THREE.BoxGeometry(1.16, 0.28, customization.body === 'fennec' ? 1.18 : 1.18);
  disposableGeos.push(canopyGeo);
  const canopyMesh = new THREE.Mesh(canopyGeo, glassMat);
  canopyMesh.position.set(
    0,
    customization.body === 'dominus' ? 0.3 : customization.body === 'fennec' ? 0.43 : 0.38,
    customization.body === 'fennec' ? -0.30 : -0.14,
  );
  canopyMesh.rotation.x = customization.body === 'fennec' ? 0.08 : 0.14;
  bodyGroup.add(canopyMesh);

  // --- Part 4: Rear Spoiler Wing & Twin Struts ---
  const wingY =
    customization.body === 'fennec' ? 0.74 : customization.body === 'octane' ? 0.72 : 0.56;
  const wingZ = customization.body === 'fennec' ? -1.42 : -1.55;
  const wingGeo = new THREE.BoxGeometry(1.78, 0.08, customization.body === 'fennec' ? 0.34 : 0.42);
  disposableGeos.push(wingGeo);
  const wingBlade = new THREE.Mesh(wingGeo, accentMat);
  wingBlade.position.set(0, wingY, wingZ);
  wingBlade.rotation.x = -0.16;
  wingBlade.castShadow = !isSoftwareGl;
  bodyGroup.add(wingBlade);

  const strutGeo = new THREE.BoxGeometry(0.08, customization.body === 'fennec' ? 0.22 : 0.36, 0.22);
  disposableGeos.push(strutGeo);
  for (const sx of [-0.54, 0.54]) {
    const strut = new THREE.Mesh(strutGeo, carbonMat);
    strut.position.set(sx, wingY - 0.14, wingZ + 0.05);
    strut.rotation.x = -0.2;
    bodyGroup.add(strut);
  }

  // --- Part 5: Side Accent Skirts ---
  const skirtGeo = new THREE.BoxGeometry(0.1, 0.12, 2.25);
  disposableGeos.push(skirtGeo);
  for (const sx of [-0.86, 0.86]) {
    const skirt = new THREE.Mesh(skirtGeo, accentMat);
    skirt.position.set(sx, -0.06, 0);
    bodyGroup.add(skirt);
  }

  // --- Optional Neon Underglow Strip ---
  if (underglow) {
    const glowTex = createUnderglowTexture(customization.accentColor);
    disposableTex.push(glowTex);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    disposableMats.push(glowMat);
    const glowGeo = new THREE.PlaneGeometry(3.0, 4.4);
    disposableGeos.push(glowGeo);
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.rotation.x = -Math.PI / 2;
    glowMesh.position.set(0, -0.49, 0);
    group.add(glowMesh);
  }

  // --- Optional Roof Topper (Halo / Crown / Aero Fin) ---
  const roofY =
    customization.body === 'fennec' ? 0.68 : customization.body === 'octane' ? 0.64 : 0.54;
  if (topper === 'halo') {
    const haloGeo = new THREE.TorusGeometry(0.42, 0.05, 10, 28);
    haloGeo.rotateX(Math.PI / 2);
    disposableGeos.push(haloGeo);
    const halo = new THREE.Mesh(haloGeo, emissiveAccentMat);
    halo.position.set(0, roofY + 0.28, -0.25);
    bodyGroup.add(halo);
  } else if (topper === 'crown') {
    const crownBaseGeo = new THREE.CylinderGeometry(0.28, 0.24, 0.18, 6);
    disposableGeos.push(crownBaseGeo);
    const crownBase = new THREE.Mesh(crownBaseGeo, accentMat);
    crownBase.position.set(0, roofY + 0.14, -0.25);
    bodyGroup.add(crownBase);

    const spikeGeo = new THREE.ConeGeometry(0.065, 0.16, 4);
    disposableGeos.push(spikeGeo);
    for (let i = 0; i < 6; i++) {
      const ang = (i * Math.PI) / 3;
      const spike = new THREE.Mesh(spikeGeo, emissiveAccentMat);
      spike.position.set(Math.cos(ang) * 0.2, roofY + 0.26, -0.25 + Math.sin(ang) * 0.2);
      bodyGroup.add(spike);
    }
  } else if (topper === 'fin') {
    const finShape = new THREE.Shape();
    finShape.moveTo(-0.42, 0);
    finShape.lineTo(0.32, 0);
    finShape.lineTo(-0.28, 0.34);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.05,
      bevelEnabled: false,
    });
    finGeo.center();
    finGeo.rotateY(-Math.PI / 2);
    disposableGeos.push(finGeo);
    const fin = new THREE.Mesh(finGeo, accentMat);
    fin.position.set(0, roofY + 0.17, -0.35);
    bodyGroup.add(fin);
  }

  // --- Part 6: Headlights & Taillights ---
  const headMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  disposableMats.push(headMat, tailMat);
  const lightGeo = new THREE.BoxGeometry(0.32, 0.08, 0.08);
  disposableGeos.push(lightGeo);
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
  disposableGeos.push(nozzleGeo, flameGeo);

  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.boostColor),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposableMats.push(flameMat);

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

  // --- Part 8-11: 4 Articulated Wheels (4 Distinct Rim Styles) ---
  const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.31, 14);
  rimGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.33, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.32, 0.045, 0.44);
  const ringGeo = new THREE.TorusGeometry(0.22, 0.028, 8, 20);
  ringGeo.rotateY(Math.PI / 2);
  disposableGeos.push(tireGeo, rimGeo, hubGeo, spokeGeo, ringGeo);

  const wheelPositions: Array<[number, number, number]> = [
    [0.86, -0.2, 1.12],
    [-0.86, -0.2, 1.12],
    [0.88, -0.2, -1.08],
    [-0.88, -0.2, -1.08],
  ];

  const wheelPivots: THREE.Group[] = [];
  const wheelMeshes: THREE.Group[] = [];
  const rimMat =
    customization.wheelStyle === 'aero'
      ? accentMat
      : customization.wheelStyle === 'cyber'
        ? carbonMat
        : chromeMat;

  for (const [wx, wy, wz] of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    const wheel = new THREE.Group();

    const tire = new THREE.Mesh(tireGeo, carbonMat);
    tire.castShadow = !isSoftwareGl;
    wheel.add(tire);

    const rim = new THREE.Mesh(rimGeo, rimMat);
    wheel.add(rim);

    const hub = new THREE.Mesh(
      hubGeo,
      customization.wheelStyle === 'cyber' ? emissiveAccentMat : accentMat,
    );
    wheel.add(hub);

    if (customization.wheelStyle === 'cyber') {
      const sign = wx > 0 ? 1 : -1;
      const ring = new THREE.Mesh(ringGeo, emissiveAccentMat);
      ring.position.x = sign * 0.155;
      wheel.add(ring);
    } else if (customization.wheelStyle === 'turbine') {
      for (let s = 0; s < 6; s++) {
        const blade = new THREE.Mesh(spokeGeo, accentMat);
        blade.rotation.x = (s * Math.PI) / 6;
        wheel.add(blade);
      }
    } else if (customization.wheelStyle === 'aero') {
      const sign = wx > 0 ? 1 : -1;
      const ring = new THREE.Mesh(ringGeo, chromeMat);
      ring.position.x = sign * 0.155;
      wheel.add(ring);
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
  const shadowGeo = new THREE.PlaneGeometry(3.2, 4.4);
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
    primaryMat,
    accentMat,
    flameMat,
    contactShadow,
    dispose,
  };
}
