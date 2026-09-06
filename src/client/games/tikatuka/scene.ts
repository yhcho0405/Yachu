import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { orientationForValue, topValue } from '../../../shared/orientations';
import {
  getTikatukaTargets,
  type TikatukaDie,
  type TikatukaLane,
  type TikatukaPreview,
  type TikatukaRoomState,
} from '../../../shared/tikatuka';
import type { TikatukaSoundEvent } from './audio';
import { diceMaterials, paintedTexture, shadowTexture, woodTexture } from './materials';
import {
  ATTACK_FINISH_MS,
  ATTACK_IMPACT_MS,
  ATTACK_REMOVE_MS,
  BOARD_FLOOR,
  DIE_RADIUS,
  DIE_SIZE,
  LANE_Z,
  REST_Y,
  clamp01,
  dieSupport,
  ease,
  lanePosition,
  rollHeight,
  rollQuaternion,
} from './motion';

export interface TikatukaSceneTarget {
  ownerId: string;
  lane: TikatukaLane;
}
export interface TikatukaSceneOptions {
  onTargetClick(target: TikatukaSceneTarget): void;
  onError(message: string): void;
  onAnimationChange?(active: boolean): void;
  onSound?(event: TikatukaSoundEvent, intensity?: number): void;
}
export interface TikatukaSceneUpdate {
  viewerId?: string | null;
  interactive?: boolean;
  selectedTarget?: TikatukaSceneTarget | null;
  preview?: TikatukaPreview | null;
  reducedMotion?: boolean;
  animate?: boolean;
  eventKey?: string;
  demo?: boolean;
}
export interface TikatukaScene {
  update(state: TikatukaRoomState | null, options: TikatukaSceneUpdate): void;
  dispose(): void;
}
type Side = -1 | 1;
type Pose = { die: TikatukaDie; position: THREE.Vector3; side: Side; pending: boolean };
type Visual = {
  die: TikatukaDie;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]>;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  side: Side;
  pending: boolean;
};
type Motion = {
  visual: Visual;
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  delay: number;
  duration: number;
  kind: 'move' | 'roll' | 'remove' | 'strike' | 'fade';
  destroy?: boolean;
  hideBefore?: boolean;
};
type SoundCue = { at: number; event: TikatukaSoundEvent; intensity?: number; done?: boolean };
type Timeline = {
  start: number;
  duration: number;
  scoreAt: number;
  scored: boolean;
  state: TikatukaRoomState;
  motions: Motion[];
  sounds: SoundCue[];
  comboIds: Set<string>;
};

