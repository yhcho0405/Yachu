import { CATEGORIES, type Command, type Player, type RoomState } from '../shared/protocol';
import { emptyScores, RULES_VERSION, scoreDice, totals } from '../shared/rules';

export const GRACE_MS = 120_000;
export const ROOM_IDLE_MS = 24 * 60 * 60 * 1000;
export const ROLL_SETTLE_MS = 1000;
export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export interface Member {
  sessionKey: string;
  connectionId: string | null;
  disconnectedAt: number | null;
  graceRemaining: number;
  departed: boolean;
}
export interface StoredRoom {
  state: RoomState;
  members: Record<string, Member>;
}
export interface EngineClock {
  now: number;
  uuid: () => string;
  die: () => number;
}
const blankDice = () => Array.from({ length: 5 }, (_, id) => ({ id, value: 1, held: false }));
const blankPreviews = () =>
  Object.fromEntries(CATEGORIES.map((key) => [key, 0])) as RoomState['previews'];
export function newRoom(roomId: string, code: string, now: number, uuid: () => string): StoredRoom {
  return {
    members: {},
    state: {
      roomId,
      code,
      gameId: uuid(),
      rulesVersion: RULES_VERSION,
      phase: 'lobby',
      version: 0,
      presenceVersion: 0,
      hostId: '',
      players: [],
      turnPlayerId: null,
      turnId: uuid(),
      round: 1,
      dice: blankDice(),
      rolls: 0,
      inputAfter: 0,
      previews: blankPreviews(),
      results: [],
      updatedAt: now,
      expiresAt: now + ROOM_IDLE_MS,
    },
  };
}
function touch(room: StoredRoom, now: number): void {
  room.state.version++;
  room.state.updatedAt = now;
  room.state.expiresAt = now + ROOM_IDLE_MS;
}
export function member(room: StoredRoom, playerId: string, sessionKey: string): Player {
  const auth = room.members[playerId];
  const player = room.state.players.find((p) => p.id === playerId);
  if (!auth || auth.sessionKey !== sessionKey || auth.departed || !player)
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
  if (room.state.players.length >= 4)
    throw new GameError('ROOM_FULL', '방에 이미 네 명이 있습니다.');
  const used = new Set(room.state.players.map((player) => player.seat));
  const seat = [0, 1, 2, 3].find((value) => !used.has(value))!;
  room.members[playerId] = {
    sessionKey,
    connectionId: null,
    disconnectedAt: now,
    graceRemaining: GRACE_MS,
    departed: false,
  };
  room.state.players.push({
    id: playerId,
    nickname,
    seat,
    ready: false,
    connected: false,
    forfeited: false,
    graceDeadline: now + GRACE_MS,
    scores: emptyScores(),
    upper: 0,
    bonus: 0,
    total: 0,
  });
  room.state.players.sort((a, b) => a.seat - b.seat);
  if (!room.state.hostId) room.state.hostId = playerId;
  touch(room, now);
}
function resetTurn(room: StoredRoom, playerId: string, uuid: () => string): void {
  const state = room.state;
  state.turnPlayerId = playerId;
  state.turnId = uuid();
  state.dice = blankDice();
  state.rolls = 0;
  state.inputAfter = 0;
  state.previews = blankPreviews();
  const player = state.players.find((p) => p.id === playerId)!;
  state.round = 1 + CATEGORIES.filter((key) => player.scores[key] !== null).length;
}
function finishOrAdvance(room: StoredRoom, afterPlayerId: string | null, uuid: () => string): void {
  const state = room.state;
  const active = state.players.filter(
    (player) => !player.forfeited && CATEGORIES.some((key) => player.scores[key] === null),
  );
  if (active.length === 0) {
    state.phase = 'finished';
    state.turnPlayerId = null;
    state.inputAfter = 0;
    const sorted = [...state.players].sort(
      (a, b) => Number(a.forfeited) - Number(b.forfeited) || b.total - a.total || a.seat - b.seat,
    );
    state.results = sorted.map((p, i) => ({
      playerId: p.id,
      total: p.total,
      forfeited: p.forfeited,
      rank:
        1 +
        sorted
          .slice(0, i)
          .filter(
            (other) =>
              Number(other.forfeited) < Number(p.forfeited) ||
              (other.forfeited === p.forfeited && other.total > p.total),
          ).length,
    }));
    return;
  }
  const oldSeat = state.players.find((p) => p.id === afterPlayerId)?.seat ?? -1;
  resetTurn(room, (active.find((p) => p.seat > oldSeat) ?? active[0])!.id, uuid);
}
function handoff(room: StoredRoom): void {
  const remaining = room.state.players.filter((p) => !room.members[p.id]?.departed && !p.forfeited);
  if (!remaining.some((p) => p.id === room.state.hostId))
    room.state.hostId = (remaining.find((p) => p.connected) ?? remaining[0])?.id ?? '';
}
export function depart(room: StoredRoom, playerId: string, now: number, uuid: () => string): void {
  const p = room.state.players.find((player) => player.id === playerId);
  const auth = room.members[playerId];
  if (!p || !auth || auth.departed) return;
  auth.departed = true;
  auth.connectionId = null;
  auth.disconnectedAt = null;
  p.connected = false;
  p.graceDeadline = null;
  if (room.state.phase === 'lobby')
    room.state.players = room.state.players.filter((player) => player.id !== playerId);
  else if (room.state.phase === 'playing') {
    p.forfeited = true;
    if (
      room.state.phase === 'playing' &&
      (room.state.turnPlayerId === playerId ||
        !room.state.players.some(
          (player) => !player.forfeited && CATEGORIES.some((key) => player.scores[key] === null),
        ))
    )
      finishOrAdvance(room, playerId, uuid);
  }
  handoff(room);
  touch(room, now);
  room.state.presenceVersion++;
  if (!room.state.players.some((player) => !room.members[player.id]?.departed))
    room.state.expiresAt = Math.min(room.state.expiresAt, now + GRACE_MS);
}
/** Persistent deadlines make duplicate or late alarm delivery idempotent. */
export function expireGrace(room: StoredRoom, now: number, uuid: () => string): boolean {
  let changed = false;
  for (const p of [...room.state.players]) {
    if (!p.connected && p.graceDeadline !== null && p.graceDeadline <= now) {
      depart(room, p.id, now, uuid);
      changed = true;
    }
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
  auth.connectionId = connectionId;
  auth.disconnectedAt = null;
  p.connected = true;
  p.graceDeadline = null;
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
/** Mutates only a transaction-local clone. No transport can inject clock/RNG. */
export function applyCommand(
  room: StoredRoom,
  playerId: string,
  sessionKey: string,
  command: Command,
  clock: EngineClock,
): void {
  const p = member(room, playerId, sessionKey);
  const state = room.state;
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
    if (state.players.some((player) => player.id !== playerId && !player.ready))
      throw new GameError('NOT_READY', '모든 참가자의 준비를 기다려 주세요.');
    if (state.players.some((player) => !player.connected))
      throw new GameError('NOT_CONNECTED', '모든 참가자가 연결될 때까지 기다려 주세요.');
    state.phase = 'playing';
    for (const player of state.players) room.members[player.id]!.graceRemaining = GRACE_MS;
    resetTurn(room, state.players[0]!.id, clock.uuid);
  } else if (command.type === 'rematch') {
    if (state.phase !== 'finished')
      throw new GameError('NOT_FINISHED', '경기가 끝난 뒤 다시 시작할 수 있습니다.');
    if (state.hostId !== playerId)
      throw new GameError('HOST_ONLY', '방장만 재경기를 열 수 있습니다.', 403);
    state.players = state.players.filter((player) => !room.members[player.id]?.departed);
    for (const player of state.players) {
      player.scores = emptyScores();
      player.upper = 0;
      player.bonus = 0;
      player.total = 0;
      player.forfeited = false;
      player.ready = false;
      room.members[player.id]!.graceRemaining = GRACE_MS;
      if (!player.connected) {
        room.members[player.id]!.disconnectedAt = clock.now;
        player.graceDeadline = clock.now + GRACE_MS;
      }
    }
    state.gameId = clock.uuid();
    state.turnId = clock.uuid();
    state.phase = 'lobby';
    state.round = 1;
    state.turnPlayerId = null;
    state.dice = blankDice();
    state.rolls = 0;
    state.inputAfter = 0;
    state.previews = blankPreviews();
    state.results = [];
  } else {
    if (state.phase !== 'playing') throw new GameError('NOT_PLAYING', '진행 중인 경기가 아닙니다.');
    if (p.forfeited || state.turnPlayerId !== playerId)
      throw new GameError('NOT_YOUR_TURN', '자신의 차례에 조작할 수 있습니다.', 403);
    if (command.turnId !== state.turnId)
      throw new GameError('TURN_CHANGED', '차례가 바뀌었습니다.');
    if (clock.now < state.inputAfter)
      throw new GameError('INPUT_PENDING', '주사위가 멈출 때까지 잠시 기다려 주세요.');
    if (command.type === 'hold') {
      if (state.rolls === 0) throw new GameError('ROLL_FIRST', '먼저 주사위를 굴려 주세요.');
      state.dice.forEach((die, index) => {
        die.held = command.held[index]!;
      });
    } else if (command.type === 'roll') {
      if (state.rolls >= 3)
        throw new GameError('NO_ROLLS', '이번 차례의 굴림을 모두 사용했습니다.');
      if (state.rolls > 0 && state.dice.every((die) => die.held))
        throw new GameError('ALL_HELD', '다시 굴릴 주사위를 하나 이상 선택해 주세요.');
      for (const die of state.dice) if (state.rolls === 0 || !die.held) die.value = clock.die();
      state.rolls++;
      state.inputAfter = clock.now + ROLL_SETTLE_MS;
      state.previews = scoreDice(state.dice.map((die) => die.value));
    } else {
      if (state.rolls === 0) throw new GameError('ROLL_FIRST', '먼저 주사위를 굴려 주세요.');
      if (p.scores[command.category] !== null)
        throw new GameError('CATEGORY_USED', '이미 기록한 항목입니다.');
      p.scores[command.category] = scoreDice(state.dice.map((die) => die.value))[command.category];
      Object.assign(p, totals(p.scores));
      finishOrAdvance(room, playerId, clock.uuid);
    }
  }
  touch(room, clock.now);
}
