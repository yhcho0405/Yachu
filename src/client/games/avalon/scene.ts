import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AvalonPublicState } from '../../../shared/avalon';
import { getAvalonQuestSize } from '../../../shared/avalon';
import type { AvalonSoundEvent } from './audio';
import {
  aggregateAvalonCards,
  avalonCardLayout,
  avalonSeatLayout,
  type AvalonCardFace,
} from './layout';
import { cardTexture, contactTexture, emblemTexture, surfaceTexture, texture } from './materials';

export interface AvalonSeatPosition {
  playerId: string;
  seat: number;
  x: number;
  y: number;
}
export interface AvalonSceneOptions {
  viewerId?: string;
  selectedIds?: readonly string[];
  focusedId?: string | null;
  interactive?: boolean;
  reducedMotion?: boolean;
  animate?: boolean;
  eventKey?: string;
  demo?: boolean;
}
export interface AvalonSceneCallbacks {
  onSeatClick(playerId: string): void;
  onError(message: string): void;
  onSound?(event: AvalonSoundEvent, intensity?: number): void;
  onSeatPositions?(positions: AvalonSeatPosition[]): void;
}
export interface AvalonScene {
  update(state: AvalonPublicState | null, options?: AvalonSceneOptions): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const TOP = 0.45;
const SEAT_RADIUS = 4.48;
const smooth = (t: number) => t * t * (3 - 2 * t);
const bounded = (value: number) => Math.max(0, Math.min(1, value));
const seatPoint = (seat: number, count: number, radius = SEAT_RADIUS) => {
  const point = avalonSeatLayout(seat, count, radius);
  return new THREE.Vector3(point.x, TOP, point.z);
};

/** Public state only. Role lists, private information, and quest authorship are never consumed. */
export function createAvalonScene(
  container: HTMLElement,
  callbacks: AvalonSceneCallbacks,
): AvalonScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dedbd1');
  const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 80);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'default',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  let economical =
    /swiftshader|llvmpipe|software rasterizer/i.test(rendererName) ||
    navigator.hardwareConcurrency <= 4;
  renderer.shadowMap.enabled = !economical;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.width = canvas.style.height = '100%';
  canvas.style.touchAction = 'pan-y';
  canvas.dataset.game = 'avalon';
  container.appendChild(canvas);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const geometry = <T extends THREE.BufferGeometry>(value: T) => {
    geometries.add(value);
    return value;
  };
  const material = <T extends THREE.Material>(value: T) => {
    materials.add(value);
    return value;
  };
  const map = <T extends THREE.Texture>(value: T) => {
    textures.add(value);
    return value;
  };
  const standard = (parameters: THREE.MeshStandardMaterialParameters) =>
    material(new THREE.MeshStandardMaterial(parameters));
  const basic = (parameters: THREE.MeshBasicMaterialParameters) =>
    material(new THREE.MeshBasicMaterial(parameters));
  const mesh = (
    shape: THREE.BufferGeometry,
    surface: THREE.Material,
    parent: THREE.Object3D = scene,
  ) => {
    const object = new THREE.Mesh(shape, surface);
    parent.add(object);
    return object;
  };
  const cylinder = (
    top: number,
    bottom: number,
    height: number,
    surface: THREE.Material,
    y: number,
    parent: THREE.Object3D = scene,
    segments = 80,
  ) => {
    const object = mesh(
      geometry(new THREE.CylinderGeometry(top, bottom, height, segments)),
      surface,
      parent,
    );
    object.position.y = y;
    object.receiveShadow = true;
    return object;
  };
  const ringGeometry = geometry(new THREE.TorusGeometry(1, 0.022, 6, 48));
  const ring = (radius: number, surface: THREE.Material, parent: THREE.Object3D, y: number) => {
    const object = mesh(ringGeometry, surface, parent);
    object.rotation.x = -Math.PI / 2;
    object.scale.setScalar(radius);
    object.position.y = y;
    return object;
  };
  const woodMap = map(surfaceTexture('wood'));
  const stoneMap = map(surfaceTexture('stone'));
  const wood = standard({
    color: '#afa091',
    map: woodMap,
    roughness: 0.69,
    bumpMap: woodMap,
    bumpScale: 0.045,
  });
  const darkWood = standard({ color: '#66544b', map: woodMap, roughness: 0.72 });
  const stone = standard({
    color: '#9ca4a1',
    map: stoneMap,
    roughness: 0.91,
    bumpMap: stoneMap,
    bumpScale: 0.022,
  });
  const slate = standard({
    color: '#7d9990',
    map: stoneMap,
    roughness: 0.84,
    bumpMap: stoneMap,
    bumpScale: 0.016,
  });
  const brass = standard({ color: '#b4a078', metalness: 0.7, roughness: 0.34 });
  const darkMetal = standard({ color: '#465453', metalness: 0.6, roughness: 0.4 });
  const ivory = standard({ color: '#e4d7b9', metalness: 0.16, roughness: 0.47 });
  const teal = standard({
    color: '#62b3a0',
    metalness: 0.35,
    roughness: 0.38,
    emissive: '#204b42',
    emissiveIntensity: 0.12,
  });
  const red = standard({ color: '#a4564d', roughness: 0.66 });
  const hiddenHit = basic({ visible: false });
  const shadow = basic({
    map: map(contactTexture()),
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  });
  const shadowGeometry = geometry(new THREE.PlaneGeometry(1, 1));
  function contact(parent: THREE.Object3D, size: number, y: number) {
    const object = mesh(shadowGeometry, shadow, parent);
    object.rotation.x = -Math.PI / 2;
    object.scale.set(size, size, 1);
    object.position.y = y;
    return object;
  }
  // Thick bevelled wood on a quiet stone plinth. Narrow metal trim catches the key light.
  cylinder(5.57, 5.74, 0.22, stone, -0.52);
  cylinder(5.39, 5.49, 0.26, darkWood, -0.29);
  cylinder(5.25, 5.42, 0.19, wood, -0.065);
  cylinder(5.21, 5.24, 0.24, wood, 0.15);
  cylinder(5.12, 5.21, 0.08, brass, 0.31);
  cylinder(5.05, 5.12, 0.12, wood, 0.4);
  cylinder(3.6, 3.66, 0.045, darkMetal, TOP + 0.004);
  cylinder(3.55, 3.59, 0.04, slate, TOP + 0.025);
  ring(3.45, brass, scene, TOP + 0.059);
  ring(3.28, darkMetal, scene, TOP + 0.059);
  ring(5.03, darkMetal, scene, TOP + 0.07);
  const floor = mesh(
    geometry(new THREE.PlaneGeometry(100, 100)),
    standard({ color: '#d8d5cb', roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.65;
  floor.receiveShadow = true;
  contact(scene, 13.2, -0.642);
  const compassMap = map(
    texture((ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(196,193,153,.32)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const x = Math.sin(angle),
          y = Math.cos(angle);
        ctx.beginPath();
        ctx.moveTo(size / 2 + x * size * 0.34, size / 2 + y * size * 0.34);
        ctx.lineTo(
          size / 2 + Math.sin(angle + 0.19) * size * 0.12,
          size / 2 + Math.cos(angle + 0.19) * size * 0.12,
        );
        ctx.lineTo(size / 2 + x * size * 0.42, size / 2 + y * size * 0.42);
        ctx.lineTo(
          size / 2 + Math.sin(angle - 0.19) * size * 0.12,
          size / 2 + Math.cos(angle - 0.19) * size * 0.12,
        );
        ctx.closePath();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.3, 0, TAU);
      ctx.stroke();
    }, 512),
  );
  const compass = mesh(
    geometry(new THREE.PlaneGeometry(5.5, 5.5)),
    basic({ map: compassMap, transparent: true, depthWrite: false }),
  );
  compass.rotation.x = -Math.PI / 2;
  compass.position.y = TOP + 0.052;

  const hemisphere = new THREE.HemisphereLight('#fff5dc', '#485961', 2.5);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight('#fff1d4', 3.5);
  key.position.set(-6, 11, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -7;
  key.shadow.camera.right = key.shadow.camera.top = 7;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 25;
  key.shadow.normalBias = 0.035;
  key.shadow.bias = -0.0002;
  key.shadow.radius = 3;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#d3e8ec', 1);
  fill.position.set(5, 7, -5);
  scene.add(fill);
  let environment: THREE.WebGLRenderTarget | undefined;
  function createEnvironment() {
    if (economical) return;
    const generator = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environment = generator.fromScene(room, 0.035);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.32;
    room.dispose();
    generator.dispose();
  }
  createEnvironment();
  for (const x of [-1.65, 1.65]) {
    const candle = new THREE.Group();
    candle.position.set(x, TOP + 0.018, -4.43);
    scene.add(candle);
    cylinder(0.23, 0.32, 0.09, brass, 0.045, candle, 32);
    cylinder(0.075, 0.12, 0.32, brass, 0.25, candle, 24);
    cylinder(0.24, 0.17, 0.055, brass, 0.435, candle, 32);
    cylinder(0.145, 0.15, 0.36, ivory, 0.64, candle, 24);
    const flame = mesh(
      geometry(new THREE.SphereGeometry(0.07, 10, 8)),
      basic({ color: '#ffe1a0' }),
      candle,
    );
    flame.position.y = 0.94;
    flame.scale.set(0.7, 1.8, 0.7);
    contact(candle, 0.9, 0.008);
  }

  const discGeometry = geometry(new THREE.CircleGeometry(1, 48));
  const disc = (radius: number, surface: THREE.Material, parent: THREE.Object3D, y: number) => {
    const object = mesh(discGeometry, surface, parent);
    object.rotation.x = -Math.PI / 2;
    object.scale.setScalar(radius);
    object.position.y = y;
    return object;
  };
  const emblemMaterial = (
    kind: Parameters<typeof emblemTexture>[0],
    background?: string,
    foreground?: string,
    label?: string,
  ) =>
    standard({
      map: map(emblemTexture(kind, background, foreground, label)),
      roughness: 0.55,
      metalness: 0.08,
    });
  const crownSurface = emblemMaterial('crown', '#d2bb86', '#4e4937');
  const teamSurface = emblemMaterial('team', '#b4d0bc', '#2b5a4d');
  const sealSurface = emblemMaterial('seal');
  const offlineSurface = emblemMaterial('offline', '#6f7773', '#ece2cd');
  const successSurface = emblemMaterial('success', '#b5cebd', '#265b48');
  const failSurface = emblemMaterial('fail', '#d6b2a1', '#713830');
  const ladySurface = emblemMaterial('lady', '#bfd4ce', '#355b67');
  const coinGeometry = geometry(new THREE.CylinderGeometry(0.22, 0.23, 0.075, 32));
  function token(surface: THREE.Material, parent: THREE.Object3D, x: number, z: number, scale = 1) {
    const group = new THREE.Group();
    group.position.set(x, 0.11, z);
    group.scale.setScalar(scale);
    parent.add(group);
    mesh(coinGeometry, brass, group).castShadow = true;
    disc(0.198, surface, group, 0.039);
    return group;
  }
  const seatBase = geometry(new THREE.CylinderGeometry(0.46, 0.5, 0.14, 40));
  const seatInset = geometry(new THREE.CylinderGeometry(0.4, 0.435, 0.055, 40));
  const pawnGeometry = geometry(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.18, 0),
        new THREE.Vector2(0.22, 0.04),
        new THREE.Vector2(0.16, 0.11),
        new THREE.Vector2(0.105, 0.25),
        new THREE.Vector2(0.15, 0.31),
        new THREE.Vector2(0.13, 0.4),
        new THREE.Vector2(0.07, 0.46),
        new THREE.Vector2(0, 0.48),
      ],
      24,
    ),
  );
  const hitGeometry = geometry(new THREE.CylinderGeometry(0.72, 0.72, 1.1, 16));
  const seats = Array.from({ length: 10 }, (_, index) => {
    const group = new THREE.Group();
    scene.add(group);
    contact(group, 1.45, 0.008);
    const base = mesh(seatBase, darkMetal, group);
    base.position.y = 0.08;
    base.castShadow = true;
    base.receiveShadow = true;
    const inset = mesh(seatInset, brass, group);
    inset.position.y = 0.173;
    disc(0.39, emblemMaterial('crest', '#d1c8ad', '#3c504a', String(index + 1)), group, 0.203);
    const pawn = mesh(pawnGeometry, ivory, group);
    pawn.position.set(0, 0.205, 0.05);
    pawn.castShadow = true;
    // Number remains visible beneath the neutral pawn; HTML carries names and statuses.
    pawn.scale.setScalar(0.76);
    pawn.position.z = -0.09;
    const selected = ring(0.55, teal, group, 0.12);
    selected.visible = false;
    const team = token(teamSurface, group, -0.48, 0.32);
    team.visible = false;
    const submitted = token(sealSurface, group, 0.48, 0.32);
    submitted.visible = false;
    const disconnected = token(offlineSurface, group, 0, 0.54, 0.9);
    disconnected.visible = false;
    const vote = token(successSurface, group, 0.48, -0.35, 0.95);
    vote.visible = false;
    const hit = mesh(hitGeometry, hiddenHit, group);
    hit.position.y = 0.35;
    return {
      group,
      selected,
      team,
      submitted,
      disconnected,
      vote,
      hit,
      pawn,
      playerId: '',
      seat: index,
    };
  });
  const leader = new THREE.Group();
  scene.add(leader);
  leader.position.y = TOP + 0.12;
  const leaderToken = token(crownSurface, leader, 0, 0, 1.65);
  ring(0.435, brass, leader, 0.15);
  const lady = new THREE.Group();
  scene.add(lady);
  lady.position.y = TOP + 0.15;
  token(ladySurface, lady, 0, 0, 1.25);

  const questMaterialCache = new Map<string, THREE.Material>();
  function questSurface(index: number, count: number) {
    const label = `${index + 1}:${count}`;
    let value = questMaterialCache.get(label);
    if (!value) {
      value = standard({
        map: map(
          texture((ctx, s) => {
            ctx.fillStyle = '#bcb79c';
            ctx.fillRect(0, 0, s, s);
            ctx.strokeStyle = '#5e6658';
            ctx.lineWidth = s * 0.025;
            ctx.beginPath();
            ctx.arc(s / 2, s / 2, s * 0.43, 0, TAU);
            ctx.stroke();
            ctx.fillStyle = '#303f37';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `600 ${s * 0.35}px sans-serif`;
            ctx.fillText(String(index + 1), s / 2, s * 0.4);
            for (let i = 0; i < count; i++) {
              ctx.beginPath();
              ctx.arc(s / 2 + (i - (count - 1) / 2) * s * 0.1, s * 0.7, s * 0.026, 0, TAU);
              ctx.fill();
            }
          }),
        ),
        roughness: 0.7,
      });
      questMaterialCache.set(label, value);
    }
    return value;
  }
  const quests = Array.from({ length: 5 }, (_, index) => {
    const group = new THREE.Group();
    group.position.set((index - 2) * 1.12, TOP + 0.08, -2.0 + Math.abs(index - 2) * 0.13);
    scene.add(group);
    cylinder(0.44, 0.48, 0.095, darkMetal, 0, group, 40);
    const face = disc(0.415, questSurface(index, 2), group, 0.05);
    const halo = ring(0.52, teal, group, 0.06);
    halo.visible = false;
    return { group, face, halo };
  });
  const rejections = Array.from({ length: 5 }, (_, index) => {
    const group = new THREE.Group();
    group.position.set((index - 2) * 0.57, TOP + 0.08, 2.43);
    scene.add(group);
    cylinder(0.17, 0.2, 0.065, darkMetal, 0, group, 24);
    const face = disc(0.148, stone, group, 0.037);
    return { group, face };
  });
  const cardBody = geometry(new RoundedBoxGeometry(0.7, 0.055, 1.01, 2, 0.045));
  const cardPlane = geometry(new THREE.PlaneGeometry(0.65, 0.96));
  const cardSurfaces = {
    back: standard({ map: map(cardTexture('back')), roughness: 0.66 }),
    success: standard({ map: map(cardTexture('success')), roughness: 0.66 }),
    fail: standard({ map: map(cardTexture('fail')), roughness: 0.66 }),
  };
  // Slots are visual aggregate positions only. They carry no player or card identifiers.
  const cards = Array.from({ length: 10 }, () => {
    const group = new THREE.Group();
    scene.add(group);
    const body = mesh(cardBody, ivory, group);
    body.castShadow = true;
    const face = mesh(cardPlane, cardSurfaces.back, group);
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.029;
    const back = mesh(cardPlane, cardSurfaces.back, group);
    back.rotation.x = Math.PI / 2;
    back.position.y = -0.029;
    const shade = contact(scene, 1.15, TOP + 0.06);
    return { group, face, shade, target: new THREE.Vector3(), angle: 0 };
  });
  const resultAura = ring(0.55, teal, scene, TOP + 0.16);
  resultAura.visible = false;
  const crack = new THREE.LineSegments(
    geometry(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.35, 0, -0.12),
        new THREE.Vector3(-0.1, 0, -0.04),
        new THREE.Vector3(-0.1, 0, -0.04),
        new THREE.Vector3(0.02, 0, -0.18),
        new THREE.Vector3(0.02, 0, -0.18),
        new THREE.Vector3(0.16, 0, 0.13),
        new THREE.Vector3(0.16, 0, 0.13),
        new THREE.Vector3(0.37, 0, 0.19),
        new THREE.Vector3(0.07, 0, -0.07),
        new THREE.Vector3(-0.06, 0, 0.27),
      ]),
    ),
    material(new THREE.LineBasicMaterial({ color: '#713830' })),
  );
  crack.visible = false;
  scene.add(crack);
  const celebration = ring(2.88, teal, scene, TOP + 0.08);
  celebration.visible = false;

  let disposed = false,
    lost = false,
    frame = 0;
  let width = 0,
    height = 0,
    quality = economical ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
  let state: AvalonPublicState | null = null;
  let options: AvalonSceneOptions = {};
  let lastEventKey = '';
  let lastLeaderId: string | null = null;
  let leaderFrom = new THREE.Vector3(),
    leaderTarget = new THREE.Vector3();
  let ladyFrom = new THREE.Vector3(),
    ladyTarget = new THREE.Vector3();
  let effect: {
    started: number;
    duration: number;
    type: string;
    actorId: string | null;
    questNumber: number;
    finishing: boolean;
    failed: boolean;
  } | null = null;
  let poorFrames = 0,
    measuredFrames = 0;

  function anchors() {
    if (!width || !height) return;
    const positions = seats
      .filter((seat) => seat.group.visible)
      .map((seat) => {
        const point = seat.group.position.clone();
        point.y += 0.72;
        // Labels sit above pawn heads, not inside a perspective-scaled texture.
        point.project(camera);
        const margin = Math.max(0.055, 36 / width);
        return {
          playerId: seat.playerId,
          seat: seat.seat,
          x: Math.max(margin, Math.min(1 - margin, (point.x + 1) / 2)),
          y: Math.max(0.055, Math.min(0.92, (1 - point.y) / 2 - 0.025)),
        };
      });
    callbacks.onSeatPositions?.(positions);
  }
  function resetMotion() {
    leader.position.copy(leaderTarget);
    lady.position.copy(ladyTarget);
    leaderToken.scale.setScalar(1.65);
    for (const card of cards) {
      card.group.position.copy(card.target);
      card.group.rotation.set(0, card.angle, 0);
    }
    for (const seat of seats) seat.submitted.scale.setScalar(1);
    for (const quest of quests) quest.group.scale.setScalar(1);
    celebration.visible = false;
    resultAura.visible = false;
    crack.visible = false;
  }
  function settleMotion() {
    resetMotion();
    leaderFrom.copy(leaderTarget);
    ladyFrom.copy(ladyTarget);
  }
  function animate(now: number) {
    resetMotion();
    if (!effect) return false;
    const progress = bounded((now - effect.started) / effect.duration);
    const eased = smooth(progress);
    if (leaderFrom.distanceToSquared(leaderTarget) > 0.001) {
      const fromAngle = Math.atan2(leaderFrom.x, -leaderFrom.z);
      const toAngle = Math.atan2(leaderTarget.x, -leaderTarget.z);
      const delta = (((toAngle - fromAngle) % TAU) + TAU) % TAU;
      const angle = fromAngle + delta * eased;
      leader.position.set(
        Math.sin(angle) * 3.66,
        TOP + 0.16 + Math.sin(progress * Math.PI) * 0.25,
        -Math.cos(angle) * 3.66,
      );
    }
    lady.position.lerpVectors(ladyFrom, ladyTarget, eased);
    if (effect.type === 'lady_used') lady.position.y += Math.sin(progress * Math.PI) * 0.42;
    if (effect.type === 'vote_revealed' || effect.type === 'quest_resolved') {
      for (const [index, card] of cards.entries()) {
        if (!card.group.visible) continue;
        const reveal = smooth(bounded((progress - 0.12) / 0.68));
        card.group.position.x = card.target.x * (0.25 + 0.75 * reveal);
        card.group.position.z = card.target.z * (0.25 + 0.75 * reveal);
        card.group.position.y += Math.sin(reveal * Math.PI) * 0.48 + (1 - reveal) * index * 0.057;
        card.group.rotation.x = (1 - reveal) * Math.PI;
        card.group.rotation.y =
          card.angle + Math.sin(progress * Math.PI) * (index % 2 ? 0.08 : -0.08);
      }
      if (effect.type === 'quest_resolved') {
        const quest = quests[effect.questNumber - 1];
        if (quest) {
          quest.group.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.12);
          resultAura.visible = progress > 0.08 && progress < 0.92;
          resultAura.material = effect.failed ? red : teal;
          resultAura.position.copy(quest.group.position);
          resultAura.position.y += 0.08;
          resultAura.scale.setScalar(0.55 + Math.sin(progress * Math.PI) * 0.1);
          crack.visible = effect.failed && progress > 0.18 && progress < 0.85;
          crack.position.copy(quest.group.position);
          crack.position.y += 0.06;
        }
      }
    }
    if (effect.type === 'vote_submitted' || effect.type === 'quest_submitted') {
      const seat = seats.find((item) => item.playerId === effect?.actorId);
      if (seat) seat.submitted.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.22);
    }
    if (effect.type === 'assassination' || effect.finishing) {
      celebration.visible = true;
      celebration.scale.setScalar(2.88 + Math.sin(progress * Math.PI) * 0.15);
    }
    if (progress >= 1) {
      effect = null;
      settleMotion();
      return false;
    }
    return true;
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden || !width || !height) return;
    const active = !options.reducedMotion && animate(now);
    const start = performance.now();
    renderer.render(scene, camera);
    // Reduce only after sustained expensive renders; idle never runs a quality polling loop.
    if (active && !economical) {
      measuredFrames++;
      if (performance.now() - start > 25) poorFrames++;
      if (measuredFrames >= 45) {
        if (poorFrames > 24) {
          economical = true;
          quality = 1;
          renderer.shadowMap.enabled = false;
          renderer.setPixelRatio(quality);
          renderer.setSize(width, height, false);
        }
        measuredFrames = poorFrames = 0;
      }
    }
    canvas.dataset.animating = String(active);
    if (active) frame = requestAnimationFrame(draw);
  }
  function invalidate() {
    if (!frame && !disposed && !lost && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function resize() {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    const aspect = width / height;
    const wide = aspect >= 1.4;
    const vertical = Math.max(wide ? 8.4 : 10.5, 11.75 / aspect);
    camera.left = (-vertical * aspect) / 2;
    camera.right = (vertical * aspect) / 2;
    camera.top = vertical / 2;
    camera.bottom = -vertical / 2;
    camera.position.set(0, wide ? 13 : 17, wide ? 15 : 9);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.setPixelRatio(quality);
    renderer.setSize(width, height, false);
    anchors();
    invalidate();
  }

  function update(next: AvalonPublicState | null, nextOptions: AvalonSceneOptions = {}) {
    if (disposed) return;
    const previous = state;
    state = next;
    options = nextOptions;
    const demo = !next;
    const players =
      next?.players ??
      Array.from({ length: 7 }, (_, seat) => ({ id: `preview-${seat}`, seat, connected: true }));
    const count = Math.max(5, Math.min(10, players.length));
    const selected = new Set(
      nextOptions.selectedIds ?? (demo ? ['preview-0', 'preview-2', 'preview-4'] : []),
    );
    const team = new Set(
      next?.proposal?.teamIds ?? (demo ? ['preview-0', 'preview-2', 'preview-4'] : []),
    );
    const submitted = new Set(next?.proposal?.submittedIds ?? []);
    const voteRecord = next?.history.proposals.at(-1);
    const showVotes =
      !!voteRecord &&
      (next?.latestEvent?.type === 'vote_revealed' ||
        (next?.stage === 'quest' && next.proposal?.id === voteRecord.id));
    for (const seat of seats) {
      const player = players.find((item) => item.seat === seat.seat);
      seat.group.visible = !!player;
      if (!player) {
        seat.playerId = '';
        continue;
      }
      seat.playerId = player.id;
      seat.hit.userData.playerId = player.id;
      seat.group.position.copy(seatPoint(player.seat, count));
      const angle = (player.seat / count) * TAU;
      const radial = { x: Math.sin(angle), z: -Math.cos(angle) };
      const tangent = { x: Math.cos(angle), z: Math.sin(angle) };
      // Status coins sit inward on the wooden annulus rather than spilling beyond its edge.
      for (const [token, side] of [
        [seat.team, -1],
        [seat.submitted, 1],
      ] as const) {
        token.position.set(
          -radial.x * 0.48 + tangent.x * 0.43 * side,
          0.055,
          -radial.z * 0.48 + tangent.z * 0.43 * side,
        );
      }
      seat.vote.position.set(
        radial.x * 0.27 - tangent.x * 0.43,
        0.055,
        radial.z * 0.27 - tangent.z * 0.43,
      );
      seat.disconnected.position.set(0, 0.245, 0);
      seat.pawn.visible = player.connected;

      seat.selected.visible = selected.has(player.id) || nextOptions.focusedId === player.id;
      seat.team.visible = team.has(player.id);
      seat.submitted.visible = submitted.has(player.id);
      seat.disconnected.visible = !player.connected;
      const vote = showVotes ? voteRecord?.votes.find((item) => item.playerId === player.id) : null;
      seat.vote.visible = !!vote;
      if (vote)
        (seat.vote.children[1] as THREE.Mesh).material = vote.approve
          ? successSurface
          : failSurface;
    }
    const leaderId = next?.leaderId ?? (demo ? players[1]?.id : null);
    const leaderSeat = players.find((item) => item.id === leaderId);
    const nextLeaderTarget = leaderSeat
      ? seatPoint(leaderSeat.seat, count, 3.66)
      : new THREE.Vector3();
    nextLeaderTarget.y = TOP + 0.16;
    if (leaderTarget.distanceToSquared(nextLeaderTarget) > 0.001) {
      leaderFrom = leader.position.clone();
      leaderTarget = nextLeaderTarget;
    }
    leader.visible = !!leaderSeat;
    const ladySeat = players.find((item) => item.id === next?.lady?.holderId);
    const nextLadyTarget = ladySeat ? seatPoint(ladySeat.seat, count, 4.95) : new THREE.Vector3();
    if (ladySeat) {
      const angle = (ladySeat.seat / count) * TAU;
      nextLadyTarget.copy(seatPoint(ladySeat.seat, count, 4.33));
      nextLadyTarget.x += Math.cos(angle) * 0.85;
      nextLadyTarget.z += Math.sin(angle) * 0.85;
    }
    nextLadyTarget.y = TOP - 0.05;
    if (ladyTarget.distanceToSquared(nextLadyTarget) > 0.001) {
      ladyFrom = lady.position.clone();
      ladyTarget = nextLadyTarget;
    }
    lady.visible = !!ladySeat;
    for (const [index, quest] of quests.entries()) {
      const result = next?.history.quests.find((item) => item.questNumber === index + 1);
      quest.face.material = result
        ? result.failed
          ? failSurface
          : successSurface
        : demo && index < 2
          ? index
            ? failSurface
            : successSurface
          : questSurface(index, getAvalonQuestSize(count, index + 1));
      quest.halo.visible = !result && (next?.questNumber ?? 3) === index + 1;
    }
    for (const [index, rejection] of rejections.entries())
      rejection.face.material = index < (next?.rejections ?? 1) ? red : stone;
    const latestQuest = next?.history.quests.at(-1);
    const faces: AvalonCardFace[] = next
      ? aggregateAvalonCards(next)
      : ['success', 'success', 'fail'];
    for (const [index, card] of cards.entries()) {
      card.group.visible = card.shade.visible = index < faces.length;
      if (index >= faces.length) continue;
      const cardPosition = avalonCardLayout(index, faces.length);
      card.target.set(cardPosition.x, TOP + 0.14, cardPosition.z);
      card.angle = cardPosition.angle;
      card.face.material = cardSurfaces[faces[index]];
      card.shade.position.set(card.target.x, TOP + 0.058, card.target.z);
    }
    const event = next?.latestEvent;
    const keyValue = event?.id ?? nextOptions.eventKey ?? '';
    const newEvent = keyValue !== lastEventKey;
    if (newEvent) {
      lastEventKey = keyValue;
      if (effect) {
        leaderFrom.copy(leader.position);
        ladyFrom.copy(lady.position);
      }
      effect = null;
      if (nextOptions.animate && event && previous) {
        effect = nextOptions.reducedMotion
          ? null
          : {
              started: performance.now(),
              duration: event.type.includes('submitted')
                ? 220
                : event.type === 'quest_resolved'
                  ? 850
                  : 680,
              type: event.type,
              actorId: event.actorId,
              questNumber: event.questNumber,
              finishing: next?.phase === 'finished' && !!next.winner,
              failed: !!latestQuest?.failed,
            };
        if (
          event.type === 'vote_submitted' ||
          event.type === 'quest_submitted' ||
          event.type === 'team_proposed'
        )
          callbacks.onSound?.('submit', 0.6);
        else if (event.type === 'vote_revealed')
          callbacks.onSound?.(voteRecord?.approved ? 'vote' : 'rejected', 0.7);
        else if (event.type === 'quest_resolved')
          callbacks.onSound?.(latestQuest?.failed ? 'quest-failure' : 'quest-success', 0.75);
        else if (event.type === 'lady_used') callbacks.onSound?.('lady', 0.65);
        else if (event.type === 'assassination') callbacks.onSound?.('finish', 0.8);
        if (lastLeaderId && leaderId !== lastLeaderId) callbacks.onSound?.('leader', 0.45);
        if (
          next?.phase === 'finished' &&
          next.winner &&
          previous.phase !== 'finished' &&
          event.type !== 'assassination'
        )
          callbacks.onSound?.('finish', 0.7);
      }
    }
    // UI selection/permission effects with the same event key never cancel a running reveal.
    if (nextOptions.reducedMotion || !effect) {
      effect = null;
      settleMotion();
    }
    lastLeaderId = leaderId;
    canvas.style.cursor = nextOptions.interactive ? 'pointer' : 'default';
    canvas.dataset.stage = next?.stage ?? 'preview';
    anchors();
    invalidate();
  }
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  function pointerDown(event: PointerEvent) {
    down = { x: event.clientX, y: event.clientY };
  }
  function pointerUp(event: PointerEvent) {
    const start = down;
    down = null;
    if (
      !start ||
      !options.interactive ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9 ||
      disposed ||
      lost
    )
      return;
    const bounds = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(
      seats.filter((seat) => seat.group.visible).map((seat) => seat.hit),
    )[0];
    if (hit) callbacks.onSeatClick(String(hit.object.userData.playerId));
  }
  function visibility() {
    if (document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      effect = null;
      settleMotion();
      canvas.dataset.animating = 'false';
    } else invalidate();
  }
  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    canvas.dataset.animating = 'false';
    callbacks.onError(
      '3D 표시를 복구하고 있습니다. 아래 좌석과 행동 버튼으로 계속 진행할 수 있습니다.',
    );
  }
  function contextRestored() {
    if (disposed) return;
    lost = false;
    environment?.dispose();
    createEnvironment();
    effect = null;
    settleMotion();
    callbacks.onError('');
    resize();
  }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  document.addEventListener('visibilitychange', visibility);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  update(null);
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      environment?.dispose();
      scene.environment = null;
      key.shadow.map?.dispose();
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      textures.forEach((item) => item.dispose());
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
