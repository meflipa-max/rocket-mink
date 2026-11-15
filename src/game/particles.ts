import * as THREE from 'three';

type LayerKind = 'smoke' | 'glow' | 'ring' | 'shard';

interface ParticleSlot {
  active: boolean;
  age: number;
  maxAge: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  spin: number;
  spinSpeed: number;
  gravity: number;
  drag: number;
  swirl: number;
  swirlAxis: THREE.Vector3;
  startScale: number;
  endScale: number;
  maxAlpha: number;
  color: THREE.Color;
}

const COUNTS: Record<LayerKind, number> = {
  smoke: 240,
  glow: 260,
  ring: 120,
  shard: 120,
};

const _dummy = new THREE.Object3D();
const _quatTmp = new THREE.Quaternion();
const _axisZ = new THREE.Vector3(0, 0, 1);
const _tangent = new THREE.Vector3();

function createSmokeCloudTexture(): THREE.CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);

  // Soft overlapping radial lobes for organic volumetric cloud silhouette
  const lobes: Array<[number, number, number, number]> = [
    [64, 64, 52, 0.65],
    [48, 56, 36, 0.45],
    [80, 58, 34, 0.45],
    [56, 78, 34, 0.42],
    [74, 76, 32, 0.40],
    [64, 46, 30, 0.38],
  ];
  for (const [cx, cy, r, a] of lobes) {
    const grad = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.5, `rgba(255,255,255,${a * 0.48})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createStarFlareTexture(): THREE.CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);

  // Outer radiant bloom
  const bloom = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
  bloom.addColorStop(0, 'rgba(255,255,255,1)');
  bloom.addColorStop(0.24, 'rgba(255,255,255,0.75)');
  bloom.addColorStop(0.55, 'rgba(255,255,255,0.20)');
  bloom.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, S, S);

  // Crisp 4-point star flare spikes
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.quadraticCurveTo(68, 58, 122, 64);
  ctx.quadraticCurveTo(68, 70, 64, 122);
  ctx.quadraticCurveTo(60, 70, 6, 64);
  ctx.quadraticCurveTo(60, 58, 64, 6);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBillboardMaterial(
  map: THREE.Texture,
  blending: THREE.Blending,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
    },
    vertexShader: `
      attribute float aAlpha;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vUv = uv;
        vAlpha = aAlpha;
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        vec4 mvPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        float alpha = tex.a * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(tex.rgb * vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending,
  });
}

function createFresnelMeshMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vAlpha = aAlpha;
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        vec4 localPos = vec4(position, 1.0);
        vec3 transformedNormal = normal;
        #ifdef USE_INSTANCING
          localPos = instanceMatrix * localPos;
          transformedNormal = mat3(instanceMatrix) * transformedNormal;
        #endif
        vec4 mvPosition = modelViewMatrix * localPos;
        vNormal = normalize(normalMatrix * transformedNormal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        if (vAlpha < 0.01) discard;
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.4);
        vec3 col = vColor * (0.72 + rim * 0.95);
        gl_FragColor = vec4(col, vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface LayerPool {
  kind: LayerKind;
  mesh: THREE.InstancedMesh;
  slots: ParticleSlot[];
  alphas: Float32Array;
  alphaAttr: THREE.InstancedBufferAttribute;
  cursor: number;
  billboard: boolean;
}

export interface SpawnAdvancedOpts {
  layer: LayerKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  colorHex: string | number;
  startScale: number;
  endScale: number;
  maxAge: number;
  maxAlpha?: number;
  gravity?: number;
  drag?: number;
  swirl?: number;
  swirlAxisX?: number;
  swirlAxisY?: number;
  swirlAxisZ?: number;
  spinSpeed?: number;
  quat?: THREE.Quaternion;
}

export class ParticlePool {
  public readonly group = new THREE.Group();
  public readonly mesh: THREE.Group;
  private readonly layers: Record<LayerKind, LayerPool>;
  private readonly textures: THREE.Texture[] = [];

  constructor() {
    this.mesh = this.group;

    const smokeTex = createSmokeCloudTexture();
    const flareTex = createStarFlareTexture();
    this.textures.push(smokeTex, flareTex);

    const planeGeo = new THREE.PlaneGeometry(1, 1);
    const ringGeo = new THREE.TorusGeometry(0.45, 0.055, 8, 22);
    const shardGeo = new THREE.OctahedronGeometry(0.28, 0);

    const smokeMat = createBillboardMaterial(smokeTex, THREE.NormalBlending);
    const glowMat = createBillboardMaterial(flareTex, THREE.AdditiveBlending);
    const ringMat = createFresnelMeshMaterial();
    const shardMat = createFresnelMeshMaterial();

    this.layers = {
      smoke: this.createLayer('smoke', planeGeo, smokeMat, COUNTS.smoke, true, 1),
      glow: this.createLayer('glow', planeGeo, glowMat, COUNTS.glow, true, 2),
      ring: this.createLayer('ring', ringGeo, ringMat, COUNTS.ring, false, 2),
      shard: this.createLayer('shard', shardGeo, shardMat, COUNTS.shard, false, 2),
    };
  }

  private createLayer(
    kind: LayerKind,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    count: number,
    billboard: boolean,
    renderOrder: number,
  ): LayerPool {
    // Clone geometry so each InstancedMesh owns its own aAlpha InstancedBufferAttribute
    const instGeo = geo.clone();
    const alphas = new Float32Array(count);
    const alphaAttr = new THREE.InstancedBufferAttribute(alphas, 1);
    alphaAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aAlpha', alphaAttr);

    const instMesh = new THREE.InstancedMesh(instGeo, mat, count);
    instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instMesh.frustumCulled = false;
    instMesh.renderOrder = renderOrder;

    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    const defaultColor = new THREE.Color(0xffffff);
    const slots: ParticleSlot[] = [];
    for (let i = 0; i < count; i++) {
      slots.push({
        active: false,
        age: 0,
        maxAge: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        spin: 0,
        spinSpeed: 0,
        gravity: 0,
        drag: 0,
        swirl: 0,
        swirlAxis: new THREE.Vector3(0, 0, 1),
        startScale: 1,
        endScale: 0,
        maxAlpha: 1,
        color: new THREE.Color(0xffffff),
      });
      instMesh.setMatrixAt(i, zeroMat);
      instMesh.setColorAt(i, defaultColor);
    }
    instMesh.instanceMatrix.needsUpdate = true;
    if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;

    this.group.add(instMesh);
    return {
      kind,
      mesh: instMesh,
      slots,
      alphas,
      alphaAttr,
      cursor: 0,
      billboard,
    };
  }

  public clear(): void {
    _dummy.position.set(0, -100, 0);
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    for (const layer of Object.values(this.layers)) {
      for (let i = 0; i < layer.slots.length; i++) {
        layer.slots[i].active = false;
        layer.alphas[i] = 0;
        layer.mesh.setMatrixAt(i, _dummy.matrix);
      }
      layer.mesh.instanceMatrix.needsUpdate = true;
      layer.alphaAttr.needsUpdate = true;
    }
  }

  public spawnAdvanced(opts: SpawnAdvancedOpts): void {
    const layer = this.layers[opts.layer];
    const idx = layer.cursor;
    layer.cursor = (layer.cursor + 1) % layer.slots.length;
    const slot = layer.slots[idx];

    slot.active = true;
    slot.age = 0;
    slot.maxAge = Math.max(0.05, opts.maxAge);
    slot.pos.set(opts.x, opts.y, opts.z);
    slot.vel.set(opts.vx, opts.vy, opts.vz);
    if (opts.quat) {
      slot.quat.copy(opts.quat);
    } else {
      slot.quat.identity();
    }
    slot.spin = Math.random() * Math.PI * 2;
    slot.spinSpeed = opts.spinSpeed ?? (Math.random() - 0.5) * 4;
    slot.gravity = opts.gravity ?? 0;
    slot.drag = opts.drag ?? 0;
    slot.swirl = opts.swirl ?? 0;
    slot.swirlAxis.set(
      opts.swirlAxisX ?? 0,
      opts.swirlAxisY ?? 0,
      opts.swirlAxisZ ?? 1,
    );
    if (slot.swirlAxis.lengthSq() < 1e-4) slot.swirlAxis.set(0, 0, 1);
    else slot.swirlAxis.normalize();

    slot.startScale = opts.startScale;
    slot.endScale = opts.endScale;
    slot.maxAlpha = opts.maxAlpha ?? 0.95;
    slot.color.set(opts.colorHex);

    layer.mesh.setColorAt(idx, slot.color);
    if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
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
    this.spawnAdvanced({
      layer: 'glow',
      x,
      y,
      z,
      vx,
      vy,
      vz,
      colorHex,
      startScale: startScale * 1.15,
      endScale: Math.max(0.02, endScale),
      maxAge,
      maxAlpha: 0.95,
      gravity: 7.5,
      drag: 0.6,
    });
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

  public update(dt: number, cameraQuat?: THREE.Quaternion): void {
    for (const layer of Object.values(this.layers)) {
      let dirtyMatrix = false;
      for (let i = 0; i < layer.slots.length; i++) {
        const s = layer.slots[i];
        if (!s.active) continue;

        dirtyMatrix = true;
        s.age += dt;
        if (s.age >= s.maxAge) {
          s.active = false;
          layer.alphas[i] = 0;
          _dummy.position.set(0, -100, 0);
          _dummy.scale.set(0, 0, 0);
          _dummy.updateMatrix();
          layer.mesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        const t = s.age / s.maxAge;

        // Swirl turbulence perpendicular to exhaust axis
        if (s.swirl !== 0) {
          _tangent.crossVectors(s.vel, s.swirlAxis);
          if (_tangent.lengthSq() > 1e-4) {
            _tangent.normalize();
            const wave = Math.sin(s.age * 11 + i) * s.swirl * dt;
            s.vel.addScaledVector(_tangent, wave * 2.2);
          }
        }

        if (s.drag > 0) {
          const damp = Math.exp(-s.drag * dt);
          s.vel.multiplyScalar(damp);
        }
        s.vel.y -= s.gravity * dt;

        s.pos.x += s.vel.x * dt;
        s.pos.y += s.vel.y * dt;
        s.pos.z += s.vel.z * dt;
        s.spin += s.spinSpeed * dt;

        // Smooth fade-in (0 -> 0.14) and fade-out (0.14 -> 1.0)
        const fadeIn = t < 0.14 ? t / 0.14 : 1;
        const fadeOut = 1 - Math.pow(t, 1.35);
        layer.alphas[i] = s.maxAlpha * fadeIn * fadeOut;

        const scale = s.startScale + (s.endScale - s.startScale) * t;
        _dummy.position.copy(s.pos);
        if (layer.billboard && cameraQuat) {
          _quatTmp.setFromAxisAngle(_axisZ, s.spin);
          _dummy.quaternion.copy(cameraQuat).multiply(_quatTmp);
        } else if (layer.kind === 'ring') {
          _quatTmp.setFromAxisAngle(_axisZ, s.spin * 0.5);
          _dummy.quaternion.copy(s.quat).multiply(_quatTmp);
        } else {
          _dummy.rotation.set(s.spin, s.spin * 0.7, s.spin * 0.4);
        }
        _dummy.scale.setScalar(Math.max(0.001, scale));
        _dummy.updateMatrix();
        layer.mesh.setMatrixAt(i, _dummy.matrix);
      }

      if (dirtyMatrix) {
        layer.mesh.instanceMatrix.needsUpdate = true;
        layer.alphaAttr.needsUpdate = true;
      }
    }
  }

  public dispose(): void {
    for (const tex of this.textures) tex.dispose();
    for (const layer of Object.values(this.layers)) {
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
    }
  }
}
