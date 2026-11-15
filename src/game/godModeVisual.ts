import * as THREE from 'three';
import type { CarVisualRig } from './carMesh';
import type { GameStateSnapshot } from '../shared/types';

type Paint = { primary: THREE.Color; emissive: THREE.Color; intensity: number; accent: THREE.Color; accentEmissive: THREE.Color; accentIntensity: number; flame: THREE.Color };
const paints = new WeakMap<CarVisualRig, Paint>();

export function animateGodModeCar(rig: CarVisualRig, active: boolean, time: number) {
  if (active) {
    if (!paints.has(rig)) paints.set(rig, {
      primary: rig.primaryMat.color.clone(), emissive: rig.primaryMat.emissive.clone(), intensity: rig.primaryMat.emissiveIntensity,
      accent: rig.accentMat.color.clone(), accentEmissive: rig.accentMat.emissive.clone(), accentIntensity: rig.accentMat.emissiveIntensity,
      flame: rig.flameMat.color.clone(),
    });
    const hue = (time * 0.65) % 1;
    rig.primaryMat.color.setHSL(hue, 1, 0.65);
    rig.primaryMat.emissive.setHSL(hue, 1, 0.5);
    rig.primaryMat.emissiveIntensity = 0.75 + Math.sin(time * 15) * 0.2;
    rig.accentMat.color.setHSL((hue + 0.35) % 1, 1, 0.65);
    rig.accentMat.emissive.copy(rig.accentMat.color);
    rig.accentMat.emissiveIntensity = 0.65;
    rig.flameMat.color.setHSL((hue + 0.6) % 1, 1, 0.65);
    rig.bodyGroup.scale.setScalar(1.02 + Math.sin(time * 12) * 0.015);
  } else {
    const paint = paints.get(rig);
    if (!paint) return;
    rig.primaryMat.color.copy(paint.primary);
    rig.primaryMat.emissive.copy(paint.emissive);
    rig.primaryMat.emissiveIntensity = paint.intensity;
    rig.accentMat.color.copy(paint.accent);
    rig.accentMat.emissive.copy(paint.accentEmissive);
    rig.accentMat.emissiveIntensity = paint.accentIntensity;
    rig.flameMat.color.copy(paint.flame);
    rig.bodyGroup.scale.setScalar(1);
    paints.delete(rig);
  }
}

export function createGodModeItemVisual() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? 1.35 : 0.6;
    if (i === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2, steps: 1 });
  geometry.center();
  const material = new THREE.MeshStandardMaterial({ color: 0xffdd44, emissive: 0xffaa00, emissiveIntensity: 1.3, metalness: 0.55, roughness: 0.2 });
  const star = new THREE.Mesh(geometry, material);
  group.add(star);
  const haloGeo = new THREE.TorusGeometry(3.5, 0.13, 6, 48);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0x77ffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -1.6;
  group.add(halo);
  const glowGeo = new THREE.SphereGeometry(1.85, 16, 10);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  group.add(glow);
  const beamGeo = new THREE.CylinderGeometry(0.75, 1.65, 16, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.2, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  group.add(beam);
  group.visible = false;
  return {
    group,
    update(item: GameStateSnapshot['powerUps']['item'] | undefined, time: number, visible: boolean) {
      group.visible = Boolean(item) && visible;
      if (!item) return;
      group.position.set(item.pos.x, item.pos.y + Math.sin(time * 3) * 0.25, item.pos.z);
      halo.position.y = 0.13 - group.position.y;
      beam.position.y = 8 - group.position.y;
      star.rotation.set(Math.sin(time * 2) * 0.12, time * 1.8, Math.sin(time * 2.5) * 0.12);
      star.scale.setScalar(2 * (1 + Math.sin(time * 7) * 0.06));
      material.emissive.setHSL((time * 0.35) % 1, 1, 0.5);
      haloMat.color.setHSL((time * 0.5 + 0.3) % 1, 1, 0.65);
      halo.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
      glowMat.color.copy(material.emissive);
      glow.scale.setScalar(1.6 + Math.sin(time * 5) * 0.12);
      beamMat.color.copy(haloMat.color);
    },
    dispose() {
      group.removeFromParent();
      for (const geometry of [star.geometry, haloGeo, glowGeo, beamGeo]) geometry.dispose();
      for (const mat of [material, haloMat, glowMat, beamMat]) mat.dispose();
    },
  };
}
