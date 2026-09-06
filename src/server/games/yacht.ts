import {
  CATEGORIES,
  type CommonPlayer,
  type Player,
  type RoomBase,
  type YachtIntent,
  type YachtRoomState,
} from '../../shared/protocol';
import { emptyScores, scoreDice, totals } from '../../shared/rules';
import { GameError, type EngineClock } from '../errors';
export const ROLL_SETTLE_MS = 1000;
const blankDice = () => Array.from({ length: 5 }, (_, id) => ({ id, value: 1, held: false }));
const blankPreviews = () =>
  Object.fromEntries(CATEGORIES.map((key) => [key, 0])) as YachtRoomState['previews'];
export function createState(base: RoomBase<'yacht', Player>): YachtRoomState {
  return { ...base, round: 1, dice: blankDice(), rolls: 0, previews: blankPreviews() };
}
export function createPlayer(base: CommonPlayer): Player {
  return { ...base, scores: emptyScores(), upper: 0, bonus: 0, total: 0 };
}
export function start(state: YachtRoomState, clock: EngineClock): void {
  resetTurn(state, state.players[0]!.id, clock.uuid);
}
export function reset(state: YachtRoomState): void {
  for (const player of state.players)
    Object.assign(player, { scores: emptyScores(), upper: 0, bonus: 0, total: 0 });
  Object.assign(state, {
    round: 1,
    turnPlayerId: null,
    dice: blankDice(),
    rolls: 0,
    inputAfter: 0,
    previews: blankPreviews(),
    results: [],
  });
}
export function forfeit(state: YachtRoomState, playerId: string, clock: EngineClock): void {
  if (
    state.turnPlayerId === playerId ||
    !state.players.some(
      (player) => !player.forfeited && CATEGORIES.some((key) => player.scores[key] === null),
    )
  )
    finishOrAdvance(state, playerId, clock.uuid);
}
function resetTurn(state: YachtRoomState, playerId: string, uuid: () => string): void {
  state.turnPlayerId = playerId;
  state.turnId = uuid();
  state.dice = blankDice();
  state.rolls = 0;
  state.inputAfter = 0;
  state.previews = blankPreviews();
  const player = state.players.find((p) => p.id === playerId)!;
  state.round = 1 + CATEGORIES.filter((key) => player.scores[key] !== null).length;
}
export function finishOrAdvance(
  state: YachtRoomState,
  afterPlayerId: string | null,
  uuid: () => string,
): void {
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
  resetTurn(state, (active.find((p) => p.seat > oldSeat) ?? active[0])!.id, uuid);
}

export function applyIntent(
  state: YachtRoomState,
  playerId: string,
  command: Exclude<YachtIntent, { type: 'ready' | 'start' | 'rematch' | 'leave' }>,
  clock: EngineClock,
): void {
  const p = state.players.find((player) => player.id === playerId)!;
  if (command.type === 'hold') {
    if (state.rolls === 0) throw new GameError('ROLL_FIRST', '먼저 주사위를 굴려 주세요.');
    state.dice.forEach((die, index) => {
      die.held = command.held[index]!;
    });
  } else if (command.type === 'roll') {
    if (state.rolls >= 3) throw new GameError('NO_ROLLS', '이번 차례의 굴림을 모두 사용했습니다.');
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
    finishOrAdvance(state, playerId, clock.uuid);
  }
}
