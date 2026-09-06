import {
  type Command,
  type CommonPlayer,
  type RoomBase,
  type RoomState,
  type YachtRoomState,
} from '../shared/protocol';
import { gameMetadata, type GameType } from '../shared/games';
import { RULES_VERSION } from '../shared/rules';
import { GameError, type EngineClock } from './errors';
import * as yacht from './games/yacht';
import * as tikatuka from './games/tikatuka';
import type { TikatukaRoomState } from '../shared/tikatuka';
export { GameError, type EngineClock } from './errors';
export { ROLL_SETTLE_MS } from './games/yacht';

export const GRACE_MS = 120_000;
export const ROOM_IDLE_MS = 24 * 60 * 60 * 1000;
export interface Member {
  sessionKey: string;
  connectionId: string | null;
  disconnectedAt: number | null;
  graceRemaining: number;
  departed: boolean;
}
export interface StoredRoom<R extends RoomState = RoomState> {
  state: R;
  members: Record<string, Member>;
}
export function newRoom(
  roomId: string,
  code: string,
  now: number,
  uuid: () => string,
): StoredRoom<YachtRoomState>;
export function newRoom(
  roomId: string,
  code: string,
  now: number,
  uuid: () => string,
  gameType: 'yacht',
): StoredRoom<YachtRoomState>;
export function newRoom(
  roomId: string,
  code: string,
  now: number,
  uuid: () => string,
  gameType: 'tikatuka',
): StoredRoom<TikatukaRoomState>;
export function newRoom(
  roomId: string,
  code: string,
  now: number,
  uuid: () => string,
  gameType: GameType,
): StoredRoom;
export function newRoom(
  roomId: string,
  code: string,
  now: number,
  uuid: () => string,
  gameType: GameType = 'yacht',
): StoredRoom {
  const base: RoomBase<GameType, never> = {
    schemaVersion: 2,
    protocolVersion: 2,
    gameType,
    roomId,
    code,
    gameId: uuid(),
    rulesVersion: gameType === 'yacht' ? RULES_VERSION : 'tikatuka-v1',
    phase: 'lobby',
    version: 0,
    presenceVersion: 0,
    hostId: '',
    players: [],
    turnPlayerId: null,
    turnId: uuid(),
    inputAfter: 0,
    results: [],
    updatedAt: now,
    expiresAt: now + ROOM_IDLE_MS,
  };
  return {
    members: {},
    state:
      gameType === 'yacht'
        ? yacht.createState({ ...base, gameType })
        : tikatuka.createState({ ...base, gameType }),
  };
}
function touch(room: StoredRoom, now: number): void {
  room.state.version++;
  room.state.updatedAt = now;
  room.state.expiresAt = now + ROOM_IDLE_MS;
}
export function member(room: StoredRoom, playerId: string, sessionKey: string): CommonPlayer {
  const auth = room.members[playerId];
  const player = room.state.players.find((p) => p.id === playerId);
  if (
    !auth ||
    auth.sessionKey !== sessionKey ||
    auth.departed ||
    !player ||
    player.kind !== 'human'
  )
    throw new GameError('NOT_MEMBER', '이 방의 참가자가 아닙니다.', 403);
  return player;
}
export function joinRoom(
  room: StoredRoom,
  playerId: string,
  nickname: string,
  sessionKey: string,
  now: number,
): void {
  const previous = room.members[playerId];
  if (previous && !previous.departed) {
    member(room, playerId, sessionKey);
    return;
  }
  if (room.state.phase !== 'lobby')
    throw new GameError('GAME_STARTED', '시작된 경기에는 새로 참가할 수 없습니다.');
  const maximum = gameMetadata(room.state.gameType).maxPlayers;
  if (room.state.players.length >= maximum)
    throw new GameError(
      'ROOM_FULL',
      maximum === 4 ? '방에 이미 네 명이 있습니다.' : '방에 이미 두 명이 있습니다.',
    );
  const used = new Set(room.state.players.map((player) => player.seat));
  const seat = Array.from({ length: maximum }, (_, i) => i).find((value) => !used.has(value))!;
  room.members[playerId] = {
    sessionKey,
    connectionId: null,
    disconnectedAt: now,
    graceRemaining: GRACE_MS,
    departed: false,
  };
  const base: CommonPlayer = {
    id: playerId,
    kind: 'human',
    nickname,
    seat,
    ready: false,
    connected: false,
    forfeited: false,
    graceDeadline: now + GRACE_MS,
  };
  if (room.state.gameType === 'yacht') room.state.players.push(yacht.createPlayer(base));
  else room.state.players.push(tikatuka.createPlayer(base));
  room.state.players.sort((a, b) => a.seat - b.seat);
  if (!room.state.hostId) room.state.hostId = playerId;
  touch(room, now);
}
/** Computer seats have no session credentials and can never authenticate externally. */
export function addComputer(room: StoredRoom, now: number, uuid: () => string): void {
  if (
    room.state.gameType !== 'tikatuka' ||
    room.state.phase !== 'lobby' ||
    room.state.players.length !== 1
  )
    throw new GameError('INVALID_COMPUTER_ROOM', '컴퓨터 대전을 만들 수 없습니다.');
  room.state.players.push(
    tikatuka.createPlayer({
      id: uuid(),
      kind: 'computer',
      nickname: '컴퓨터',
      seat: 1,
      ready: true,
      connected: true,
      forfeited: false,
      graceDeadline: null,
    }),
  );
  touch(room, now);
}
function handoff(room: StoredRoom): void {
  const remaining = room.state.players.filter(
    (p) => p.kind === 'human' && !room.members[p.id]?.departed && !p.forfeited,
  );
  if (!remaining.some((p) => p.id === room.state.hostId))
    room.state.hostId = (remaining.find((p) => p.connected) ?? remaining[0])?.id ?? '';
}
function scheduleAI(room: StoredRoom, now: number): void {
  const state = room.state;
  if (state.gameType !== 'tikatuka') return;
  const actor = state.players.find((p) => p.id === tikatuka.actingPlayerId(state));
  state.aiDueAt =
    state.phase === 'playing' && actor?.kind === 'computer'
      ? Math.max(now + 850, state.inputAfter)
      : null;
}
export function depart(room: StoredRoom, playerId: string, now: number, uuid: () => string): void {
  const p = room.state.players.find((player) => player.id === playerId);
  const auth = room.members[playerId];
  if (!p || !auth || auth.departed) return;
  Object.assign(auth, { departed: true, connectionId: null, disconnectedAt: null });
  Object.assign(p, { connected: false, graceDeadline: null });
  if (room.state.phase === 'lobby') {
    if (room.state.gameType === 'yacht')
      room.state.players = room.state.players.filter((player) => player.id !== playerId);
    else room.state.players = room.state.players.filter((player) => player.id !== playerId);
  } else if (room.state.phase === 'playing') {
    p.forfeited = true;
    const clock = {
      now,
      uuid,
      die: () => {
        throw new Error('Forfeit cannot roll dice');
      },
    };
    if (room.state.gameType === 'yacht') yacht.forfeit(room.state, playerId, clock);
    else tikatuka.forfeit(room.state, playerId, clock);
  }
  handoff(room);
  scheduleAI(room, now);
  touch(room, now);
  room.state.presenceVersion++;
  if (
    !room.state.players.some(
      (player) => player.kind === 'human' && !room.members[player.id]?.departed,
    )
  )
    room.state.expiresAt = Math.min(room.state.expiresAt, now + GRACE_MS);
}
export function expireGrace(room: StoredRoom, now: number, uuid: () => string): boolean {
  let changed = false;
  for (const p of [...room.state.players])
    if (p.kind === 'human' && !p.connected && p.graceDeadline !== null && p.graceDeadline <= now) {
      depart(room, p.id, now, uuid);
      changed = true;
    }
  return changed;
}
export function connect(
  room: StoredRoom,
  playerId: string,
  sessionKey: string,
  connectionId: string,
  now: number,
): void {
  const p = member(room, playerId, sessionKey);
  const auth = room.members[playerId]!;
  if (p.graceDeadline !== null && p.graceDeadline <= now)
    throw new GameError('GRACE_EXPIRED', '재접속 대기 시간이 끝났습니다.', 403);
  if (auth.disconnectedAt !== null && room.state.phase === 'playing')
    auth.graceRemaining = Math.max(0, auth.graceRemaining - (now - auth.disconnectedAt));
  Object.assign(auth, { connectionId, disconnectedAt: null });
  Object.assign(p, { connected: true, graceDeadline: null });
  room.state.presenceVersion++;
}
export function disconnect(
  room: StoredRoom,
  playerId: string,
  connectionId: string,
  now: number,
): boolean {
  const auth = room.members[playerId];
  const p = room.state.players.find((player) => player.id === playerId);
  if (!auth || !p || auth.departed || auth.connectionId !== connectionId) return false;
  auth.connectionId = null;
  auth.disconnectedAt = now;
  p.connected = false;
  p.graceDeadline = now + (room.state.phase === 'playing' ? auth.graceRemaining : GRACE_MS);
  room.state.presenceVersion++;
  return true;
}
export function assertGameCommand(state: RoomState, command: Command): void {
  if (command.protocolVersion === undefined) {
    if (state.gameType !== 'yacht' || command.type.startsWith('tika_'))
      throw new GameError(
        'PROTOCOL_REFRESH',
        '경기와 좌석은 유지됩니다. 새로고침 후 계속해 주세요.',
      );
  } else if (command.protocolVersion !== 2) {
    throw new GameError('PROTOCOL_REFRESH', '경기와 좌석은 유지됩니다. 새로고침 후 계속해 주세요.');
  } else if (command.gameType !== state.gameType) {
    throw new GameError('WRONG_GAME_TYPE', '이 방에서 사용할 수 없는 게임 동작입니다.');
  }
  if (
    (state.gameType === 'yacht' && command.type.startsWith('tika_')) ||
    (state.gameType === 'tikatuka' && ['roll', 'hold', 'score'].includes(command.type))
  )
    throw new GameError('WRONG_GAME_TYPE', '이 방에서 사용할 수 없는 게임 동작입니다.');
}
/** Mutates a transaction-local clone; common authority precedes the game adapter. */
export function applyCommand(
  room: StoredRoom,
  playerId: string,
  sessionKey: string,
  command: Command,
  clock: EngineClock,
): void {
  const p = member(room, playerId, sessionKey);
  const state = room.state;
  assertGameCommand(state, command);
  if (command.gameId !== state.gameId)
    throw new GameError('GAME_CHANGED', '경기가 바뀌었습니다. 최신 화면을 확인해 주세요.');
  if (command.expectedVersion !== state.version)
    throw new GameError('STALE_VERSION', '다른 변경이 먼저 반영되었습니다. 다시 선택해 주세요.');
  if (command.type === 'leave') {
    depart(room, playerId, clock.now, clock.uuid);
    return;
  }
  if (command.type === 'ready') {
    if (state.phase !== 'lobby')
      throw new GameError('NOT_LOBBY', '대기실에서만 준비할 수 있습니다.');
    p.ready = command.ready;
  } else if (command.type === 'start') {
    if (state.phase !== 'lobby') throw new GameError('NOT_LOBBY', '이미 시작된 경기입니다.');
    if (state.hostId !== playerId)
      throw new GameError('HOST_ONLY', '방장만 시작할 수 있습니다.', 403);
    if (state.players.length < gameMetadata(state.gameType).minPlayers)
      throw new GameError('NOT_ENOUGH_PLAYERS', '상대가 참가할 때까지 기다려 주세요.');
    if (state.players.some((player) => player.id !== playerId && !player.ready))
      throw new GameError('NOT_READY', '모든 참가자의 준비를 기다려 주세요.');
    if (state.players.some((player) => !player.connected))
      throw new GameError('NOT_CONNECTED', '모든 참가자가 연결될 때까지 기다려 주세요.');
    state.phase = 'playing';
    for (const player of state.players)
      if (player.kind === 'human') room.members[player.id]!.graceRemaining = GRACE_MS;
    if (state.gameType === 'yacht') yacht.start(state, clock);
    else tikatuka.start(state, clock);
  } else if (command.type === 'rematch') {
    if (state.phase !== 'finished')
      throw new GameError('NOT_FINISHED', '경기가 끝난 뒤 다시 시작할 수 있습니다.');
    if (state.hostId !== playerId)
      throw new GameError('HOST_ONLY', '방장만 재경기를 열 수 있습니다.', 403);
    if (state.gameType === 'yacht')
      state.players = state.players.filter((player) => !room.members[player.id]?.departed);
    else
      state.players = state.players.filter(
        (player) => player.kind === 'computer' || !room.members[player.id]?.departed,
      );
    for (const player of state.players) {
      player.forfeited = false;
      player.ready = player.kind === 'computer';
      if (player.kind === 'computer') continue;
      room.members[player.id]!.graceRemaining = GRACE_MS;
      if (!player.connected) {
        room.members[player.id]!.disconnectedAt = clock.now;
        player.graceDeadline = clock.now + GRACE_MS;
      }
    }
    state.gameId = clock.uuid();
    state.turnId = clock.uuid();
    state.phase = 'lobby';
    if (state.gameType === 'yacht') yacht.reset(state);
    else tikatuka.reset(state);
  } else {
    if (state.phase !== 'playing') throw new GameError('NOT_PLAYING', '진행 중인 경기가 아닙니다.');
    const actor =
      state.gameType === 'tikatuka' ? tikatuka.actingPlayerId(state) : state.turnPlayerId;
    if (p.forfeited || actor !== playerId)
      throw new GameError('NOT_YOUR_TURN', '자신의 차례에 조작할 수 있습니다.', 403);
    if (command.turnId !== state.turnId)
      throw new GameError('TURN_CHANGED', '차례가 바뀌었습니다.');
    if (clock.now < state.inputAfter)
      throw new GameError('INPUT_PENDING', '주사위가 멈출 때까지 잠시 기다려 주세요.');
    if (
      state.gameType === 'yacht' &&
      (command.type === 'roll' || command.type === 'hold' || command.type === 'score')
    )
      yacht.applyIntent(state, playerId, command, clock);
    else if (
      state.gameType === 'tikatuka' &&
      command.type !== 'roll' &&
      command.type !== 'hold' &&
      command.type !== 'score'
    )
      tikatuka.applyIntent(state, playerId, command, clock);
    else throw new GameError('WRONG_GAME_TYPE', '이 방에서 사용할 수 없는 게임 동작입니다.');
  }
  scheduleAI(room, clock.now);
  touch(room, clock.now);
}
/** Called only inside RoomStore's synchronous alarm transaction. */
export function applyComputerTurn(room: StoredRoom, clock: EngineClock): boolean {
  const state = room.state;
  if (
    state.gameType !== 'tikatuka' ||
    state.phase !== 'playing' ||
    state.aiDueAt === null ||
    state.aiDueAt > clock.now ||
    state.inputAfter > clock.now
  )
    return false;
  const actor = state.players.find((p) => p.id === tikatuka.actingPlayerId(state));
  if (!actor || actor.kind !== 'computer' || actor.forfeited) return false;
  // Selection receives only the already-public state, never the RNG or clock.
  const intent = tikatuka.chooseAI(state);
  if (!intent) throw new GameError('AI_NO_ACTION', '컴퓨터의 차례를 처리하지 못했습니다.', 503);
  tikatuka.applyIntent(state, actor.id, intent, clock);
  scheduleAI(room, clock.now);
  touch(room, clock.now);
  return true;
}
