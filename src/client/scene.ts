import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { orientationForValue, topValue } from '../shared/orientations';
import type { Dice } from '../shared/protocol';
import { CONTACT_TIME, constrainContact, contactRollQuaternion } from './dice-contact';

export interface SceneOptions {
  onDieClick(id: number): void;
  onError(message: string): void;
  onAnimationChange?(active: boolean): void;
  onImpact?(intensity: number): void;
  onCollision?(intensity: number): void;
}
export interface SceneUpdate {
  rollKey: string;
  animate: boolean;
  interactive: boolean;
  reducedMotion: boolean;
  pending: boolean;
}
export interface DiceScene {
  update(dice: Dice[], options: SceneUpdate): void;
  dispose(): void;
}

const SIZE = 0.95;
const RADIUS = 0.095;
const FLOOR = 0.185;
const REST_Y = FLOOR + SIZE / 2;
const HELD_FLOOR = 0.3775;
const SHELF_Y = HELD_FLOOR + SIZE / 2;
const Z_LANES = [0.46, 1.1, 0.16, 1.08, 0.4];
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};
const ease = (t: number) => 1 - (1 - t) ** 3;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('재질을 준비할 수 없습니다.');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Deterministic original microtextures; no network, copied image or model assets.
function grain(kind: 'wood' | 'felt' | 'ivory') {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = { wood: '#d6bb93', felt: '#224d42', ivory: '#f0e8d7' }[kind];
    ctx.fillRect(0, 0, size, size);
    let seed = 113;
    const noise = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 27000; i++) {
      const x = noise() * size,
        y = noise() * size;
      ctx.fillStyle =
        noise() > 0.5
          ? `rgba(255,255,255,${kind === 'felt' ? 0.045 : 0.025})`
          : `rgba(20,20,12,${kind === 'felt' ? 0.1 : 0.027})`;
      ctx.fillRect(x, y, kind === 'wood' ? 20 + noise() * 90 : 1, kind === 'felt' ? 1.7 : 1);
    }
    if (kind === 'wood') {
      for (let i = 0; i < 80; i++) {
        ctx.strokeStyle = `rgba(114,78,37,${0.025 + noise() * 0.04})`;
        ctx.lineWidth = 0.5 + noise();
        ctx.beginPath();
        const y = noise() * size;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(150, y + noise() * 18, 390, y - noise() * 9, size, y + 2);
        ctx.stroke();
      }
    }
  });
}

