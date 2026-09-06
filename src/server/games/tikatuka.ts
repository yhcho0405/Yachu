import type { CommonPlayer, RoomBase } from '../../shared/protocol';
import {
  TIKATUKA_RULES_VERSION,
  getTikatukaTargets,
  isTikatukaBoardFull,
  previewTikatukaMove,
  scoreTikatukaPlayers,
  type TikatukaBoard,
  type TikatukaEvent,
  type TikatukaIntent,
  type TikatukaPendingDie,
  type TikatukaPlayer,
  type TikatukaRoomState,
  type TikatukaRollSource,
  type TikatukaTarget,
} from '../../shared/tikatuka';
import { EngineClock, GameError } from '../errors';

export const TIKATUKA_ROLL_MS = 700;
export const TIKATUKA_MOVE_MS = 350;
const emptyBoard = (): TikatukaBoard => [[], [], []];
export function createPlayer(base: CommonPlayer): TikatukaPlayer {
  return {
    ...base,
    lanes: emptyBoard(),
    held: false,
    rerollUsed: false,
    laneScores: [0, 0, 0],
    laneWins: 0,
    total: 0,
  };
}
export function createState(base: RoomBase<'tikatuka', TikatukaPlayer>): TikatukaRoomState {
  return {
    ...base,
    rulesVersion: TIKATUKA_RULES_VERSION,
    stage: 'lobby',
    pendingDie: null,
    rerollChoices: null,
    nextRoll: 'opening',
    firstPlayerId: null,
    turnNumber: 0,
    declaration: null,
    aiDueAt: null,
    latestEvent: null,
    finishReason: null,
  };
}
export function reset(state: TikatukaRoomState): void {
  for (const p of state.players)
    Object.assign(p, {
      lanes: emptyBoard(),
      held: false,
      rerollUsed: false,
      laneScores: [0, 0, 0],
      laneWins: 0,
      total: 0,
    });
  Object.assign(state, {
    stage: 'lobby',
    pendingDie: null,
    rerollChoices: null,
    nextRoll: 'opening',
    firstPlayerId: null,
    turnNumber: 0,
    declaration: null,
    aiDueAt: null,
    latestEvent: null,
    finishReason: null,
    inputAfter: 0,
    turnPlayerId: null,
    results: [],
  });
}
function event(
  state: TikatukaRoomState,
  clock: EngineClock,
  data: Omit<TikatukaEvent, 'id' | 'at'>,
): void {
  state.latestEvent = { ...data, id: clock.uuid(), at: clock.now };
}
function simpleEvent(
  state: TikatukaRoomState,
  clock: EngineClock,
  type: TikatukaEvent['type'],
  actorId: string,
  die: TikatukaPendingDie | null = null,
): void {
  event(state, clock, { type, actorId, die, ownerId: null, lane: null, removedIds: [] });
}
function updateScores(state: TikatukaRoomState): void {
  for (const score of scoreTikatukaPlayers(state.players)) {
    const player = state.players.find((p) => p.id === score.playerId)!;
    player.laneScores = score.laneScores;
    player.total = score.total;
    player.laneWins = score.laneWins;
  }
}
export function actingPlayerId(state: TikatukaRoomState): string | null {
  if (state.phase !== 'playing') return null;
  return state.stage === 'responding'
    ? (state.declaration?.responderId ?? null)
    : state.turnPlayerId;
}
export function start(state: TikatukaRoomState, clock: EngineClock): void {
  if (state.players.length !== 2)
    throw new GameError('TIKA_REQUIRES_TWO', '티카투카는 두 명이 참가해야 시작할 수 있습니다.');
  reset(state);
  // The multiplayer adaptation chooses the first seat fairly on the authority.
  const first = state.players[clock.die() <= 3 ? 0 : 1]!;
  state.phase = 'playing';
  state.firstPlayerId = first.id;
  state.turnPlayerId = first.id;
  state.turnId = clock.uuid();
  state.turnNumber = 1;
  const opening = pending(clock, 'opening');
  Object.assign(state, {
    stage: 'placing',
    pendingDie: opening,
    inputAfter: clock.now + TIKATUKA_ROLL_MS,
  });
  simpleEvent(state, clock, 'start', first.id, opening);
}
function finish(
  state: TikatukaRoomState,
  reason: NonNullable<TikatukaRoomState['finishReason']>,
): void {
  updateScores(state);
  const sorted = [...state.players].sort(
    (a, b) =>
      Number(a.forfeited) - Number(b.forfeited) ||
      b.laneWins - a.laneWins ||
      b.total - a.total ||
      a.seat - b.seat,
  );
  state.results = sorted.map((p) => ({
    playerId: p.id,
    total: p.total,
    forfeited: p.forfeited,
    rank:
      1 +
      sorted.filter(
        (o) =>
          Number(o.forfeited) < Number(p.forfeited) ||
          (o.forfeited === p.forfeited &&
            (o.laneWins > p.laneWins || (o.laneWins === p.laneWins && o.total > p.total))),
      ).length,
  }));
  Object.assign(state, {
    phase: 'finished',
    stage: 'finished',
    pendingDie: null,
    rerollChoices: null,
    turnPlayerId: null,
    aiDueAt: null,
    inputAfter: 0,
    finishReason: reason,
  });
}
function advance(state: TikatukaRoomState, actorId: string, clock: EngineClock): void {
  updateScores(state);
  if (state.players.some((p) => p.forfeited)) {
    finish(state, 'forfeit');
    return;
  }
  const eligible = state.players.filter((p) => !p.held && !isTikatukaBoardFull(p));
  if (eligible.length === 0) {
    finish(state, state.players.some((p) => p.held) ? 'holds' : 'boards');
    return;
  }
  const next = eligible.find((p) => p.id !== actorId) ?? eligible[0]!;
  Object.assign(state, {
    stage: 'placing',
    pendingDie: pending(clock, 'normal'),
    rerollChoices: null,
    nextRoll: 'normal',
    turnPlayerId: next.id,
    turnId: clock.uuid(),
    inputAfter: clock.now + TIKATUKA_MOVE_MS + TIKATUKA_ROLL_MS,
  });
  state.turnNumber++;
}
export function forfeit(state: TikatukaRoomState, playerId: string, clock: EngineClock): void {
  const p = state.players.find((candidate) => candidate.id === playerId);
  if (!p || state.phase !== 'playing') return;
  p.forfeited = true;
  simpleEvent(state, clock, 'forfeit', playerId);
  finish(state, 'forfeit');
}
function pending(clock: EngineClock, source: TikatukaRollSource): TikatukaPendingDie {
  return {
    id: clock.uuid(),
    value: clock.die(),
    kind: source === 'normal' ? 'normal' : 'shield',
    source,
  };
}
function differentFace(clock: EngineClock, original: number): number {
  // Rejection over the authoritative fair six-sided die leaves five equal outcomes.
  for (let n = 0; n < 128; n++) {
    const face = clock.die();
    if (face !== original) return face;
  }
  throw new GameError('RNG_UNAVAILABLE', '주사위를 생성하지 못했습니다. 다시 시도해 주세요.', 503);
}
export function applyIntent(
  state: TikatukaRoomState,
  playerId: string,
  intent: TikatukaIntent,
  clock: EngineClock,
): void {
  if (state.phase !== 'playing') throw new GameError('NOT_PLAYING', '진행 중인 경기가 아닙니다.');
  const actor = state.players.find((p) => p.id === playerId);
  if (!actor || actor.forfeited || actingPlayerId(state) !== playerId)
    throw new GameError('NOT_YOUR_TURN', '자신의 차례에 조작할 수 있습니다.', 403);
  if (clock.now < state.inputAfter)
    throw new GameError('INPUT_PENDING', '주사위가 멈출 때까지 잠시 기다려 주세요.');
  if (intent.type === 'tika_place') {
    if (state.stage !== 'placing')
      throw new GameError('TIKA_NOT_PLACING', '먼저 사용할 주사위를 확정해 주세요.');
    const projection = previewTikatukaMove(state, intent.ownerId, intent.lane);
    if (!projection)
      throw new GameError('TIKA_INVALID_TARGET', '이 주사위를 놓을 수 없는 칸입니다.');
    const die = { ...state.pendingDie };
    const owner = state.players.find((p) => p.id === intent.ownerId)!;
    if (projection.target.action === 'attack') {
      // Removal and the independent bonus roll commit together. The original game
      // presents the bonus immediately, and its unplaced result must survive reload.
      const bonus = pending(clock, 'bonus');
      owner.lanes[intent.lane] = owner.lanes[intent.lane].filter(
        (d) => !projection.removedIds.includes(d.id),
      );
      Object.assign(state, {
        stage: 'placing',
        pendingDie: bonus,
        rerollChoices: null,
        nextRoll: 'bonus',
        inputAfter: clock.now + TIKATUKA_MOVE_MS + TIKATUKA_ROLL_MS,
      });
      updateScores(state);
    } else {
      owner.lanes[intent.lane].push({ id: die.id, value: die.value, kind: die.kind });
      advance(state, playerId, clock);
    }
    event(state, clock, {
      type: projection.target.action,
      actorId: playerId,
      ownerId: owner.id,
      lane: intent.lane,
      die,
      removedIds: projection.removedIds,
    });
  } else if (intent.type === 'tika_reroll') {
    if (state.stage !== 'placing' || actor.rerollUsed)
      throw new GameError(
        'TIKA_REROLL_UNAVAILABLE',
        '이번 경기의 타짜의 손놀림을 사용할 수 없습니다.',
      );
    const original = { ...state.pendingDie };
    const rerolled = { ...original, id: clock.uuid(), value: differentFace(clock, original.value) };
    actor.rerollUsed = true;
    Object.assign(state, {
      stage: 'choosingReroll',
      pendingDie: null,
      rerollChoices: { original, rerolled },
      inputAfter: clock.now + TIKATUKA_ROLL_MS,
    });
    simpleEvent(state, clock, 'reroll', playerId, rerolled);
  } else if (intent.type === 'tika_choose') {
    if (state.stage !== 'choosingReroll')
      throw new GameError('TIKA_NO_CANDIDATES', '선택할 주사위 후보가 없습니다.');
    const selected = { ...state.rerollChoices[intent.choice] };
    Object.assign(state, { stage: 'placing', pendingDie: selected, rerollChoices: null });
    simpleEvent(state, clock, 'choose', playerId, selected);
  } else if (intent.type === 'tika_hold') {
    if (state.stage !== 'placing')
      throw new GameError('TIKA_HOLD_UNAVAILABLE', '주사위 선택을 마친 뒤 홀드할 수 있습니다.');
    if (actor.held) throw new GameError('TIKA_ALREADY_HELD', '이미 홀드한 참가자입니다.');
    actor.held = true;
    simpleEvent(state, clock, 'hold', playerId, state.pendingDie);
    advance(state, playerId, clock);
  } else {
    // Kept explicit until an original advanced-rules screen establishes its contract.
    throw new GameError('TIKA_RULE_UNCONFIRMED', '티카투카 선언의 원본 규칙을 확인 중입니다.');
  }
}