/** Independent lazy scene: board layout and event choreography never decide game outcomes. */
export function createTikatukaScene(
  container: HTMLElement,
  callbacks: TikatukaSceneOptions,
): TikatukaScene {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch {
    callbacks.onError(
      '3D 보드를 준비하지 못했습니다. 아래 라인 버튼으로 계속 플레이할 수 있습니다.',
    );
    return { update() {}, dispose() {} };
  }
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const lowPower =
    /swiftshader|llvmpipe|software rasterizer/i.test(
      info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '',
    ) || (navigator.hardwareConcurrency || 8) <= 4;
  const resources = new Set<THREE.Material | THREE.BufferGeometry | THREE.Texture>();
  const keep = <T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(value: T): T => {
    resources.add(value);
    return value;
  };
  const scene = new THREE.Scene();
  const board = new THREE.Group();
  scene.add(board);
  const camera = new THREE.OrthographicCamera(-7.4, 7.4, 4.4, -4.4, 0.1, 60);
  camera.position.set(0, 17, 10);
  camera.lookAt(0, 0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.testid = 'tikatuka-canvas';
  canvas.dataset.renderMode = lowPower ? 'lightweight' : 'full';
  canvas.dataset.animating = 'false';
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;outline:none';
  container.appendChild(canvas);
  let environment: THREE.WebGLRenderTarget | undefined;
  function environmentMap() {
    if (lowPower) return;
    environment?.dispose();
    const pmrem = new THREE.PMREMGenerator(renderer),
      room = new RoomEnvironment();
    try {
      environment = pmrem.fromScene(room, 0.035);
      scene.environment = environment.texture;
    } catch {
      scene.environment = null;
      renderer.shadowMap.enabled = false;
      canvas.dataset.renderMode = 'lightweight';
    } finally {
      room.dispose();
      pmrem.dispose();
    }
  }
  environmentMap();
  scene.add(new THREE.HemisphereLight('#fff8e8', '#74614e', 1.1));
  const key = new THREE.DirectionalLight('#fff2d9', 1.85);
  key.position.set(-5, 12, 5);
  key.castShadow = !lowPower;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.normalBias = 0.026;
  key.shadow.bias = -0.0003;
  Object.assign(key.shadow.camera, {
    left: -10,
    right: 10,
    top: 10,
    bottom: -10,
    near: 0.5,
    far: 30,
  });
  scene.add(key);
  const fill = new THREE.DirectionalLight('#d8e9ec', 0.55);
  fill.position.set(6, 7, -5);
  scene.add(fill);
  const wood = keep(woodTexture());
  const outerMat = keep(
    new THREE.MeshStandardMaterial({ map: wood, color: '#b6b0a0', roughness: 0.68 }),
  );
  const darkWood = keep(
    new THREE.MeshStandardMaterial({ map: wood, color: '#817464', roughness: 0.68 }),
  );
  const floorMat = keep(
    new THREE.MeshStandardMaterial({
      map: wood,
      color: '#a6a08a',
      roughness: 0.83,
      bumpMap: wood,
      bumpScale: 0.018,
    }),
  );
  const brass = keep(
    new THREE.MeshStandardMaterial({ color: '#8b8571', roughness: 0.44, metalness: 0.6 }),
  );
  const recess = keep(new THREE.MeshStandardMaterial({ color: '#544b3e', roughness: 0.88 }));
  const cupMaterials = [
    keep(new THREE.MeshStandardMaterial({ color: '#2c5145', roughness: 0.94 })),
    keep(new THREE.MeshStandardMaterial({ color: '#714d42', roughness: 0.94 })),
  ];

  function shape(w: number, d: number, r: number) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -d / 2);
    s.lineTo(w / 2 - r, -d / 2);
    s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    s.lineTo(w / 2, d / 2 - r);
    s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    s.lineTo(-w / 2 + r, d / 2);
    s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    s.lineTo(-w / 2, -d / 2 + r);
    s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
    return s;
  }
  function slab(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    inner?: { w: number; d: number },
    parent: THREE.Object3D = board,
  ) {
    const s = shape(w, d, Math.min(0.21, w * 0.12, d * 0.2));
    if (inner) s.holes.push(shape(inner.w, inner.d, 0.14));
    const geo = keep(
      new THREE.ExtrudeGeometry(s, {
        depth: h - 0.018,
        bevelEnabled: true,
        bevelThickness: 0.009,
        bevelSize: 0.009,
        bevelSegments: 2,
        curveSegments: 8,
        steps: 1,
      }),
    );
    const uv = geo.attributes.uv,
      pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / d + 0.5);
    geo.translate(0, 0, -(h - 0.018) / 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  slab(13.68, 0.23, 6.28, 0, -0.33, 0, darkWood);
  slab(13.48, 0.06, 6.1, 0, -0.185, 0, brass);
  slab(13.32, 0.23, 5.95, 0, -0.07, 0, outerMat);
  slab(13.12, 0.12, 5.78, 0, 0.02, 0, darkWood);
  const ground = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(100, 100)),
    keep(new THREE.ShadowMaterial({ color: '#65462c', opacity: 0.19 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.46;
  ground.receiveShadow = true;
  scene.add(ground);

  type LaneVisual = {
    side: Side;
    lane: TikatukaLane;
    hit: THREE.Mesh;
    rim: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
    label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    texture: THREE.CanvasTexture;
    ownerId: string;
  };
  const lanes: LaneVisual[] = [];
  const scoreLabels: { mesh: THREE.Mesh; texture: THREE.CanvasTexture; lane: TikatukaLane }[] = [];
  const hitMaterial = keep(new THREE.MeshBasicMaterial({ visible: false }));
  for (const side of [-1, 1] as const) {
    const x = side * 3.06;
    slab(4.0, 0.18, 5.37, x, 0.045, 0, outerMat);
    for (const lane of [0, 1, 2] as const) {
      const z = LANE_Z[lane];
      slab(3.83, 0.12, 1.49, x, 0.19, z, recess, { w: 3.66, d: 1.32 });
      slab(3.63, 0.07, 1.29, x, 0.125, z, floorMat);
      const material = keep(
        new THREE.MeshStandardMaterial({
          color: '#a09376',
          roughness: 0.72,
          metalness: 0.1,
          emissive: '#000000',
        }),
      );
      const rim = slab(3.86, 0.05, 1.52, x, 0.282, z, material, { w: 3.64, d: 1.3 });
      const hit = new THREE.Mesh(keep(new THREE.BoxGeometry(3.86, 0.95, 1.58)), hitMaterial);
      hit.position.set(x, 0.55, z);
      board.add(hit);
      const texture = keep(paintedTexture(() => {}, 128));
      const label = new THREE.Mesh(
        keep(new THREE.PlaneGeometry(0.4, 0.4)),
        keep(
          new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
      );
      label.rotation.x = -Math.PI / 2;
      label.position.set(side * 4.84, 0.323, z);
      board.add(label);
      lanes.push({ side, lane, hit, rim, material, label, texture, ownerId: '' });
      // Shallow inlaid marks show capacity without pretending the original had divided squares.
      for (let slot = 0; slot < 3; slot++) {
        const marker = new THREE.Mesh(
          keep(new THREE.CircleGeometry(0.037, 12)),
          keep(new THREE.MeshBasicMaterial({ color: '#8e7755', transparent: true, opacity: 0.56 })),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.copy(lanePosition(side, lane, slot));
        marker.position.y = BOARD_FLOOR + 0.004;
        board.add(marker);
      }
    }
    slab(1.44, 0.35, 5.37, side * 5.79, 0.13, 0, darkWood, { w: 1.32, d: 5.04 });
    slab(1.31, 0.07, 5.03, side * 5.79, 0.125, 0, cupMaterials[side === -1 ? 0 : 1]);
    for (const z of [-2.73, 2.73]) {
      const rivet = new THREE.Mesh(keep(new THREE.SphereGeometry(0.068, 10, 6)), brass);
      rivet.scale.y = 0.35;
      rivet.position.set(side * 6.42, 0.103, z);
      board.add(rivet);
    }
  }
  for (const lane of [0, 1, 2] as const) {
    slab(1.6, 0.1, 1.16, 0, 0.07, LANE_Z[lane], darkWood);
    const texture = keep(paintedTexture(() => {}, 256));
    const mesh = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(1.56, 1.08)),
      keep(
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.132, LANE_Z[lane]);
    board.add(mesh);
    scoreLabels.push({ mesh, texture, lane });
  }
  const dieGeometry = keep(new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, DIE_RADIUS));
  const sets = new Map<string, THREE.MeshStandardMaterial[]>();
  for (const shield of [false, true])
    for (const opponent of [false, true]) {
      const mats = diceMaterials(shield, opponent);
      sets.set(`${shield}:${opponent}`, mats);
      for (const mat of mats) {
        keep(mat);
        keep(mat.map!);
        keep(mat.bumpMap!);
      }
    }
  const shadowMap = keep(shadowTexture()),
    shadowGeometry = keep(new THREE.PlaneGeometry(1.48, 1.48));
  const haloGeometry = keep(new THREE.RingGeometry(0.5, 0.532, 36));
  const visuals = new Map<string, Visual>();
  let state: TikatukaRoomState | null = null,
    latest: TikatukaRoomState | null = null,
    options: TikatukaSceneUpdate = {};
  let lastKey: string | undefined,
    timeline: Timeline | undefined,
    queue: { state: TikatukaRoomState; options: TikatukaSceneUpdate }[] = [];
  let frame = 0,
    disposed = false,
    lost = false,
    compact = false,
    active = false,
    slowFrames = 0;
  let hovered: LaneVisual | undefined;
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();

  function materialSet(die: TikatukaDie, side: Side) {
    return sets.get(`${die.kind === 'shield'}:${side === 1}`)!;
  }
  function createVisual(pose: Pose): Visual {
    const mesh = new THREE.Mesh(dieGeometry, materialSet(pose.die, pose.side));
    mesh.position.copy(pose.position);
    mesh.quaternion.copy(orientationForValue(pose.die.value));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    board.add(mesh);
    const shadow = new THREE.Mesh(
      shadowGeometry,
      keep(
        new THREE.MeshBasicMaterial({
          map: shadowMap,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    shadow.rotation.x = -Math.PI / 2;
    board.add(shadow);
    const halo = new THREE.Mesh(
      haloGeometry,
      keep(
        new THREE.MeshBasicMaterial({
          color: '#ead087',
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.visible = false;
    board.add(halo);
    const visual = { die: pose.die, mesh, shadow, halo, side: pose.side, pending: pose.pending };
    visuals.set(pose.die.id, visual);
    return visual;
  }
  function deleteVisual(visual: Visual) {
    board.remove(visual.mesh, visual.shadow, visual.halo);
    visual.shadow.material.dispose();
    resources.delete(visual.shadow.material);
    visual.halo.material.dispose();
    resources.delete(visual.halo.material);
    visuals.delete(visual.die.id);
  }
  function sides(s: TikatukaRoomState | null) {
    const players = s?.players ?? [];
    const own = players.find((p) => p.id === options.viewerId) ?? players[0];
    return [own, players.find((p) => p.id !== own?.id)] as const;
  }
  function poses(s: TikatukaRoomState): Map<string, Pose> {
    const result = new Map<string, Pose>(),
      players = sides(s);
    players.forEach((player, index) => {
      const side: Side = index === 0 ? -1 : 1;
      player?.lanes.forEach((lane, i) =>
        lane.forEach((die, slot) =>
          result.set(die.id, {
            die,
            side,
            pending: false,
            position: lanePosition(side, i as TikatukaLane, slot),
          }),
        ),
      );
    });
    const side: Side = s.turnPlayerId === players[0]?.id ? -1 : 1;
    if (s.pendingDie)
      result.set(s.pendingDie.id, {
        die: s.pendingDie,
        side,
        pending: true,
        position: new THREE.Vector3(side * 5.79, REST_Y, 0),
      });
    if (s.rerollChoices) {
      result.set(s.rerollChoices.original.id, {
        die: s.rerollChoices.original,
        side,
        pending: true,
        position: new THREE.Vector3(side * 5.79, REST_Y, -0.78),
      });
      result.set(s.rerollChoices.rerolled.id, {
        die: s.rerollChoices.rerolled,
        side,
        pending: true,
        position: new THREE.Vector3(side * 5.79, REST_Y, 0.78),
      });
    }
    return result;
  }
  function setActive(value: boolean) {
    if (active === value) return;
    active = value;
    canvas.dataset.animating = String(value);
    callbacks.onAnimationChange?.(value);
  }
  function sync(s: TikatukaRoomState) {
    const desired = poses(s);
    for (const [id, v] of visuals) if (!desired.has(id)) deleteVisual(v);
    for (const pose of desired.values()) {
      const v = visuals.get(pose.die.id) ?? createVisual(pose);
      v.die = pose.die;
      v.side = pose.side;
      v.pending = pose.pending;
      v.mesh.material = materialSet(pose.die, pose.side);
      v.mesh.position.copy(pose.position);
      v.mesh.quaternion.copy(orientationForValue(pose.die.value));
      v.mesh.scale.setScalar(1);
      v.mesh.visible = true;
    }
    state = s;
    scoreTextures(s);
    highlights();
    requestFrame();
  }
  function scoreTextures(s: TikatukaRoomState | null) {
    const players = sides(s),
      preview = options.preview;
    for (const { texture, lane } of scoreLabels) {
      const ctx = (texture.image as HTMLCanvasElement).getContext('2d')!,
        size = 256;
      ctx.clearRect(0, 0, size, size);
      const a = players[0]?.laneScores[lane] ?? [15, 6, 9][lane],
        b = players[1]?.laneScores[lane] ?? [9, 12, 9][lane];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (compact) {
        // In the compact board the opponent is above and the viewer below.
        // Use the same spatial mapping for points, with large upright figures.
        ctx.font = '700 78px system-ui';
        ctx.fillStyle = b > a ? '#f1d898' : '#ede1c9';
        ctx.fillText(String(b), 128, 57);
        ctx.fillStyle = a > b ? '#f1d898' : '#ede1c9';
        ctx.fillText(String(a), 128, 202);
        ctx.font = '500 36px system-ui';
        ctx.fillStyle = '#eddaad';
        ctx.fillText(a === b ? '=' : a > b ? '↓' : '↑', 128, 128);
        texture.needsUpdate = true;
        continue;
      }
      ctx.fillStyle = '#eadcc0';
      ctx.font = '600 23px system-ui';
      ctx.fillText(`${lane + 1}번 줄`, 128, 42);
      ctx.font = '700 56px system-ui';
      ctx.fillStyle = a > b ? '#e9d299' : '#e5d9c3';
      ctx.fillText(String(a), 62, 115);
      ctx.fillStyle = b > a ? '#e9d299' : '#e5d9c3';
      ctx.fillText(String(b), 194, 115);
      ctx.font = '26px system-ui';
      ctx.fillStyle = '#e9d299';
      ctx.fillText(a === b ? '=' : a > b ? '‹' : '›', 128, 115);
      const pa = preview?.players.find((p) => p.playerId === players[0]?.id)?.laneScores[lane];
      const pb = preview?.players.find((p) => p.playerId === players[1]?.id)?.laneScores[lane];
      ctx.fillStyle = '#e4d3aa';
      ctx.font = '500 23px system-ui';
      ctx.fillText(
        pa !== undefined && (pa !== a || pb !== b)
          ? `예상 ${pa} · ${pb}`
          : a === b
            ? '동점'
            : a > b
              ? '내 쪽 우세'
              : '상대 우세',
        128,
        188,
      );
      texture.needsUpdate = true;
    }
    for (const l of lanes) {
      const player = players[l.side === -1 ? 0 : 1];
      l.ownerId = player?.id ?? (l.side === -1 ? 'demo-own' : 'demo-other');
      const ctx = (l.texture.image as HTMLCanvasElement).getContext('2d')!;
      ctx.clearRect(0, 0, 128, 128);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#b79d74';
      ctx.font = '600 68px system-ui';
      ctx.fillText(String(3 - (player?.lanes[l.lane].length ?? 2)), 64, 64);
      l.texture.needsUpdate = true;
    }
  }
  function legal(l: LaneVisual) {
    return (
      !timeline &&
      options.interactive &&
      state &&
      getTikatukaTargets(state, options.viewerId ?? state.turnPlayerId).some(
        (t) => t.ownerId === l.ownerId && t.lane === l.lane,
      )
    );
  }
  function highlights() {
    const targets = state ? getTikatukaTargets(state, options.viewerId ?? state.turnPlayerId) : [];
    for (const l of lanes) {
      const target = targets.find((t) => t.ownerId === l.ownerId && t.lane === l.lane),
        isSelected =
          options.selectedTarget?.ownerId === l.ownerId && options.selectedTarget.lane === l.lane;
      const bright = !!target && !!options.interactive && !timeline;
      l.material.color.set(
        isSelected && bright
          ? '#f2d490'
          : l === hovered && bright
            ? '#e0cba3'
            : bright
              ? '#d7cfb1'
              : '#a09376',
      );
      l.material.emissive.set(
        isSelected && bright
          ? '#63501f'
          : bright && target?.action === 'attack'
            ? '#392216'
            : '#000000',
      );
      l.material.emissiveIntensity = isSelected ? 0.35 : 0.2;
    }
    for (const v of visuals.values()) {
      const removal = options.preview?.removedIds.includes(v.die.id) ?? false;
      v.halo.visible = !timeline && (removal || v.pending);
      v.halo.material.color.set(removal ? '#d9a278' : '#d5bd7c');
    }
  }
  function addMotion(
    motions: Motion[],
    visual: Visual,
    to: THREE.Vector3,
    kind: Motion['kind'],
    delay: number,
    duration: number,
    extra: Partial<Motion> = {},
  ) {
    motions.push({
      visual,
      from: visual.mesh.position.clone(),
      to: to.clone(),
      fromQ: visual.mesh.quaternion.clone(),
      toQ: orientationForValue(visual.die.value),
      delay,
      duration,
      kind,
      ...extra,
    });
  }
  function begin(s: TikatukaRoomState) {
    const desired = poses(s),
      event = s.latestEvent,
      motions: Motion[] = [],
      sounds: SoundCue[] = [];
    const attacking = event?.type === 'attack' && event.lane !== null;
    const boardDelay = attacking
      ? ATTACK_FINISH_MS
      : event?.type === 'place' || event?.type === 'choose' || event?.type === 'hold'
        ? 350
        : 0;
    const removed = new Set(attacking ? event.removedIds : []);
    let duration = boardDelay;
    const firstRemoved = attacking
      ? event.removedIds.map((id) => visuals.get(id)).find(Boolean)
      : undefined;
    for (const [id, v] of [...visuals]) {
      if (removed.has(id)) {
        const index = event!.removedIds.indexOf(id),
          to = v.mesh.position.clone();
        to.z += (event!.lane === 0 ? -1 : 1) * (1.45 + index * 0.2);
        to.x += (index - 1) * 0.25;
        to.y += 1.2;
        addMotion(motions, v, to, 'remove', ATTACK_IMPACT_MS, ATTACK_REMOVE_MS - ATTACK_IMPACT_MS, {
          destroy: true,
        });
      } else if (!desired.has(id) && !(attacking && id === event?.die?.id)) {
        addMotion(motions, v, v.mesh.position, 'fade', 0, 200, { destroy: true });
        duration = Math.max(duration, 200);
      }
    }
    if (attacking && event.die && firstRemoved) {
      const actorSide: Side = sides(s)[0]?.id === event.actorId ? -1 : 1;
      const attacker =
        visuals.get(event.die.id) ??
        createVisual({
          die: event.die,
          side: actorSide,
          pending: true,
          position: new THREE.Vector3(actorSide * 5.79, REST_Y, 0),
        });
      // A visible top-to-top strike: centers remain one die thickness apart at contact.
      const contact = firstRemoved.mesh.position.clone();
      contact.y += DIE_SIZE;
      addMotion(motions, attacker, contact, 'strike', 0, ATTACK_IMPACT_MS);
      const exit = contact.clone();
      exit.z += 1.8;
      exit.y += 0.8;
      addMotion(
        motions,
        attacker,
        exit,
        'remove',
        ATTACK_IMPACT_MS,
        ATTACK_REMOVE_MS - ATTACK_IMPACT_MS,
        { from: contact.clone(), fromQ: orientationForValue(attacker.die.value), destroy: true },
      );
      sounds.push(
        { at: ATTACK_IMPACT_MS, event: 'attack', intensity: 0.8 },
        {
          at: ATTACK_IMPACT_MS + 120,
          event: 'remove',
          intensity: Math.min(1, 0.35 + removed.size * 0.2),
        },
      );
    }
    for (const pose of desired.values()) {
      let v = visuals.get(pose.die.id);
      const existed = !!v;
      if (!v) v = createVisual(pose);
      v.die = pose.die;
      v.side = pose.side;
      v.pending = pose.pending;
      v.mesh.material = materialSet(pose.die, pose.side);
      if (!existed && pose.pending) {
        const delay = boardDelay;
        addMotion(motions, v, pose.position, 'roll', delay, 700, { hideBefore: delay > 0 });
        v.mesh.visible = delay === 0;
        duration = Math.max(duration, delay + 700);
        sounds.push(
          {
            at: delay,
            event:
              s.pendingDie?.id === pose.die.id && s.pendingDie.source === 'bonus'
                ? 'bonus'
                : event?.type === 'reroll'
                  ? 'reroll'
                  : 'roll',
            intensity: 0.55,
          },
          { at: delay + 700, event: 'impact', intensity: 0.52 },
        );
      } else if (v.mesh.position.distanceToSquared(pose.position) > 0.0001 || !existed) {
        const delay = attacking && !pose.pending ? ATTACK_REMOVE_MS : 0,
          d = attacking && !pose.pending ? ATTACK_FINISH_MS - ATTACK_REMOVE_MS : 350;
        addMotion(motions, v, pose.position, 'move', delay, d);
        duration = Math.max(duration, delay + d);
      }
    }
    if (event?.type === 'place')
      sounds.push({
        at: 320,
        event: event.die?.kind === 'shield' ? 'shield' : 'place',
        intensity: 0.55,
      });
    if (event?.type === 'choose') sounds.push({ at: 280, event: 'choose' });
    if (event?.type === 'hold') sounds.push({ at: 0, event: 'hold' });
    if (event?.type === 'declare') sounds.push({ at: 0, event: 'declare' });
    if (s.turnPlayerId && state?.turnPlayerId && s.turnPlayerId !== state.turnPlayerId)
      sounds.push({ at: boardDelay, event: 'turn' });
    const before = sides(state),
      after = sides(s);
    if (
      [0, 1, 2].some((lane) => {
        const oldLead = Math.sign(
          (before[0]?.laneScores[lane] ?? 0) - (before[1]?.laneScores[lane] ?? 0),
        );
        const newLead = Math.sign(
          (after[0]?.laneScores[lane] ?? 0) - (after[1]?.laneScores[lane] ?? 0),
        );
        return oldLead !== newLead && newLead !== 0;
      })
    )
      sounds.push({ at: Math.max(boardDelay, 350), event: 'lead' });
    if (s.phase === 'finished') sounds.push({ at: Math.max(boardDelay, 350), event: 'finish' });
    if (!duration) {
      sync(s);
      for (const cue of sounds) callbacks.onSound?.(cue.event, cue.intensity);
      return;
    }
    timeline = {
      start: performance.now(),
      duration: Math.max(duration, ...sounds.map((c) => c.at + 1)),
      scoreAt: attacking ? ATTACK_FINISH_MS : 350,
      scored: false,
      state: s,
      motions,
      sounds,
      comboIds: new Set(
        s.players.flatMap((player) =>
          player.lanes.flatMap((lane) =>
            lane
              .filter((die) => lane.filter((other) => other.value === die.value).length > 1)
              .map((die) => die.id),
          ),
        ),
      ),
    };
    setActive(true);
    highlights();
    requestFrame();
  }
  function renderMotion(m: Motion, elapsed: number) {
    const raw = (elapsed - m.delay) / m.duration,
      t = clamp01(raw),
      v = m.visual;
    if (raw < 0) {
      if (m.hideBefore) v.mesh.visible = false;
      return;
    }
    if (m.destroy && raw >= 1) {
      v.mesh.visible = false;
      return;
    }
    v.mesh.visible = true;
    v.mesh.scale.setScalar(1);
    const e = ease(t);
    v.mesh.position.lerpVectors(m.from, m.to, e);
    v.mesh.quaternion.slerpQuaternions(m.fromQ, m.toQ, e);
    if (m.kind === 'roll') {
      v.mesh.quaternion.copy(rollQuaternion(v.die.value, t));
      v.mesh.position.y = rollHeight(t, v.mesh.quaternion);
      v.mesh.position.z = m.to.z + Math.sin(t * Math.PI * 2) * (1 - t) * 0.6;
    } else if (m.kind === 'move') {
      // Placement travels above the rim, then seats on the floor with zero final offset.
      v.mesh.position.y += Math.sin(t * Math.PI) * 0.62;
    } else if (m.kind === 'strike') {
      v.mesh.position.lerpVectors(m.from, m.to, t * t * (3 - 2 * t));
      v.mesh.position.y += Math.sin(t * Math.PI) * 1.25;
    } else if (m.kind === 'remove') {
      v.mesh.position.lerpVectors(m.from, m.to, t);
      v.mesh.position.y += Math.sin(t * Math.PI) * 0.9;
      v.mesh.quaternion.copy(
        new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0.7, 0.3, 0.6).normalize(), t * Math.PI * 2)
          .multiply(m.fromQ),
      );
      v.mesh.scale.setScalar(1 - 0.92 * t * t);
    } else if (m.kind === 'fade') v.mesh.scale.setScalar(1 - e);
    v.mesh.position.y = Math.max(
      v.mesh.position.y,
      BOARD_FLOOR + dieSupport(v.mesh.quaternion) * v.mesh.scale.x,
    );
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    const started = performance.now();
    if (timeline) {
      const current = timeline,
        elapsed = now - current.start;
      for (const m of current.motions) renderMotion(m, elapsed);
      for (const cue of current.sounds)
        if (!cue.done && elapsed >= cue.at) {
          cue.done = true;
          callbacks.onSound?.(cue.event, cue.intensity);
        }
      if (!current.scored && elapsed >= current.scoreAt) {
        current.scored = true;
        scoreTextures(current.state);
      }
      if (elapsed >= current.duration) {
        timeline = undefined;
        sync(current.state);
        const next = queue.shift();
        if (next) {
          options = next.options;
          begin(next.state);
        } else setActive(false);
      }
    }
    for (const v of visuals.values()) {
      const height = Math.max(0, v.mesh.position.y - REST_Y);
      v.shadow.visible = v.mesh.visible;
      v.shadow.position.set(v.mesh.position.x, BOARD_FLOOR + 0.006, v.mesh.position.z);
      v.shadow.scale.setScalar((1 + height * 0.24) * v.mesh.scale.x);
      v.shadow.material.opacity = 0.72 / (1 + height * 1.9);
      v.halo.position.set(v.mesh.position.x, BOARD_FLOOR + 0.014, v.mesh.position.z);
      if (timeline?.scored && timeline.comboIds.has(v.die.id)) {
        const pulse = clamp01((now - timeline.start - timeline.scoreAt) / 650);
        v.halo.visible = v.mesh.visible && pulse < 1;
        v.halo.material.opacity = Math.sin(pulse * Math.PI) * 0.7;
        v.halo.material.color.set('#d6bb72');
      } else if (!timeline) v.halo.material.opacity = 0.8;
    }
    renderer.render(scene, camera);
    canvas.dataset.faces = JSON.stringify(
      [...visuals]
        .filter(([, v]) => v.mesh.visible)
        .map(([id, v]) => ({
          id,
          value: v.die.value,
          top: topValue(v.mesh.quaternion),
          kind: v.die.kind,
          pending: v.pending,
        })),
    );
    canvas.dataset.targets = JSON.stringify(
      lanes.map((lane) => {
        const point = lane.hit.getWorldPosition(new THREE.Vector3()).project(camera);
        return {
          ownerId: lane.ownerId,
          lane: lane.lane,
          x: (point.x + 1) / 2,
          y: (1 - point.y) / 2,
          legal: !!legal(lane),
        };
      }),
    );
    const cost = performance.now() - started;
    if (timeline && cost > 23) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 20 && pixelRatio > 1) {
      pixelRatio = 1;
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = false;
      slowFrames = 0;
      canvas.dataset.renderMode = 'adaptive';
    }
    if (timeline) requestFrame();
  }
  function requestFrame() {
    if (!frame && !disposed && !lost && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    compact = rect.width < 570 && rect.height > rect.width * 1.1;
    camera.position.set(0, compact ? 18 : 17, compact ? 5 : 10);
    camera.lookAt(0, 0, 0);
    board.rotation.y = compact ? Math.PI / 2 : 0;
    canvas.dataset.layout = compact ? 'columns' : 'rows';
    for (const s of scoreLabels) {
      s.mesh.rotation.set(-Math.PI / 2, 0, compact ? -Math.PI / 2 : 0);
      s.mesh.scale.set(compact ? 0.71 : 1, compact ? 1.48 : 1, 1);
    }
    for (const l of lanes) l.label.rotation.set(-Math.PI / 2, 0, compact ? -Math.PI / 2 : 0);
    const aspect = rect.width / rect.height,
      worldW = compact ? 6.55 : 14.28,
      worldH = compact ? 13.7 : 6.48;
    const h = Math.max(worldH, worldW / aspect);
    camera.left = (-h * aspect) / 2;
    camera.right = (h * aspect) / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
    scoreTextures(timeline?.scored ? timeline.state : state);
    requestFrame();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  function findTarget(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(
      lanes.map((l) => l.hit),
      false,
    )[0];
    return lanes.find((l) => l.hit === hit?.object);
  }
  function move(event: PointerEvent) {
    hovered = findTarget(event);
    canvas.style.cursor = hovered && legal(hovered) ? 'pointer' : 'default';
    highlights();
    requestFrame();
  }
  let down: { x: number; y: number } | undefined;
  function pointerDown(event: PointerEvent) {
    down = { x: event.clientX, y: event.clientY };
  }
  function pointerUp(event: PointerEvent) {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 9) {
      down = undefined;
      return;
    }
    down = undefined;
    const target = findTarget(event);
    if (target && legal(target))
      callbacks.onTargetClick({ ownerId: target.ownerId, lane: target.lane });
  }
  function leave() {
    hovered = undefined;
    down = undefined;
    highlights();
    requestFrame();
  }
  function visibility() {
    if (document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      timeline = undefined;
      queue = [];
      if (latest) sync(latest);
      setActive(false);
    } else requestFrame();
  }
  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    timeline = undefined;
    queue = [];
    setActive(false);
    callbacks.onError('3D 표시가 일시 중단되었습니다. 라인 버튼으로 플레이할 수 있습니다.');
  }
  function restored() {
    lost = false;
    environmentMap();
    if (latest) sync(latest);
    resize();
    callbacks.onError('');
  }
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);

  function demo() {
    for (const v of [...visuals.values()]) deleteVisual(v);
    const layouts = [
      [[5, 5], [6], [3, 3]],
      [
        [3, 6],
        [4, 4],
        [5, 4],
      ],
    ];
    layouts.forEach((rows, index) =>
      rows.forEach((values, lane) =>
        values.forEach((value, slot) =>
          createVisual({
            die: {
              id: `demo-${index}-${lane}-${slot}`,
              value,
              kind:
                (lane === 1 && slot === 0) || (index === 1 && lane === 2 && slot === 0)
                  ? 'shield'
                  : 'normal',
            },
            side: index === 0 ? -1 : 1,
            pending: false,
            position: lanePosition(index === 0 ? -1 : 1, lane as TikatukaLane, slot),
          }),
        ),
      ),
    );
    createVisual({
      die: { id: 'demo-pending', value: 4, kind: 'shield' },
      side: -1,
      pending: true,
      position: new THREE.Vector3(-5.79, REST_Y, 0),
    });
    scoreTextures(null);
    highlights();
    requestFrame();
  }
  demo();
  resize();
  return {
    update(next, nextOptions) {
      if (disposed) return;
      const wasReduced = options.reducedMotion;
      options = nextOptions;
      latest = next;
      if (!next) {
        timeline = undefined;
        queue = [];
        state = null;
        lastKey = undefined;
        setActive(false);
        demo();
        return;
      }
      const eventKey = nextOptions.eventKey || next.latestEvent?.id || `${next.code}:${next.phase}`;
      const isNew = eventKey !== lastKey;
      lastKey = eventKey;
      // A preview/input rerender of the same snapshot must not stop its own in-flight animation.
      if (!isNew) {
        if (nextOptions.reducedMotion && !wasReduced) {
          timeline = undefined;
          queue = [];
          sync(next);
          setActive(false);
        } else {
          if (!timeline) {
            state = next;
            scoreTextures(next);
          }
          highlights();
          requestFrame();
        }
        return;
      }
      if (!nextOptions.animate || nextOptions.reducedMotion || document.hidden || lost || !state) {
        timeline = undefined;
        queue = [];
        sync(next);
        setActive(false);
        return;
      }
      if (timeline) {
        queue.push({ state: next, options: nextOptions });
        if (queue.length > 4) {
          queue = [];
          timeline = undefined;
          sync(next);
          setActive(false);
        }
        return;
      }
      begin(next);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      timeline = undefined;
      queue = [];
      observer.disconnect();
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', restored);
      document.removeEventListener('visibilitychange', visibility);
      key.shadow.dispose();
      for (const resource of resources) resource.dispose();
      resources.clear();
      environment?.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      setActive(false);
    },
  };
}
