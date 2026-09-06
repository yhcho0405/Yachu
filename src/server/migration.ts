import { CATEGORIES, type RoomState, type Scores, type YachtRoomState } from '../shared/protocol';
import { RULES_VERSION, scoreDice, totals } from '../shared/rules';
import { isTikatukaState } from '../shared/tikatuka';
import { isAvalonInternalState, isAvalonRoomState } from '../shared/avalon';
import { GameError } from './errors';
import type { InternalRoomState, StoredRoom } from './engine';

const commonKeys = [
  'roomId',
  'code',
  'gameId',
  'rulesVersion',
  'phase',
  'version',
  'presenceVersion',
  'hostId',
  'players',
  'turnPlayerId',
  'turnId',
  'inputAfter',
  'results',
  'updatedAt',
  'expiresAt',
];
const yachtKeys = [...commonKeys, 'round', 'dice', 'rolls', 'previews'];
const playerKeys = ['id', 'nickname', 'seat', 'ready', 'connected', 'forfeited', 'graceDeadline'];
const yachtPlayerKeys = [...playerKeys, 'scores', 'upper', 'bonus', 'total'];
const memberKeys = ['sessionKey', 'connectionId', 'disconnectedAt', 'graceRemaining', 'departed'];
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const text = (value: unknown, allowEmpty = false): value is string =>
  typeof value === 'string' && (allowEmpty || value.length > 0) && value.length <= 512;
