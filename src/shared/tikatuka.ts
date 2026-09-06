import type { CommonPlayer, RoomBase } from './protocol';

export const TIKATUKA_RULES_VERSION = 'tikatuka-original-2026-07-08';
export const TIKATUKA_LANES = [0, 1, 2] as const;
export type TikatukaLane = (typeof TIKATUKA_LANES)[number];
export interface TikatukaDie {
  id: string;
  value: number;
  kind: 'normal' | 'shield';
}
export type TikatukaRollSource = 'opening' | 'normal' | 'bonus';
export interface TikatukaPendingDie extends TikatukaDie {
  source: TikatukaRollSource;
}
export type TikatukaBoard = [TikatukaDie[], TikatukaDie[], TikatukaDie[]];
export interface TikatukaPlayer extends CommonPlayer {
  lanes: TikatukaBoard;
  held: boolean;
  rerollUsed: boolean;
  laneScores: [number, number, number];
  laneWins: number;
  total: number;
}
export interface TikatukaDeclaration {
  playerId: string;
  responderId: string;
  status: 'pending' | 'accepted' | 'declined';
}
export type TikatukaEventType =
  | 'start'
  | 'roll'
  | 'place'
  | 'attack'
  | 'reroll'
  | 'choose'
  | 'hold'
  | 'declare'
  | 'respond'
  | 'finish'
  | 'forfeit';
export interface TikatukaEvent {
  id: string;
  type: TikatukaEventType;
  actorId: string;
  ownerId: string | null;
  lane: TikatukaLane | null;
  die: TikatukaPendingDie | null;
  removedIds: string[];
  at: number;
}
interface TikatukaCommonState extends RoomBase<'tikatuka', TikatukaPlayer> {
  nextRoll: TikatukaRollSource;
  firstPlayerId: string | null;
  turnNumber: number;
  declaration: TikatukaDeclaration | null;
  aiDueAt: number | null;
  latestEvent: TikatukaEvent | null;
  finishReason: 'boards' | 'holds' | 'declaration' | 'forfeit' | null;
}
export type TikatukaTurnState =
  | { stage: 'lobby' | 'finished'; pendingDie: null; rerollChoices: null }
  | { stage: 'placing'; pendingDie: TikatukaPendingDie; rerollChoices: null }
  | {
      stage: 'choosingReroll';
      pendingDie: null;
      rerollChoices: { original: TikatukaPendingDie; rerolled: TikatukaPendingDie };
    }
  | { stage: 'responding'; pendingDie: TikatukaPendingDie | null; rerollChoices: null };
export type TikatukaRoomState = TikatukaCommonState & TikatukaTurnState;
export type TikatukaIntent =
  | { type: 'tika_place'; ownerId: string; lane: TikatukaLane }
  | { type: 'tika_reroll' }
  | { type: 'tika_choose'; choice: 'original' | 'rerolled' }
  | { type: 'tika_hold' }
  | { type: 'tika_declare' }
  | { type: 'tika_respond'; accept: boolean };
export interface TikatukaTarget {
  ownerId: string;
  lane: TikatukaLane;
  action: 'place' | 'attack';
}
export interface TikatukaPreview {
  target: TikatukaTarget;
  removedIds: string[];
  consumesDie: boolean;
  grantsBonus: boolean;
  players: {
    playerId: string;
    laneScores: [number, number, number];
    laneWins: number;
    total: number;
  }[];
}

