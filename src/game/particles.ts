import * as THREE from 'three';

interface ParticleSlot {
  active: boolean;
  age: number;
  maxAge: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  startScale: number;
  endScale: number;
  color: THREE.Color;
}

const MAX_PARTICLES = 320;
const _dummy = new THREE.Object3D();

export class ParticlePool {
  public readonly mesh: THREE.InstancedMesh;
  private readonly slots: ParticleSlot[] = [];
  private cursor = 0;

  constructor() {
    const geo = new THREE.IcosahedronGeometry(0.32, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    const defaultColor = new THREE.Color(0xffffff);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.slots.push({
        active: false,
        age: 0,
        maxAge: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        startScale: 1,
        endScale: 0,
        color: new THREE.Color(0xffffff),
      });
      this.mesh.setMatrixAt(i, zeroMat);
      this.mesh.setColorAt(i, defaultColor);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: string | number,
    startScale: number,
    endScale: number,
    maxAge: number,
  ): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    slot.active = true;
    slot.age = 0;
    slot.maxAge = maxAge;
    slot.pos.set(x, y, z);
    slot.vel.set(vx, vy, vz);
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.color.set(colorHex);
    this.mesh.setColorAt(this.cursor === 0 ? MAX_PARTICLES - 1 : this.cursor - 1, slot.color);
  }

  public spawnBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    speed: number,
    colorHex: string | number,
    size = 1.1,
    life = 0.65,
  ): void {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const mag = speed * (0.45 + Math.random() * 0.75);
      const vx = Math.sin(phi) * Math.cos(theta) * mag;
      const vy = Math.abs(Math.cos(phi)) * mag + 2.5;
      const vz = Math.sin(phi) * Math.sin(theta) * mag;
      this.spawn(
        x,
        y,
        z,
        vx,
        vy,
        vz,
        colorHex,
        size * (0.7 + Math.random() * 0.6),
        0.02,
        life * (0.7 + Math.random() * 0.6),
      );
    }
  }

  public update(dt: number): void {
    let anyColor = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.maxAge) {
        s.active = false;
        _dummy.position.set(0, -100, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.mesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      const t = s.age / s.maxAge;
      s.pos.x += s.vel.x * dt;
      s.pos.y += s.vel.y * dt;
      s.pos.z += s.vel.z * dt;
      s.vel.y -= 7.5 * dt;

      const scale = s.startScale + (s.endScale - s.startScale) * t;
      _dummy.position.copy(s.pos);
      _dummy.rotation.set(s.age * 4, s.age * 3, 0);
      _dummy.scale.setScalar(Math.max(0.001, scale));
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
      anyColor = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (anyColor && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