const nullableTime = (value: unknown) => value === null || integer(value);
const nullableText = (value: unknown) => value === null || text(value);
const bool = (value: unknown) => typeof value === 'boolean';
const fail = (): never => {
  throw new GameError(
    'STORED_STATE_INVALID',
    '저장된 경기 형식을 확인할 수 없습니다. 경기 데이터는 보존되어 있습니다.',
    503,
  );
};
function validCommon(state: Record<string, unknown>): boolean {
  if (
    !text(state.roomId) ||
    !text(state.gameId) ||
    !text(state.turnId) ||
    !text(state.hostId, true) ||
    !text(state.rulesVersion) ||
    typeof state.code !== 'string' ||
    !/^[A-HJ-NP-Z2-9]{8}$/.test(state.code) ||
    !['lobby', 'playing', 'finished'].includes(state.phase as string) ||
    !integer(state.version) ||
    !integer(state.presenceVersion) ||
    !integer(state.inputAfter) ||
    !integer(state.updatedAt) ||
    !integer(state.expiresAt) ||
    !nullableText(state.turnPlayerId) ||
    !Array.isArray(state.players) ||
    !Array.isArray(state.results)
  )
    return false;
  const ids = new Set<string>();
  const seats = new Set<number>();
  for (const player of state.players) {
    if (
      !isObject(player) ||
      !text(player.id) ||
      !text(player.nickname) ||
      !integer(player.seat, 0, 3) ||
      !bool(player.ready) ||
      !bool(player.connected) ||
      !bool(player.forfeited) ||
      !nullableTime(player.graceDeadline) ||
      ids.has(player.id) ||
      seats.has(player.seat)
    )
      return false;
    ids.add(player.id);
    seats.add(player.seat);
  }
  if (state.hostId !== '' && !ids.has(state.hostId as string)) return false;
  if (
    state.phase === 'playing' ? !ids.has(state.turnPlayerId as string) : state.turnPlayerId !== null
  )
    return false;
  if (state.phase !== 'finished' && state.results.length > 0) return false;
  if (state.phase === 'finished' && state.results.length !== state.players.length) return false;
  const resultIds = new Set<string>();
  for (const result of state.results) {
    if (
      !isObject(result) ||
      !text(result.playerId) ||
      !ids.has(result.playerId) ||
      resultIds.has(result.playerId) ||
      !integer(result.rank, 1, 4) ||
      !integer(result.total) ||
      !bool(result.forfeited)
    )
      return false;
    resultIds.add(result.playerId);
  }
  return true;
}
function validYacht(state: Record<string, unknown>, legacy: boolean): boolean {
  if (
    !keys(
      state,
      legacy ? yachtKeys : [...yachtKeys, 'gameType', 'schemaVersion', 'protocolVersion'],
    ) ||
    !validCommon(state) ||
    state.rulesVersion !== RULES_VERSION ||
    !integer(state.round, 1, 12) ||
    !integer(state.rolls, 0, 3) ||
    !Array.isArray(state.dice) ||
    state.dice.length !== 5 ||
    !isObject(state.previews) ||
    !keys(state.previews, CATEGORIES)
  )
    return false;
  if (
    !legacy &&
    (state.gameType !== 'yacht' || state.schemaVersion !== 2 || state.protocolVersion !== 2)
  )
    return false;
  const players = state.players as Record<string, unknown>[];
  if (players.length > 4) return false;
  const maximum = [5, 10, 15, 20, 25, 30, 30, 30, 30, 15, 30, 50];
  for (const p of players) {
    if (
      !keys(p, legacy ? yachtPlayerKeys : [...yachtPlayerKeys, 'kind']) ||
      (!legacy && p.kind !== 'human') ||
      !isObject(p.scores) ||
      !keys(p.scores, CATEGORIES)
    )
      return false;
    if (
      CATEGORIES.some(
        (key, i) =>
          p.scores &&
          (p.scores as Record<string, unknown>)[key] !== null &&
          !integer((p.scores as Record<string, unknown>)[key], 0, maximum[i]),
      )
    )
      return false;
    const computed = totals(p.scores as Scores);
    if (p.upper !== computed.upper || p.bonus !== computed.bonus || p.total !== computed.total)
      return false;
  }
  for (const [index, die] of state.dice.entries()) {
    if (
      !isObject(die) ||
      !keys(die, ['id', 'value', 'held']) ||
      die.id !== index ||
      !integer(die.value, 1, 6) ||
      !bool(die.held)
    )
      return false;
  }
  const expected =
    state.rolls > 0
      ? scoreDice((state.dice as { value: number }[]).map((d) => d.value))
      : Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  if (CATEGORIES.some((key) => (state.previews as Record<string, unknown>)[key] !== expected[key]))
    return false;
  for (const r of state.results as Record<string, unknown>[]) {
    if (!keys(r, ['playerId', 'rank', 'total', 'forfeited'])) return false;
    const p = players.find((p) => p.id === r.playerId)!;
    const rank =
      1 +
      players.filter(
        (other) =>
          Number(other.forfeited) < Number(p.forfeited) ||
          (other.forfeited === p.forfeited && (other.total as number) > (p.total as number)),
      ).length;
    if (r.total !== p.total || r.forfeited !== p.forfeited || r.rank !== rank) return false;
  }
  return true;
}
/** Only the exact shipped Yacht v1 format qualifies for implicit game-type migration. */
export function migratePublicState(value: unknown): RoomState {
  if (!isObject(value)) return fail();
  if (value.gameType === 'avalon') return isAvalonRoomState(value) ? value : fail();
  const legacy =
    !Object.hasOwn(value, 'gameType') &&
    !Object.hasOwn(value, 'schemaVersion') &&
    !Object.hasOwn(value, 'protocolVersion');
  if (legacy) {
    if (!validYacht(value, true)) return fail();
    return {
      ...value,
      gameType: 'yacht',
      schemaVersion: 2,
      protocolVersion: 2,
      players: (value.players as Record<string, unknown>[]).map((p) => ({ ...p, kind: 'human' })),
    } as YachtRoomState;
  }
  if (value.schemaVersion !== 2 || value.protocolVersion !== 2) return fail();
  if (value.gameType === 'yacht' && validYacht(value, false))
    return value as unknown as YachtRoomState;
  if (value.gameType === 'tikatuka' && validCommon(value) && isTikatukaState(value)) return value;
  return fail();
}
function migrateInternalState(value: unknown): InternalRoomState {
  if (isObject(value) && value.gameType === 'avalon')
    return isAvalonInternalState(value) ? value : fail();
  const state = migratePublicState(value);
  return state.gameType === 'avalon' ? fail() : state;
}
export function migrateStoredRoom(value: unknown): StoredRoom {
  if (!isObject(value) || !keys(value, ['state', 'members']) || !isObject(value.members))
    return fail();
  const state = migrateInternalState(value.state);
  if (
    state.gameType === 'tikatuka' &&
    state.phase === 'playing' &&
    state.players.find((p) => p.id === state.turnPlayerId)?.kind === 'computer' &&
    state.aiDueAt === null
  )
    return fail();
  for (const [id, auth] of Object.entries(value.members)) {
    if (
      !text(id) ||
      !isObject(auth) ||
      !keys(auth, memberKeys) ||
      !text(auth.sessionKey) ||
      !nullableText(auth.connectionId) ||
      !nullableTime(auth.disconnectedAt) ||
      !integer(auth.graceRemaining, 0, 120_000) ||
      !bool(auth.departed)
    )
      return fail();
    const player = state.players.find((p) => p.id === id);
    if ((!auth.departed && !player) || player?.kind === 'computer') return fail();
    if (
      player &&
      !auth.departed &&
      (player.connected !== (auth.connectionId !== null) ||
        (player.connected && player.graceDeadline !== null))
    )
      return fail();
  }
  for (const p of state.players)
    if (p.kind === 'human' && !Object.hasOwn(value.members, p.id)) return fail();
  return { state, members: value.members as unknown as StoredRoom['members'] };
}