/** Original in-game double/triple: n equal faces contribute (2n-1)v. */
export function scoreTikatukaLane(dice: readonly Pick<TikatukaDie, 'value'>[]): number {
  const counts = new Map<number, number>();
  for (const die of dice) counts.set(die.value, (counts.get(die.value) ?? 0) + 1);
  return [...counts].reduce((sum, [face, count]) => sum + face * (2 * count - 1), 0);
}
export function scoreTikatukaPlayers(
  players: readonly Pick<TikatukaPlayer, 'id' | 'lanes'>[],
): TikatukaPreview['players'] {
  const scores = players.map((p) => ({
    playerId: p.id,
    laneScores: p.lanes.map(scoreTikatukaLane) as [number, number, number],
    laneWins: 0,
    total: 0,
  }));
  for (const p of scores) {
    p.total = p.laneScores.reduce((sum, score) => sum + score, 0);
    const other = scores.find((o) => o.playerId !== p.playerId);
    if (other)
      p.laneWins = TIKATUKA_LANES.filter(
        (lane) => p.laneScores[lane] > other.laneScores[lane],
      ).length;
  }
  return scores;
}
export function isTikatukaBoardFull(player: Pick<TikatukaPlayer, 'lanes'>): boolean {
  return player.lanes.every((lane) => lane.length === 3);
}
/** Targets express the original UI: attacking replaces placement in a matching lane. */
export function getTikatukaTargets(
  state: TikatukaRoomState,
  actorId = state.turnPlayerId,
): TikatukaTarget[] {
  if (state.phase !== 'playing' || state.stage !== 'placing' || actorId !== state.turnPlayerId)
    return [];
  const actor = state.players.find((p) => p.id === actorId);
  const other = state.players.find((p) => p.id !== actorId);
  if (!actor || !other || actor.held || actor.forfeited) return [];
  const die = state.pendingDie;
  const targets: TikatukaTarget[] = [];
  for (const lane of TIKATUKA_LANES) {
    if (die.kind === 'shield') {
      if (actor.lanes[lane].length < 3) targets.push({ ownerId: actor.id, lane, action: 'place' });
      if (die.source === 'bonus' && other.lanes[lane].length < 3)
        targets.push({ ownerId: other.id, lane, action: 'place' });
    } else if (actor.lanes[lane].length < 3) {
      const attack = other.lanes[lane].some((d) => d.value === die.value && d.kind === 'normal');
      targets.push({
        ownerId: attack ? other.id : actor.id,
        lane,
        action: attack ? 'attack' : 'place',
      });
    }
  }
  return targets;
}
export function previewTikatukaMove(
  state: TikatukaRoomState,
  ownerId: string,
  lane: TikatukaLane,
): TikatukaPreview | null {
  const target = getTikatukaTargets(state).find((t) => t.ownerId === ownerId && t.lane === lane);
  if (!target || state.stage !== 'placing') return null;
  const players = state.players.map((p) => ({
    id: p.id,
    lanes: p.lanes.map((l) => l.map((d) => ({ ...d }))) as TikatukaBoard,
  }));
  const owner = players.find((p) => p.id === ownerId)!;
  const die = state.pendingDie;
  const removedIds =
    target.action === 'attack'
      ? owner.lanes[lane]
          .filter((d) => d.kind === 'normal' && d.value === die.value)
          .map((d) => d.id)
      : [];
  if (target.action === 'attack')
    owner.lanes[lane] = owner.lanes[lane].filter((d) => !removedIds.includes(d.id));
  else owner.lanes[lane].push({ id: die.id, value: die.value, kind: die.kind });
  return {
    target,
    removedIds,
    consumesDie: target.action === 'attack',
    grantsBonus: target.action === 'attack',
    players: scoreTikatukaPlayers(players),
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100;
const exact = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));
function validDie(value: unknown, pending = false): value is TikatukaPendingDie {
  if (
    !record(value) ||
    !exact(value, pending ? ['id', 'value', 'kind', 'source'] : ['id', 'value', 'kind']) ||
    !identifier(value.id) ||
    !Number.isInteger(value.value) ||
    Number(value.value) < 1 ||
    Number(value.value) > 6 ||
    !['normal', 'shield'].includes(String(value.kind))
  )
    return false;
  if (!pending) return true;
  return (
    ['normal', 'opening', 'bonus'].includes(String(value.source)) &&
    (value.source === 'normal' ? value.kind === 'normal' : value.kind === 'shield')
  );
}
/** Game-specific persistence invariants; common identities/envelopes are checked by migration.ts. */
export function isTikatukaState(value: unknown): value is TikatukaRoomState {
  if (
    !record(value) ||
    value.gameType !== 'tikatuka' ||
    value.schemaVersion !== 2 ||
    value.protocolVersion !== 2 ||
    value.rulesVersion !== TIKATUKA_RULES_VERSION
  )
    return false;
  if (
    !exact(value, [
      'schemaVersion',
      'protocolVersion',
      'gameType',
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
      'nextRoll',
      'firstPlayerId',
      'turnNumber',
      'declaration',
      'aiDueAt',
      'latestEvent',
      'finishReason',
      'stage',
      'pendingDie',
      'rerollChoices',
    ])
  )
    return false;
  if (
    !Array.isArray(value.players) ||
    value.players.length > 2 ||
    (value.phase !== 'lobby' && value.players.length !== 2)
  )
    return false;
  const ids = new Set<string>();
  const dieIds = new Set<string>();
  for (const p of value.players) {
    if (
      !record(p) ||
      !exact(p, [
        'id',
        'kind',
        'nickname',
        'seat',
        'ready',
        'connected',
        'forfeited',
        'graceDeadline',
        'lanes',
        'held',
        'rerollUsed',
        'laneScores',
        'laneWins',
        'total',
      ]) ||
      !['human', 'computer'].includes(String(p.kind)) ||
      ![0, 1].includes(Number(p.seat)) ||
      !identifier(p.id) ||
      ids.has(p.id) ||
      typeof p.held !== 'boolean' ||
      typeof p.rerollUsed !== 'boolean' ||
      !Array.isArray(p.lanes) ||
      p.lanes.length !== 3
    )
      return false;
    if (
      p.kind === 'computer' &&
      (p.connected !== true || p.ready !== true || p.graceDeadline !== null)
    )
      return false;
    ids.add(p.id);
    for (const lane of p.lanes) {
      if (!Array.isArray(lane) || lane.length > 3) return false;
      for (const die of lane) {
        if (!validDie(die) || dieIds.has(die.id)) return false;
        dieIds.add(die.id);
      }
    }
    if (
      !Array.isArray(p.laneScores) ||
      p.laneScores.length !== 3 ||
      p.laneScores.some((s, i) => s !== scoreTikatukaLane((p.lanes as TikatukaBoard)[i]!))
    )
      return false;
    if (
      p.total !== p.laneScores.reduce((sum: number, s: number) => sum + s, 0) ||
      !Number.isInteger(p.laneWins) ||
      Number(p.laneWins) < 0 ||
      Number(p.laneWins) > 3
    )
      return false;
  }
  const players = value.players as TikatukaPlayer[];
  if (players.filter((p) => p.kind === 'computer').length > 1) return false;
  for (const score of scoreTikatukaPlayers(players))
    if (players.find((p) => p.id === score.playerId)!.laneWins !== score.laneWins) return false;
  if (
    !['opening', 'normal', 'bonus'].includes(String(value.nextRoll)) ||
    !Number.isInteger(value.turnNumber) ||
    Number(value.turnNumber) < 0
  )
    return false;
  if (
    value.firstPlayerId !== null &&
    (!identifier(value.firstPlayerId) || !ids.has(value.firstPlayerId))
  )
    return false;
  if (
    value.aiDueAt !== null &&
    (!finite(value.aiDueAt) ||
      value.phase !== 'playing' ||
      value.aiDueAt < Number(value.inputAfter))
  )
    return false;
  if (
    value.finishReason !== null &&
    !['boards', 'holds', 'forfeit'].includes(String(value.finishReason))
  )
    return false;
  // Advanced declaration is deliberately unavailable while its original contract is unresolved.
  if (value.declaration !== null || value.stage === 'responding') return false;
  if (value.stage === 'placing') {
    if (
      !validDie(value.pendingDie, true) ||
      value.rerollChoices !== null ||
      dieIds.has(value.pendingDie.id)
    )
      return false;
    if (value.pendingDie.source !== value.nextRoll) return false;
  } else if (value.stage === 'choosingReroll') {
    if (
      value.pendingDie !== null ||
      !record(value.rerollChoices) ||
      !exact(value.rerollChoices, ['original', 'rerolled'])
    )
      return false;
    const { original, rerolled } = value.rerollChoices;
    if (
      !validDie(original, true) ||
      !validDie(rerolled, true) ||
      original.id === rerolled.id ||
      dieIds.has(original.id) ||
      dieIds.has(rerolled.id) ||
      original.value === rerolled.value ||
      original.source !== rerolled.source ||
      original.kind !== rerolled.kind ||
      original.source !== value.nextRoll
    )
      return false;
    if (!players.find((p) => p.id === value.turnPlayerId)?.rerollUsed) return false;
  } else if (value.stage !== 'lobby' && value.stage !== 'finished') return false;
  else if (value.pendingDie !== null || value.rerollChoices !== null) return false;
  if (value.phase === 'lobby') {
    if (
      value.stage !== 'lobby' ||
      value.turnPlayerId !== null ||
      value.firstPlayerId !== null ||
      value.turnNumber !== 0 ||
      value.nextRoll !== 'opening' ||
      value.finishReason !== null ||
      value.aiDueAt !== null ||
      value.latestEvent !== null
    )
      return false;
    if (players.some((p) => p.held || p.rerollUsed || p.lanes.some((lane) => lane.length)))
      return false;
  } else if (value.phase === 'playing') {
    const actor = players.find((p) => p.id === value.turnPlayerId);
    if (
      !actor ||
      actor.forfeited ||
      actor.held ||
      isTikatukaBoardFull(actor) ||
      value.firstPlayerId === null ||
      Number(value.turnNumber) < 1 ||
      !['placing', 'choosingReroll'].includes(String(value.stage)) ||
      value.finishReason !== null
    )
      return false;
    if (
      value.nextRoll === 'opening' &&
      (value.turnNumber !== 1 || dieIds.size !== 0 || value.firstPlayerId !== value.turnPlayerId)
    )
      return false;
    if (value.aiDueAt !== null && actor.kind !== 'computer') return false;
  } else if (value.phase === 'finished') {
    if (
      value.stage !== 'finished' ||
      value.turnPlayerId !== null ||
      value.aiDueAt !== null ||
      value.finishReason === null
    )
      return false;
    if (value.finishReason === 'boards' && !players.every(isTikatukaBoardFull)) return false;
    if (
      value.finishReason === 'holds' &&
      (!players.some((p) => p.held) || !players.every((p) => p.held || isTikatukaBoardFull(p)))
    )
      return false;
    if (value.finishReason === 'forfeit' && !players.some((p) => p.forfeited)) return false;
    if (!Array.isArray(value.results) || value.results.length !== players.length) return false;
    for (const p of players) {
      const result = value.results.find((r: unknown) => record(r) && r.playerId === p.id);
      const rank =
        1 +
        players.filter(
          (o) =>
            Number(o.forfeited) < Number(p.forfeited) ||
            (o.forfeited === p.forfeited &&
              (o.laneWins > p.laneWins || (o.laneWins === p.laneWins && o.total > p.total))),
        ).length;
      if (
        !record(result) ||
        result.rank !== rank ||
        result.total !== p.total ||
        result.forfeited !== p.forfeited
      )
        return false;
    }
  } else return false;
  if (value.latestEvent !== null) {
    const e = value.latestEvent;
    if (
      !record(e) ||
      !exact(e, ['id', 'type', 'actorId', 'ownerId', 'lane', 'die', 'removedIds', 'at']) ||
      !identifier(e.id) ||
      !finite(e.at) ||
      !ids.has(String(e.actorId)) ||
      ![
        'start',
        'roll',
        'place',
        'attack',
        'reroll',
        'choose',
        'hold',
        'declare',
        'respond',
        'finish',
        'forfeit',
      ].includes(String(e.type)) ||
      (e.ownerId !== null && !ids.has(String(e.ownerId))) ||
      (e.lane !== null && !TIKATUKA_LANES.includes(e.lane as TikatukaLane)) ||
      (e.die !== null && !validDie(e.die, true)) ||
      !Array.isArray(e.removedIds) ||
      e.removedIds.some((id) => !identifier(id)) ||
      new Set(e.removedIds).size !== e.removedIds.length
    )
      return false;
  }
  return true;
}
export function assertTikatukaState(value: unknown): asserts value is TikatukaRoomState {
  if (!isTikatukaState(value)) throw new Error('Invalid persisted Tikatuka state');
}