function utility(state: TikatukaRoomState, actorId: string): number {
  const scored = scoreTikatukaPlayers(state.players);
  const actor = state.players.find((p) => p.id === actorId)!;
  const other = state.players.find((p) => p.id !== actorId)!;
  const a = scored.find((p) => p.playerId === actorId)!;
  const b = scored.find((p) => p.playerId !== actorId)!;
  let result = 0;
  for (const lane of [0, 1, 2] as const) {
    const diff = a.laneScores[lane] - b.laneScores[lane];
    // Saturation prizes two competitive lanes over wasting points in one landslide.
    result += 9 * Math.tanh(diff / 7);
    if (actor.lanes[lane].length === 3 && other.lanes[lane].length === 3)
      result += Math.sign(diff) * 18;
    result += (3 - actor.lanes[lane].length) * 0.8 - (3 - other.lanes[lane].length) * 0.8;
    result += actor.lanes[lane]
      .filter((d) => d.kind === 'shield')
      .reduce((sum, d) => sum + d.value * 0.23, 0);
    result -= other.lanes[lane]
      .filter((d) => d.kind === 'shield')
      .reduce((sum, d) => sum + d.value * 0.23, 0);
    for (const d of actor.lanes[lane])
      if (d.kind === 'normal' && other.lanes[lane].length < 3) result -= d.value * 0.12;
    for (const d of other.lanes[lane])
      if (d.kind === 'normal' && actor.lanes[lane].length < 3) result += d.value * 0.12;
  }
  if (state.players.every((p) => p.held || isTikatukaBoardFull(p))) {
    result += Math.sign(a.laneWins - b.laneWins || a.total - b.total) * 1000;
  }
  return result;
}
function simulateTarget(state: TikatukaRoomState, target: TikatukaTarget): TikatukaRoomState {
  const copy = structuredClone(state);
  if (copy.stage !== 'placing') return copy;
  const owner = copy.players.find((p) => p.id === target.ownerId)!;
  if (target.action === 'attack')
    owner.lanes[target.lane] = owner.lanes[target.lane].filter(
      (d) => d.kind === 'shield' || d.value !== copy.pendingDie!.value,
    );
  else
    owner.lanes[target.lane].push({
      id: copy.pendingDie.id,
      value: copy.pendingDie.value,
      kind: copy.pendingDie.kind,
    });
  return copy;
}
function placementValue(state: TikatukaRoomState, target: TikatukaTarget, actorId: string): number {
  const copy = simulateTarget(state, target);
  if (target.action !== 'attack') return utility(copy, actorId);
  // Attack creates a bonus decision. Evaluate all six fair values, not a hidden roll.
  let expected = 0;
  for (let face = 1; face <= 6; face++) {
    Object.assign(copy, {
      stage: 'placing',
      pendingDie: { id: 'ai-evaluation', value: face, kind: 'shield', source: 'bonus' },
      rerollChoices: null,
    });
    expected +=
      Math.max(...getTikatukaTargets(copy).map((t) => utility(simulateTarget(copy, t), actorId))) /
      6;
  }
  return expected;
}
function bestPlacement(
  state: TikatukaRoomState,
  actorId: string,
): { target: TikatukaTarget; value: number } | null {
  const candidates = getTikatukaTargets(state).map((target) => ({
    target,
    value: placementValue(state, target, actorId),
  }));
  candidates.sort((a, b) => b.value - a.value);
  return candidates[0] ?? null;
}
/** Decisions use public board and exact expectations only; no access to future RNG. */
export function chooseAI(state: TikatukaRoomState): TikatukaIntent | null {
  const actorId = actingPlayerId(state);
  const actor = state.players.find((p) => p.id === actorId);
  const other = state.players.find((p) => p.id !== actorId);
  if (!actorId || !actor || !other || actor.kind !== 'computer' || actor.forfeited) return null;
  if (state.stage === 'responding') return null;
  if (state.stage === 'choosingReroll') {
    const values = (['original', 'rerolled'] as const).map((choice) => {
      const copy = structuredClone(state);
      Object.assign(copy, {
        stage: 'placing',
        pendingDie: state.rerollChoices[choice],
        rerollChoices: null,
      });
      return { choice, value: bestPlacement(copy, actorId)?.value ?? -Infinity };
    });
    return {
      type: 'tika_choose',
      choice: values[1]!.value > values[0]!.value ? 'rerolled' : 'original',
    };
  }
  if (state.stage !== 'placing') return null;
  if (isTikatukaBoardFull(other) || other.held) {
    const held = structuredClone(state);
    held.players.find((p) => p.id === actorId)!.held = true;
    if (utility(held, actorId) > 900) return { type: 'tika_hold' };
  }
  const best = bestPlacement(state, actorId);
  if (!best) return { type: 'tika_hold' };
  if (!actor.rerollUsed) {
    let expected = 0;
    for (let face = 1; face <= 6; face++) {
      if (face === state.pendingDie.value) continue;
      const copy = structuredClone(state);
      if (copy.stage === 'placing') copy.pendingDie.value = face;
      expected += Math.max(best.value, bestPlacement(copy, actorId)?.value ?? -Infinity) / 5;
    }
    if (expected > best.value + 1.8) return { type: 'tika_reroll' };
  }
  return { type: 'tika_place', ownerId: best.target.ownerId, lane: best.target.lane };
}