function dieMaterials() {
  // RoundedBoxGeometry preserves BoxGeometry material order: +x,-x,+y,-y,+z,-z.
  return [3, 4, 1, 6, 2, 5].map((value) => {
    const map = canvasTexture((ctx, s) => {
      ctx.fillStyle = '#f0e8d7';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 6000; i++) {
        const x = (i * 137.31) % s,
          y = (i * 83.719) % s;
        ctx.fillStyle = i % 2 ? 'rgba(100,88,62,.023)' : 'rgba(255,255,255,.04)';
        ctx.fillRect(x, y, 1, 1);
      }
      for (const [u, v] of PIPS[value]) {
        const x = s / 2 + u * s * 0.235,
          y = s / 2 + v * s * 0.235,
          radius = s * 0.079;
        const shadow = ctx.createRadialGradient(x, y - 2, radius * 0.18, x, y, radius * 1.13);
        shadow.addColorStop(0, '#111b15');
        shadow.addColorStop(0.72, '#111b15');
        shadow.addColorStop(0.89, '#47564c');
        shadow.addColorStop(0.99, '#a6a591');
        shadow.addColorStop(1, '#f0e8d7');
        ctx.fillStyle = shadow;
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(22,30,24,.32)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.94, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
    });
    const bump = canvasTexture((ctx, s) => {
      ctx.fillStyle = '#eee';
      ctx.fillRect(0, 0, s, s);
      for (const [u, v] of PIPS[value]) {
        const x = s / 2 + u * s * 0.235,
          y = s / 2 + v * s * 0.235;
        const gradient = ctx.createRadialGradient(x, y, s * 0.052, x, y, s * 0.084);
        gradient.addColorStop(0, '#303030');
        gradient.addColorStop(0.67, '#404040');
        gradient.addColorStop(1, '#eee');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.084, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    bump.colorSpace = THREE.NoColorSpace;
    return new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: 0.035,
      color: 0xffffff,
      roughness: 0.37,
      metalness: 0,
      envMapIntensity: 0.35,
    });
  });
}

type Motion = {
  start: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  roll: boolean;
  impacts: number;
  startLift: number;
};
type VisualDie = {
  mesh: THREE.Mesh;
  hit: THREE.Mesh;
  halo: THREE.Mesh;
  shadow: THREE.Mesh;
  value: number;
  held: boolean;
  motion?: Motion;
};

export function createDiceScene(container: HTMLElement, options: SceneOptions): DiceScene {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch {
    queueMicrotask(() =>
      options.onError('3D 화면을 열 수 없습니다. 아래 숫자 주사위로 계속 플레이할 수 있어요.'),
    );
    return { update() {}, dispose() {} };
  }
  const gl = renderer.getContext();
  const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const deviceRenderer = rendererInfo
    ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL))
    : '';
  // Software rasterizers and small CPUs need a cheap first frame, before any adaptive samples exist.
  const lowPower =
    /swiftshader|llvmpipe|software rasterizer/i.test(deviceRenderer) ||
    (navigator.hardwareConcurrency || 8) <= 4;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-6, 6, 4.5, -4.5, 0.1, 60);
  camera.position.set(0, 13.5, 8.5);
  camera.lookAt(0, 0, 0.05);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.setAttribute('data-testid', 'dice-canvas');
  renderer.domElement.dataset.renderMode = lowPower ? 'lightweight' : 'full';
  renderer.domElement.style.cssText =
    'display:block;width:100%;height:100%;touch-action:pan-y;outline:none;';
  container.appendChild(renderer.domElement);
  let env: THREE.WebGLRenderTarget | undefined;
  function buildEnvironment() {
    if (lowPower) return;
    env?.dispose();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    env = pmrem.fromScene(room, 0.035);
    scene.environment = env.texture;
    room.dispose();
    pmrem.dispose();
  }
  buildEnvironment();

  const resources = new Set<THREE.Material | THREE.BufferGeometry | THREE.Texture>();
  const remember = <T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(
    asset: T,
  ): T => {
    resources.add(asset);
    return asset;
  };
  const wood = remember(grain('wood'));
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.repeat.set(1, 1);
  const felt = remember(grain('felt'));
  const woodMat = remember(
    new THREE.MeshStandardMaterial({ map: wood, color: '#f1e0c7', roughness: 0.73 }),
  );
  const rimMat = remember(
    new THREE.MeshStandardMaterial({ color: '#4c5146', roughness: 0.47, metalness: 0.12 }),
  );
  const edgeMat = remember(new THREE.MeshStandardMaterial({ color: '#213e35', roughness: 0.45 }));
  const brassMat = remember(
    new THREE.MeshStandardMaterial({ color: '#b6a075', roughness: 0.46, metalness: 0.54 }),
  );
  const feltMat = remember(
    new THREE.MeshStandardMaterial({
      map: felt,
      bumpMap: felt,
      bumpScale: 0.035,
      color: '#b3c3a9',
      roughness: 0.96,
    }),
  );
  function roundedOutline(w: number, d: number, radius: number) {
    const shape = new THREE.Shape();
    const x = -w / 2,
      y = -d / 2,
      r = Math.min(radius, w / 2, d / 2);
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + d - r);
    shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    shape.lineTo(x + r, y + d);
    shape.quadraticCurveTo(x, y + d, x, y + d - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    return shape;
  }
  function trayGeometry(
    w: number,
    h: number,
    d: number,
    radius: number,
    inner?: { w: number; d: number; r: number },
  ) {
    const shape = roundedOutline(w, d, radius);
    if (inner) shape.holes.push(roundedOutline(inner.w, inner.d, inner.r));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: h - 0.028,
      bevelEnabled: true,
      bevelThickness: 0.014,
      bevelSize: 0.014,
      bevelSegments: 2,
      curveSegments: 14,
      steps: 1,
    });
    const uv = geometry.attributes.uv,
      position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++)
      uv.setXY(i, position.getX(i) / w + 0.5, position.getY(i) / d + 0.5);
    geometry.translate(0, 0, -(h - 0.028) / 2);
    geometry.rotateX(-Math.PI / 2);
    return remember(geometry);
  }
  function box(
    w: number,
    h: number,
    d: number,
    radius: number,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const planarRadius = w > 9.2 ? 0.45 + (w - 9.34) * 0.16 : w > 9 ? 0.3 : 0.11;
    const mesh = new THREE.Mesh(
      w > 9 || w < 2
        ? trayGeometry(w, h, d, planarRadius)
        : remember(new RoundedBoxGeometry(w, h, d, 3, radius)),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }
  // Four stepped rim layers make the silhouette read as a heavy physical object.
  box(10.66, 0.22, 7.55, 0.17, woodMat, 0, -0.36);
  box(10.43, 0.15, 7.33, 0.07, brassMat, 0, -0.18);
  box(10.27, 0.22, 7.16, 0.1, edgeMat, 0, -0.08);
  box(10.06, 0.2, 6.95, 0.095, rimMat, 0, 0.045);
  box(9.78, 0.2, 6.68, 0.09, brassMat, 0, 0.07);
  box(9.67, 0.17, 6.59, 0.08, edgeMat, 0, 0.035);
  box(9.34, 0.13, 6.24, 0.065, feltMat, 0, 0.12);
  const wall = new THREE.Mesh(
    trayGeometry(9.68, 0.2, 6.6, 0.5, { w: 9.25, d: 6.17, r: 0.34 }),
    edgeMat,
  );
  wall.position.y = 0.22;
  wall.receiveShadow = true;
  wall.castShadow = true;
  scene.add(wall);
  // Raised upper shelf; five fixed positions preserve dice identity across hold changes.
  box(9.17, 0.21, 1.47, 0.1, edgeMat, 0, 0.235, -2.34);
  for (let id = 0; id < 5; id++) {
    box(1.59, 0.06, 1.18, 0.03, rimMat, (id - 2) * 1.8, 0.324, -2.36);
    box(1.47, 0.035, 1.08, 0.017, feltMat, (id - 2) * 1.8, 0.36, -2.36);
  }
  const ground = new THREE.Mesh(
    remember(new THREE.PlaneGeometry(200, 200)),
    remember(new THREE.ShadowMaterial({ color: '#51452f', opacity: 0.18 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.48;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight('#fff8e9', '#6a6b58', 1.3));
  const keyLight = new THREE.DirectionalLight('#fff4dd', 2.2);
  keyLight.position.set(-4, 10, 4);
  keyLight.castShadow = !lowPower;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, {
    left: -7,
    right: 7,
    top: 6,
    bottom: -6,
    near: 0.5,
    far: 25,
  });
  keyLight.shadow.normalBias = 0.035;
  keyLight.shadow.bias = -0.00025;
  keyLight.shadow.radius = 3;
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight('#d3e4ec', 0.65);
  fill.position.set(5, 7, -5);
  scene.add(fill);

  // Quiet maker's stamp printed on felt, authored entirely here.
  const stamp = remember(
    canvasTexture((ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(218,217,175,.35)';
      ctx.font = '28px Georgia';
      ctx.fillText('D I C E   A T E L I E R', size / 2, size / 2 - 13);
      ctx.strokeStyle = 'rgba(218,217,175,.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(180, 190);
      ctx.lineTo(332, 190);
      ctx.stroke();
    }),
  );
  const stampMesh = new THREE.Mesh(
    remember(new THREE.PlaneGeometry(4.6, 4.6)),
    remember(
      new THREE.MeshBasicMaterial({
        map: stamp,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  );
  stampMesh.rotation.x = -Math.PI / 2;
  stampMesh.position.set(0, FLOOR + 0.005, 1.85);
  scene.add(stampMesh);

  const geometry = remember(new RoundedBoxGeometry(SIZE, SIZE, SIZE, 5, RADIUS));
  const materials = dieMaterials();
  for (const material of materials) {
    remember(material);
    remember(material.map!);
    remember(material.bumpMap!);
  }
  const hitGeometry = remember(new THREE.BoxGeometry(1.65, 1.3, 1.7));
  const hitMaterial = remember(new THREE.MeshBasicMaterial({ visible: false }));
  const shadowMap = remember(
    canvasTexture((ctx, s) => {
      const gradient = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s / 2);
      gradient.addColorStop(0, 'rgba(9,21,17,.55)');
      gradient.addColorStop(0.45, 'rgba(9,21,17,.26)');
      gradient.addColorStop(1, 'rgba(9,21,17,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, s, s);
    }, 128),
  );
  const shadowGeometry = remember(new THREE.PlaneGeometry(1.7, 1.7));
  const haloGeometry = remember(new THREE.RingGeometry(0.61, 0.635, 48));
  const dice = new Map<number, VisualDie>();
  const home = [3, 5, 1, 6, 4];
  for (let id = 0; id < 5; id++) {
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set((id - 2) * 1.8, REST_Y, Z_LANES[id]);
    mesh.quaternion.copy(orientationForValue(home[id], (id - 2) * 0.11));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.dieId = id;
    scene.add(mesh);
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    hit.userData.dieId = id;
    hit.position.copy(mesh.position);
    scene.add(hit);
    const halo = new THREE.Mesh(
      haloGeometry,
      remember(
        new THREE.MeshBasicMaterial({
          color: '#dac99c',
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
      ),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.visible = false;
    scene.add(halo);
    const shadow = new THREE.Mesh(
      shadowGeometry,
      remember(
        new THREE.MeshBasicMaterial({
          map: shadowMap,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      ),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    scene.add(shadow);
    dice.set(id, { mesh, hit, halo, shadow, value: home[id], held: false });
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let disposed = false,
    contextLost = false,
    frame = 0,
    interactive = false,
    reduced = false,
    pending = false;
  let key: string | undefined,
    animating = false,
    hovered: number | undefined;
  let pendingStart = 0,
    lastFrame = 0,
    slowFrames = 0,
    quality = lowPower ? 1 : 1.75;
  let press: { x: number; y: number; id?: number } | undefined;
  let contact: { ids: [number, number]; start: number; fired: boolean } | undefined;
  const rotationMatrix = new THREE.Matrix4();
  function movingState(active: boolean) {
    if (active !== animating) {
      animating = active;
      options.onAnimationChange?.(active);
    }
  }
  function landing(die: Dice) {
    return new THREE.Vector3(
      (die.id - 2) * 1.8,
      die.held ? SHELF_Y : REST_Y,
      die.held ? -2.36 : Z_LANES[die.id],
    );
  }
  function updateAccessories(id: number, die: VisualDie) {
    die.hit.position.copy(die.mesh.position);
    const floor = die.held && !die.motion ? HELD_FLOOR + 0.005 : FLOOR + 0.008;
    die.halo.position.set(die.mesh.position.x, floor + 0.008, die.mesh.position.z);
    die.halo.visible = die.held || (interactive && id === hovered && !animating);
    die.shadow.position.set(die.mesh.position.x, floor, die.mesh.position.z);
    const height = Math.max(0, die.mesh.position.y - REST_Y);
    die.shadow.scale.setScalar(1 + height * 0.25);
    (die.shadow.material as THREE.MeshBasicMaterial).opacity = 0.57 / (1 + height);
  }
  function requestRender() {
    if (!disposed && !contextLost && !document.hidden && !frame)
      frame = requestAnimationFrame(render);
  }
  function render(now: number) {
    frame = 0;
    if (disposed || contextLost || document.hidden) return;
    let active = false;
    for (const [id, die] of dice) {
      const motion = die.motion;
      if (motion) {
        const t = clamp((now - motion.start) / motion.duration);
        const p = ease(t);
        die.mesh.position.lerpVectors(motion.from, motion.to, p);
        die.mesh.quaternion.slerpQuaternions(motion.fromQ, motion.toQ, p);
        if (motion.roll) {
          // Integer complete turns taper continuously to identity: never replace a face after resting.
          const spin = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(4 * Math.PI * p, 2 * Math.PI * p, 6 * Math.PI * p),
          );
          die.mesh.quaternion.multiply(spin);
          if (contact?.ids.includes(id))
            die.mesh.quaternion.copy(contactRollQuaternion(motion.fromQ, motion.toQ, t));
          die.mesh.position.x += Math.sin(t * Math.PI * 2 + id) * Math.sin(t * Math.PI) * 0.065;
          die.mesh.position.z += Math.sin(Math.PI * t) * 0.8;
          let bounce = 0;
          if (t < 0.45) bounce = 1.1 * Math.sin((Math.PI * t) / 0.45);
          else if (t < 0.73) bounce = 0.34 * Math.sin((Math.PI * (t - 0.45)) / 0.28);
          else if (t < 0.91) bounce = 0.1 * Math.sin((Math.PI * (t - 0.73)) / 0.18);
          // Support of a rounded box in world Y ensures it cannot penetrate the felt while tumbling.
          rotationMatrix.makeRotationFromQuaternion(die.mesh.quaternion);
          const m = rotationMatrix.elements;
          const support =
            (SIZE / 2 - RADIUS) * (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])) + RADIUS;
          die.mesh.position.y = FLOOR + support + Math.max(0, bounce) + motion.startLift * (1 - p);
          const impacts = t >= 0.91 ? 3 : t >= 0.73 ? 2 : t >= 0.45 ? 1 : 0;
          if (impacts > motion.impacts) {
            motion.impacts = impacts;
            // A single aggregate contact for every bounce bounds the mix, even with five dice.
            if (id === [...dice].find(([, v]) => v.motion?.roll)?.[0])
              options.onImpact?.([0.72, 0.39, 0.16][impacts - 1]);
          }
        } else {
          die.mesh.position.y += Math.sin(Math.PI * t) * 0.32;
        }
        if (t === 1) {
          die.mesh.position.copy(motion.to);
          die.mesh.quaternion.copy(motion.toQ);
          die.motion = undefined;
        } else active = true;
      }
      updateAccessories(id, die);
    }
    if (contact) {
      const a = dice.get(contact.ids[0])!;
      const b = dice.get(contact.ids[1])!;
      const t = clamp((now - contact.start) / 1100);
      if (a.motion?.roll && b.motion?.roll) {
        constrainContact(a.mesh.position, a.mesh.quaternion, b.mesh.position, b.mesh.quaternion, t);
        updateAccessories(contact.ids[0], a);
        updateAccessories(contact.ids[1], b);
        if (!contact.fired && t >= CONTACT_TIME && t <= 0.42) {
          contact.fired = true;
          options.onCollision?.(0.48);
        }
      }
      if (t >= 0.42) contact.fired = true;
      if (t === 1) contact = undefined;
    }
    const prepare = pending && !reduced && now - pendingStart < 500;
    const lean =
      active && !reduced ? Math.sin(Math.PI * clamp((now - pendingStart) / 1100)) * 0.055 : 0;
    camera.position.set(0, 13.5 + lean, 8.5);
    camera.lookAt(0, 0, 0.05);
    if (prepare && !active)
      scene.rotation.y = Math.sin(clamp((now - pendingStart) / 500) * Math.PI) * 0.004;
    else scene.rotation.y = 0;
    scene.updateMatrixWorld();
    renderer.render(scene, camera);
    renderer.domElement.dataset.topValues = JSON.stringify(
      [...dice.values()].map((die) => topValue(die.mesh.quaternion)),
    );
    renderer.domElement.dataset.diePositions = JSON.stringify(
      [...dice].map(([id, die]) => {
        const point = die.mesh.getWorldPosition(new THREE.Vector3()).project(camera);
        return { id, x: (point.x + 1) / 2, y: (1 - point.y) / 2 };
      }),
    );
    const rolling = [...dice.values()].some((die) => die.motion?.roll);
    renderer.domElement.dataset.animating = String(rolling);
    renderer.domElement.dataset.quality = String(quality);
    if (active && lastFrame && now - lastFrame > 29)
      slowFrames += Math.min(12, (now - lastFrame - 16.7) / 8);
    else if (active) slowFrames = Math.max(0, slowFrames - 0.3);
    if (slowFrames > 14 && quality > 1) {
      quality = Math.max(1, quality - 0.25);
      renderer.setPixelRatio(
        Math.max(0.8, (Math.min(window.devicePixelRatio || 1, 1.75) * quality) / 1.75),
      );
      keyLight.shadow.mapSize.set(512, 512);
      keyLight.shadow.map?.dispose();
      keyLight.shadow.map = null;
      slowFrames = 0;
      if (quality === 1) {
        renderer.shadowMap.enabled = false;
        keyLight.castShadow = false;
      }
    }
    lastFrame = active ? now : 0;
    movingState(rolling);
    if (active || prepare) requestRender();
  }
  function findDie(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(
      [...dice.values()].map((d) => d.hit),
      false,
    )[0]?.object.userData.dieId as number | undefined;
  }
  function pointerDown(event: PointerEvent) {
    press = { x: event.clientX, y: event.clientY, id: findDie(event) };
  }
  function pointerUp(event: PointerEvent) {
    if (
      press &&
      interactive &&
      !animating &&
      !pending &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) < 12 &&
      press.id !== undefined &&
      findDie(event) === press.id
    )
      options.onDieClick(press.id);
    press = undefined;
  }
  function pointerMove(event: PointerEvent) {
    const next = interactive && !animating && !pending ? findDie(event) : undefined;
    if (next !== hovered) {
      hovered = next;
      renderer.domElement.style.cursor = next === undefined ? 'default' : 'pointer';
      requestRender();
    }
  }
  function pointerLeave() {
    press = undefined;
    hovered = undefined;
    requestRender();
  }
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    const aspect = width / height,
      vertical = Math.max(7.5, 11.65 / aspect);
    camera.left = (-vertical * aspect) / 2;
    camera.right = (vertical * aspect) / 2;
    camera.top = vertical / 2;
    camera.bottom = -vertical / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestRender();
  }
  function visibility() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      // Visibility recovery shows the newest committed pose, without re-emitting past impacts.
      contact = undefined;
      for (const die of dice.values())
        if (die.motion) {
          die.mesh.position.copy(die.motion.to);
          die.mesh.quaternion.copy(die.motion.toQ);
          die.motion = undefined;
        }
      movingState(false);
      pendingStart = -Infinity;
      resize();
      requestRender();
    }
  }
  function lost(event: Event) {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    movingState(false);
    options.onError('3D 화면을 복구하고 있어요. 아래 숫자 주사위로 계속 플레이할 수 있어요.');
  }
  function restored() {
    contextLost = false;
    // Render-target contents do not survive context loss; regenerate the environment lighting.
    buildEnvironment();
    options.onError('');
    visibility();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);
  resize();
  return {
    update(nextDice, state) {
      interactive = state.interactive;
      reduced = state.reducedMotion;
      if (state.pending && !pending) pendingStart = performance.now();
      pending = state.pending;
      const newRoll = key !== state.rollKey;
      const animateRoll = newRoll && state.animate && !reduced && !document.hidden;
      const now = performance.now();
      if (newRoll || reduced) contact = undefined;
      if (animateRoll) {
        const rolling = nextDice
          .filter((die) => !die.held && dice.has(die.id) && die.value >= 1 && die.value <= 6)
          .map((die) => die.id)
          .sort((a, b) => a - b);
        if (rolling.length >= 2)
          contact = { ids: [rolling[0], rolling[1]], start: now, fired: false };
      }
      for (const value of nextDice) {
        const die = dice.get(value.id);
        if (!die || value.value < 1 || value.value > 6) continue;
        if (reduced && die.motion) {
          die.mesh.position.copy(die.motion.to);
          die.mesh.quaternion.copy(die.motion.toQ);
          die.motion = undefined;
        }
        const changedHold = die.held !== value.held;
        const changedFace = die.value !== value.value;
        if (!newRoll && !changedHold && !changedFace) continue;
        const target = landing(value);
        const targetQ = orientationForValue(value.value, value.held ? 0 : (value.id - 2) * 0.11);
        if (
          (animateRoll && !value.held) ||
          (!newRoll && changedHold && !reduced && !document.hidden)
        ) {
          rotationMatrix.makeRotationFromQuaternion(die.mesh.quaternion);
          const m = rotationMatrix.elements;
          const support =
            (SIZE / 2 - RADIUS) * (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])) + RADIUS;
          die.motion = {
            start: now,
            duration: animateRoll && !value.held ? 1100 : 280,
            from: die.mesh.position.clone(),
            to: target,
            fromQ: die.mesh.quaternion.clone(),
            toQ: targetQ,
            roll: animateRoll && !value.held,
            impacts: 0,
            startLift: Math.max(0, die.mesh.position.y - FLOOR - support),
          };
        } else {
          die.motion = undefined;
          die.mesh.position.copy(target);
          die.mesh.quaternion.copy(targetQ);
        }
        die.value = value.value;
        die.held = value.held;
      }
      key = state.rollKey;
      movingState([...dice.values()].some((die) => !!die.motion?.roll));
      requestRender();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerleave', pointerLeave);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      for (const resource of resources) resource.dispose();
      keyLight.shadow.map?.dispose();
      env?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
