import type { CommonPlayer, RoomBase } from './protocol';
import { GameError, type EngineClock } from '../server/errors';

export const AVALON_RULES_VERSION = 'avalon-base-2012-web-v1';
export const AVALON_OPTIONAL_ROLES = ['percival', 'morgana', 'mordred', 'oberon'] as const;
export type AvalonOptionalRole = (typeof AVALON_OPTIONAL_ROLES)[number];
export type AvalonRole = 'merlin' | 'assassin' | 'servant' | 'minion' | AvalonOptionalRole;
export type AvalonAlignment = 'good' | 'evil';
export type AvalonQuestCard = 'success' | 'fail';
export const AVALON_ROLE_LABELS: Record<AvalonRole, string> = {
  merlin: '멀린',
  assassin: '암살자',
  servant: '아서의 충신',
  minion: '모드레드의 수하',
  percival: '퍼시벌',
  morgana: '모르가나',
  mordred: '모드레드',
  oberon: '오베론',
};
export const AVALON_ROLE_DESCRIPTIONS: Record<AvalonRole, string> = {
  merlin: '모드레드를 제외한 악의 인물을 압니다. 멀린임을 들키지 않도록 선을 도우세요.',
  assassin: '원정이 세 번 성공하면 멀린을 지목합니다. 오베론을 제외한 악의 동료를 압니다.',
  servant: '다른 사람의 역할을 모릅니다. 토론과 공개 기록으로 선을 찾으세요.',
  minion: '오베론을 제외한 악의 동료를 압니다. 동료의 상세 역할은 알 수 없습니다.',
  percival: '멀린 후보를 압니다. 모르가나가 있다면 두 후보를 구별할 수 없습니다.',
  morgana: '퍼시벌에게 멀린과 같은 후보로 보입니다. 오베론을 제외한 악의 동료를 압니다.',
  mordred: '멀린에게 보이지 않습니다. 오베론을 제외한 악의 동료를 압니다.',
  oberon: '다른 악의 인물을 모르며, 다른 악의 인물도 당신을 알지 못합니다. 멀린은 당신을 압니다.',
};
export interface AvalonConfig {
  optionalRoles: AvalonOptionalRole[];
  ladyOfLake: boolean;
}
export const DEFAULT_AVALON_CONFIG: Readonly<AvalonConfig> = {
  optionalRoles: [],
  ladyOfLake: false,
};
export const AVALON_PLAYER_COUNTS: Readonly<
  Record<number, { good: number; evil: number; quests: readonly number[] }>
> = {
  5: { good: 3, evil: 2, quests: [2, 3, 2, 3, 3] },
  6: { good: 4, evil: 2, quests: [2, 3, 4, 3, 4] },
  7: { good: 4, evil: 3, quests: [2, 3, 3, 4, 4] },
  8: { good: 5, evil: 3, quests: [3, 4, 4, 5, 5] },
  9: { good: 6, evil: 3, quests: [3, 4, 4, 5, 5] },
  10: { good: 6, evil: 4, quests: [3, 4, 4, 5, 5] },
};
export type AvalonStage =
  'lobby' | 'team' | 'vote' | 'quest' | 'lady' | 'assassination' | 'finished';
export type AvalonFinishReason =
  | 'three_failed_quests'
  | 'five_rejections'
  | 'merlin_assassinated'
  | 'assassination_missed'
  | 'disconnected'
  | 'player_left'
  | 'session_expired'
  | 'room_expired';
export type AvalonAbortReason = Extract<
  AvalonFinishReason,
  'disconnected' | 'player_left' | 'session_expired' | 'room_expired'
>;
export interface AvalonProposal {
  id: string;
  questNumber: number;
  leaderId: string;
  teamIds: string[];
  /** Membership only. Sorted by fixed seat, never by arrival or card value. */
  submittedIds: string[];
}
export interface AvalonVoteRecord {
  id: string;
  questNumber: number;
  attempt: number;
  leaderId: string;
  teamIds: string[];
  votes: { playerId: string; approve: boolean }[];
  approved: boolean;
  at: number;
}
export interface AvalonQuestRecord {
  questNumber: number;
  proposalId: string;
  teamIds: string[];
  /** No card IDs, author mapping, card order, or individual submission timestamps. */
  successCount: number;
  failCount: number;
  failed: boolean;
  at: number;
}
export interface AvalonLadyInvestigation {
  actorId: string;
  targetId: string;
  questNumber: number;
}
export interface AvalonLadyInsight extends AvalonLadyInvestigation {
  alignment: AvalonAlignment;
}
export interface AvalonLadyState {
  holderId: string;
  usedByIds: string[];
  investigations: AvalonLadyInvestigation[];
}
export interface AvalonEvent {
  id: string;
  type:
    | 'config'
    | 'start'
    | 'team_proposed'
    | 'vote_submitted'
    | 'vote_revealed'
    | 'quest_submitted'
    | 'quest_resolved'
    | 'lady_used'
    | 'assassination'
    | 'aborted';
  actorId: string | null;
  targetId: string | null;
  questNumber: number;
  proposalId: string | null;
  at: number;
}
export interface AvalonHistory {
  proposals: AvalonVoteRecord[];
  quests: AvalonQuestRecord[];
  events: AvalonEvent[];
}
export interface AvalonChatMessage {
  id: string;
  playerId: string;
  text: string;
  at: number;
}
export type AvalonSignalKind = 'question' | 'speak' | 'trust' | 'suspect' | 'agree';
export interface AvalonSignal {
  id: string;
  playerId: string;
  targetId: string;
  kind: AvalonSignalKind;
  at: number;
}

/** Safe input for the board renderer. Every property is public knowledge. */
export interface AvalonPublicState extends RoomBase<'avalon', CommonPlayer> {
  stage: AvalonStage;
  phaseId: string;
  config: AvalonConfig;
  leaderId: string | null;
  questNumber: number;
  rejections: number;
  proposal: AvalonProposal | null;
  history: AvalonHistory;
  lady: AvalonLadyState | null;
  winner: AvalonAlignment | null;
  finishReason: AvalonFinishReason | null;
  /** Empty during play AND a void termination. */
  revealedRoles: { playerId: string; role: AvalonRole; alignment: AvalonAlignment }[];
  latestEvent: AvalonEvent | null;
  chat: AvalonChatMessage[];
  signals: AvalonSignal[];
}
export interface AvalonPrivateInfo {
  playerId: string;
  role: AvalonRole;
  alignment: AvalonAlignment;
  /** Neither alignment group contains detailed roles of other players. */
  knownEvilIds: string[];
  merlinCandidateIds: string[];
  ladyInsights: AvalonLadyInsight[];
  myVote: boolean | null;
  /** Current unresolved quest only; removed immediately after aggregation. */
  myQuestCard: AvalonQuestCard | null;
}
/** HTTP, WebSocket and receipt payload. Never serialize AvalonInternalState. */
export interface AvalonRoomState extends AvalonPublicState {
  privateInfo: AvalonPrivateInfo | null;
}
export interface AvalonSecrets {
  roles: Record<string, AvalonRole>;
  votes: Record<string, boolean>;
  questCards: Record<string, AvalonQuestCard>;
  ladyInsights: AvalonLadyInsight[];
}
/** Server persistence only; deliberately incompatible with AvalonRoomState. */
export interface AvalonInternalState extends AvalonPublicState {
  secrets: AvalonSecrets;
}
export interface AvalonPhaseIntent {
  phaseId: string;
  proposalId: string | null;
}
export type AvalonGameIntent = AvalonPhaseIntent &
  (
    | { type: 'av_config'; config: AvalonConfig }
    | { type: 'av_team'; teamIds: string[] }
    | { type: 'av_vote'; approve: boolean }
    | { type: 'av_quest'; card: AvalonQuestCard }
    | { type: 'av_lady'; targetId: string }
    | { type: 'av_assassinate'; targetId: string }
  );
export type AvalonIntent =
  | AvalonGameIntent
  | { type: 'av_chat'; text: string }
  | { type: 'av_signal'; targetId: string; kind: AvalonSignalKind };

export function avalonAlignment(role: AvalonRole): AvalonAlignment {
  return role === 'merlin' || role === 'percival' || role === 'servant' ? 'good' : 'evil';
}
export function getAvalonQuestSize(playerCount: number, questNumber: number): number {
  return AVALON_PLAYER_COUNTS[playerCount]?.quests[questNumber - 1] ?? 0;
}
export function getAvalonFailThreshold(playerCount: number, questNumber: number): number {
  return playerCount >= 7 && questNumber === 4 ? 2 : 1;
}
export function isAvalonConfig(value: unknown): value is AvalonConfig {
  if (!object(value) || !exactKeys(value, ['optionalRoles', 'ladyOfLake'])) return false;
  return (
    typeof value.ladyOfLake === 'boolean' &&
    Array.isArray(value.optionalRoles) &&
    value.optionalRoles.length <= 4 &&
    new Set(value.optionalRoles).size === value.optionalRoles.length &&
    value.optionalRoles.every((r) => AVALON_OPTIONAL_ROLES.includes(r as AvalonOptionalRole))
  );
}
/** Configuration errors only: common lobby connectivity/readiness is checked by the authority. */
export function getAvalonStartIssues(playerCount: number, config: AvalonConfig): string[] {
  if (!isAvalonConfig(config)) return ['선택 역할 구성이 올바르지 않습니다.'];
  const counts = AVALON_PLAYER_COUNTS[playerCount];
  if (!counts)
    return [
      playerCount < 5
        ? `시작하려면 ${5 - playerCount}명이 더 필요합니다. (5~10인)`
        : '아발론은 5~10인 게임입니다.',
    ];
  const issues: string[] = [];
  if (1 + config.optionalRoles.filter((r) => avalonAlignment(r) === 'evil').length > counts.evil)
    issues.push(`암살자를 포함한 악의 특수 역할은 ${counts.evil}명을 넘을 수 없습니다.`);
  if (
    playerCount === 5 &&
    config.optionalRoles.includes('percival') &&
    !config.optionalRoles.includes('mordred') &&
    !config.optionalRoles.includes('morgana')
  )
    issues.push('5인에서 퍼시벌을 사용하려면 모르가나 또는 모드레드를 함께 선택하세요.');
  return issues;
}
export function getAvalonConfigWarnings(playerCount: number, config: AvalonConfig): string[] {
  return config.ladyOfLake && playerCount < 7
    ? ['호수의 여인은 7인 이상에서 사용하기를 원작이 권장합니다.']
    : [];
}
export function getAvalonRoles(playerCount: number, config: AvalonConfig): AvalonRole[] {
  const issues = getAvalonStartIssues(playerCount, config);
  if (issues.length) throw new GameError('INVALID_CONFIG', issues[0]!, 400);
  const roles: AvalonRole[] = [
    'merlin',
    'assassin',
    ...AVALON_OPTIONAL_ROLES.filter((r) => config.optionalRoles.includes(r)),
  ];
  const counts = AVALON_PLAYER_COUNTS[playerCount]!;
  while (roles.filter((r) => avalonAlignment(r) === 'good').length < counts.good)
    roles.push('servant');
  while (roles.length < playerCount) roles.push('minion');
  return roles;
}

export interface AvalonActions {
  canConfigure: boolean;
  canSelectTeam: boolean;
  canVote: boolean;
  canSubmitQuest: boolean;
  questCards: AvalonQuestCard[];
  canUseLady: boolean;
  ladyTargetIds: string[];
  canAssassinate: boolean;
  assassinationTargetIds: string[];
  submitted: boolean;
}
export function getAvalonActions(state: AvalonRoomState, playerId: string): AvalonActions {
  const member = state.players.some((p) => p.id === playerId);
  const active = member && state.phase === 'playing';
  const own = state.privateInfo?.playerId === playerId ? state.privateInfo : null;
  const submitted = state.proposal?.submittedIds.includes(playerId) ?? false;
  const canSubmitQuest =
    active && state.stage === 'quest' && !!state.proposal?.teamIds.includes(playerId) && !submitted;
  const canUseLady = active && state.stage === 'lady' && state.lady?.holderId === playerId;
  const canAssassinate = active && state.stage === 'assassination' && own?.role === 'assassin';
  return {
    canConfigure: member && state.phase === 'lobby' && state.hostId === playerId,
    canSelectTeam: active && state.stage === 'team' && state.leaderId === playerId,
    canVote: active && state.stage === 'vote' && !submitted,
    canSubmitQuest,
    questCards:
      canSubmitQuest && own ? (own.alignment === 'evil' ? ['success', 'fail'] : ['success']) : [],
    canUseLady,
    ladyTargetIds: canUseLady
      ? state.players
          .filter((p) => p.id !== playerId && !state.lady!.usedByIds.includes(p.id))
          .map((p) => p.id)
      : [],
    canAssassinate,
    assassinationTargetIds: canAssassinate
      ? state.players.filter((p) => p.id !== playerId).map((p) => p.id)
      : [],
    submitted,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Rejection sampling over 36 equiprobable outcomes; the authority supplies cryptoDie. */
export function avalonRandomBelow(bound: number, die: () => number): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > 10)
    throw new RangeError('Invalid random bound');
  const limit = Math.floor(36 / bound) * bound;
  for (let attempt = 0; attempt < 256; attempt++) {
    const a = die(),
      b = die();
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > 6 || b < 1 || b > 6) break;
    const value = (a - 1) * 6 + b - 1;
    if (value < limit) return value % bound;
  }
  throw new GameError(
    'RANDOM_UNAVAILABLE',
    '경기를 준비할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    503,
  );
}
function emptySecrets(): AvalonSecrets {
  return { roles: {}, votes: {}, questCards: {}, ladyInsights: [] };
}
export function createState(base: RoomBase<'avalon', CommonPlayer>): AvalonInternalState {
  return {
    ...base,
    protocolVersion: 3,
    rulesVersion: AVALON_RULES_VERSION,
    stage: 'lobby',
    phaseId: base.turnId,
    config: { optionalRoles: [], ladyOfLake: false },
    leaderId: null,
    questNumber: 1,
    rejections: 0,
    proposal: null,
    history: { proposals: [], quests: [], events: [] },
    lady: null,
    winner: null,
    finishReason: null,
    revealedRoles: [],
    latestEvent: null,
    chat: [],
    signals: [],
    secrets: emptySecrets(),
  };
}
export function createPlayer(base: CommonPlayer): CommonPlayer {
  return { ...base, kind: 'human' };
}
export function reset(state: AvalonInternalState): void {
  state.stage = 'lobby';
  state.phase = 'lobby';
  state.phaseId = state.turnId;
  state.turnPlayerId = null;
  state.inputAfter = 0;
  state.leaderId = null;
  state.questNumber = 1;
  state.rejections = 0;
  state.proposal = null;
  state.history = { proposals: [], quests: [], events: [] };
  state.lady = null;
  state.winner = null;
  state.finishReason = null;
  state.revealedRoles = [];
  state.latestEvent = null;
  state.results = [];
  state.chat = [];
  state.signals = [];
  state.secrets = emptySecrets();
}
function phase(state: AvalonInternalState, stage: AvalonStage, clock: EngineClock): void {
  state.stage = stage;
  state.phaseId = clock.uuid();
  state.turnId = state.phaseId;
  state.inputAfter = clock.now;
  state.turnPlayerId =
    stage === 'team' ? state.leaderId : stage === 'lady' ? state.lady!.holderId : null;
}
function emit(
  state: AvalonInternalState,
  type: AvalonEvent['type'],
  clock: EngineClock,
  actorId: string | null = null,
  targetId: string | null = null,
  questNumber = state.questNumber,
  proposalId = state.proposal?.id ?? null,
): void {
  const event: AvalonEvent = {
    id: clock.uuid(),
    type,
    actorId,
    targetId,
    questNumber,
    proposalId,
    at: clock.now,
  };
  state.latestEvent = event;
  // Submission events convey presence only and need not fill the permanent discussion record.
  if (type !== 'vote_submitted' && type !== 'quest_submitted') {
    state.history.events.push(event);
    if (state.history.events.length > 128) state.history.events.shift();
  }
}
function orderedIds(state: AvalonPublicState, ids: readonly string[]): string[] {
  return state.players
    .filter((p) => ids.includes(p.id))
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.id);
}
function nextLeader(state: AvalonInternalState): void {
  const ids = orderedIds(
    state,
    state.players.map((p) => p.id),
  );
  state.leaderId = ids[(ids.indexOf(state.leaderId!) + 1) % ids.length]!;
}
export function start(state: AvalonInternalState, clock: EngineClock): void {
  const roles = getAvalonRoles(state.players.length, state.config);
  if (state.stage !== 'lobby' || state.players.some((p) => p.kind !== 'human'))
    throw new GameError('INVALID_STAGE', '아발론은 로비에서 사람 5~10명이 함께 시작합니다.');
  // Compute all randomness before mutating so a failing injected source cannot partially deal.
  for (let i = roles.length - 1; i > 0; i--) {
    const j = avalonRandomBelow(i + 1, clock.die);
    [roles[i], roles[j]] = [roles[j]!, roles[i]!];
  }
  // Lobby departures may leave holes. Preserve clockwise order, but give a started
  // table dense seats so seat/count board angles cannot put two people together.
  // These are local copies: neither the stored roster nor its player objects change
  // until all role/leader random draws below have succeeded.
  const players = [...state.players]
    .sort((a, b) => a.seat - b.seat)
    .map((player, seat) => ({ ...player, seat }));
  const leaderIndex = avalonRandomBelow(players.length, clock.die);
  const assigned = Object.fromEntries(players.map((p, i) => [p.id, roles[i]!])) as Record<
    string,
    AvalonRole
  >;
  state.players = players;
  state.phase = 'playing';
  state.results = [];
  state.secrets = { roles: assigned, votes: {}, questCards: {}, ladyInsights: [] };
  state.leaderId = players[leaderIndex]!.id;
  state.questNumber = 1;
  state.rejections = 0;
  state.proposal = null;
  state.history = { proposals: [], quests: [], events: [] };
  state.winner = null;
  state.finishReason = null;
  state.revealedRoles = [];
  state.lady = state.config.ladyOfLake
    ? {
        holderId: players[(leaderIndex + players.length - 1) % players.length]!.id,
        usedByIds: [],
        investigations: [],
      }
    : null;
  phase(state, 'team', clock);
  emit(state, 'start', clock, state.leaderId);
}
function finish(
  state: AvalonInternalState,
  winner: AvalonAlignment,
  reason: AvalonFinishReason,
  clock: EngineClock,
): void {
  state.phase = 'finished';
  state.winner = winner;
  state.finishReason = reason;
  state.proposal = null;
  state.secrets.votes = {};
  state.secrets.questCards = {};
  state.revealedRoles = state.players.map((p) => ({
    playerId: p.id,
    role: state.secrets.roles[p.id]!,
    alignment: avalonAlignment(state.secrets.roles[p.id]!),
  }));
  state.results = state.players.map((p) => {
    const won = avalonAlignment(state.secrets.roles[p.id]!) === winner;
    return { playerId: p.id, rank: won ? 1 : 2, total: won ? 1 : 0, forfeited: false };
  });
  phase(state, 'finished', clock);
}
export function abort(
  state: AvalonInternalState,
  reason: AvalonAbortReason,
  clock: EngineClock,
): void {
  if (state.phase !== 'playing') return;
  state.phase = 'finished';
  state.winner = null;
  state.finishReason = reason;
  state.proposal = null;
  state.secrets.votes = {};
  state.secrets.questCards = {};
  state.revealedRoles = [];
  state.results = [];
  phase(state, 'finished', clock);
  emit(state, 'aborted', clock);
}
function requireStage(state: AvalonInternalState, wanted: AvalonStage): void {
  if (state.stage !== wanted)
    throw new GameError('INVALID_STAGE', '지금 단계에서는 이 행동을 할 수 없습니다.');
}
/** Version changes from other submissions/chat/presence do not invalidate a phase-scoped intent. */
export function applyIntent(
  state: AvalonInternalState,
  playerId: string,
  intent: AvalonGameIntent,
  clock: EngineClock,
): void {
  if (!state.players.some((p) => p.id === playerId))
    throw new GameError('NOT_MEMBER', '이 방의 참가자가 아닙니다.', 403);
  if (intent.phaseId !== state.phaseId || intent.proposalId !== (state.proposal?.id ?? null))
    throw new GameError('STALE_PHASE', '진행 단계가 바뀌었습니다. 현재 화면을 확인해 주세요.');
  if (intent.type === 'av_config') {
    requireStage(state, 'lobby');
    if (state.hostId !== playerId)
      throw new GameError('NOT_HOST', '방장만 규칙을 설정할 수 있습니다.', 403);
    if (!isAvalonConfig(intent.config))
      throw new GameError('INVALID_CONFIG', '선택 역할 구성이 올바르지 않습니다.', 400);
    state.config = {
      optionalRoles: AVALON_OPTIONAL_ROLES.filter((r) => intent.config.optionalRoles.includes(r)),
      ladyOfLake: intent.config.ladyOfLake,
    };
    for (const player of state.players) player.ready = false;
    // Configuration is a distinct lobby phase; stale start/config requests cannot silently override it.
    phase(state, 'lobby', clock);
    emit(state, 'config', clock, playerId);
    return;
  }
  if (state.phase !== 'playing')
    throw new GameError('GAME_NOT_PLAYING', '진행 중인 경기가 아닙니다.');
  switch (intent.type) {
    case 'av_team': {
      requireStage(state, 'team');
      if (state.leaderId !== playerId)
        throw new GameError('NOT_LEADER', '현재 원정대장만 원정대를 확정할 수 있습니다.', 403);
      if (
        !Array.isArray(intent.teamIds) ||
        intent.teamIds.length !== getAvalonQuestSize(state.players.length, state.questNumber) ||
        new Set(intent.teamIds).size !== intent.teamIds.length ||
        intent.teamIds.some((id) => !state.players.some((p) => p.id === id))
      )
        throw new GameError(
          'INVALID_TEAM',
          '이번 원정에 필요한 인원만 중복 없이 선택해 주세요.',
          400,
        );
      state.proposal = {
        id: clock.uuid(),
        questNumber: state.questNumber,
        leaderId: playerId,
        teamIds: orderedIds(state, intent.teamIds),
        submittedIds: [],
      };
      state.secrets.votes = {};
      state.secrets.questCards = {};
      phase(state, 'vote', clock);
      emit(state, 'team_proposed', clock, playerId);
      return;
    }
    case 'av_vote': {
      requireStage(state, 'vote');
      if (typeof intent.approve !== 'boolean')
        throw new GameError('INVALID_VOTE', '찬성 또는 반대를 선택해 주세요.', 400);
      if (Object.hasOwn(state.secrets.votes, playerId))
        throw new GameError('ALREADY_SUBMITTED', '이미 제출했습니다. 다른 참가자를 기다려 주세요.');
      state.secrets.votes = { ...state.secrets.votes, [playerId]: intent.approve };
      state.proposal!.submittedIds = orderedIds(state, Object.keys(state.secrets.votes));
      if (state.proposal!.submittedIds.length < state.players.length) {
        emit(state, 'vote_submitted', clock, playerId);
        return;
      }
      const proposal = state.proposal!;
      const votes = state.players.map((p) => ({
        playerId: p.id,
        approve: state.secrets.votes[p.id]!,
      }));
      const approved = votes.filter((v) => v.approve).length > state.players.length / 2;
      state.history.proposals.push({
        id: proposal.id,
        questNumber: state.questNumber,
        attempt: state.rejections + 1,
        leaderId: proposal.leaderId,
        teamIds: [...proposal.teamIds],
        votes,
        approved,
        at: clock.now,
      });
      state.secrets.votes = {};
      if (approved) {
        state.rejections = 0;
        proposal.submittedIds = [];
        phase(state, 'quest', clock);
      } else {
        state.rejections++;
        if (state.rejections === 5) finish(state, 'evil', 'five_rejections', clock);
        else {
          nextLeader(state);
          state.proposal = null;
          phase(state, 'team', clock);
        }
      }
      emit(state, 'vote_revealed', clock, null, null, proposal.questNumber, proposal.id);
      return;
    }
    case 'av_quest': {
      requireStage(state, 'quest');
      if (!state.proposal!.teamIds.includes(playerId))
        throw new GameError('NOT_ON_QUEST', '승인된 원정대원만 카드를 제출할 수 있습니다.', 403);
      if (intent.card !== 'success' && intent.card !== 'fail')
        throw new GameError('INVALID_CARD', '원정 카드를 선택해 주세요.', 400);
      if (Object.hasOwn(state.secrets.questCards, playerId))
        throw new GameError(
          'ALREADY_SUBMITTED',
          '이미 제출했습니다. 다른 원정대원을 기다려 주세요.',
        );
      if (intent.card === 'fail' && avalonAlignment(state.secrets.roles[playerId]!) === 'good')
        throw new GameError('CARD_NOT_ALLOWED', '선의 인물은 성공 카드만 제출할 수 있습니다.', 403);
      state.secrets.questCards = { ...state.secrets.questCards, [playerId]: intent.card };
      state.proposal!.submittedIds = orderedIds(state, Object.keys(state.secrets.questCards));
      if (state.proposal!.submittedIds.length < state.proposal!.teamIds.length) {
        emit(state, 'quest_submitted', clock, playerId);
        return;
      }
      const proposal = state.proposal!;
      const failCount = Object.values(state.secrets.questCards).filter(
        (card) => card === 'fail',
      ).length;
      const failed = failCount >= getAvalonFailThreshold(state.players.length, state.questNumber);
      state.history.quests.push({
        questNumber: state.questNumber,
        proposalId: proposal.id,
        teamIds: [...proposal.teamIds],
        successCount: proposal.teamIds.length - failCount,
        failCount,
        failed,
        at: clock.now,
      });
      // Only aggregates survive resolution, even in the persisted internal state.
      state.secrets.questCards = {};
      state.proposal = null;
      const failures = state.history.quests.filter((quest) => quest.failed).length;
      const successes = state.history.quests.length - failures;
      if (failures === 3) finish(state, 'evil', 'three_failed_quests', clock);
      else if (successes === 3) phase(state, 'assassination', clock);
      else {
        nextLeader(state);
        if (state.lady && state.questNumber >= 2 && state.questNumber <= 4)
          phase(state, 'lady', clock);
        else {
          state.questNumber++;
          phase(state, 'team', clock);
        }
      }
      emit(state, 'quest_resolved', clock, null, null, proposal.questNumber, proposal.id);
      return;
    }
    case 'av_lady': {
      requireStage(state, 'lady');
      if (state.lady?.holderId !== playerId)
        throw new GameError(
          'NOT_LADY_HOLDER',
          '호수의 여인 토큰을 가진 사람만 조사할 수 있습니다.',
          403,
        );
      if (
        intent.targetId === playerId ||
        !state.players.some((p) => p.id === intent.targetId) ||
        state.lady.usedByIds.includes(intent.targetId)
      )
        throw new GameError(
          'INVALID_TARGET',
          '자신과 이미 호수의 여인을 사용한 사람은 조사할 수 없습니다.',
          400,
        );
      const investigation = {
        actorId: playerId,
        targetId: intent.targetId,
        questNumber: state.questNumber,
      };
      state.lady.investigations.push(investigation);
      state.lady.usedByIds.push(playerId);
      state.lady.holderId = intent.targetId;
      state.secrets.ladyInsights.push({
        ...investigation,
        alignment: avalonAlignment(state.secrets.roles[intent.targetId]!),
      });
      state.questNumber++;
      phase(state, 'team', clock);
      emit(state, 'lady_used', clock, playerId, intent.targetId, investigation.questNumber);
      return;
    }
    case 'av_assassinate': {
      requireStage(state, 'assassination');
      if (state.secrets.roles[playerId] !== 'assassin')
        throw new GameError('NOT_ASSASSIN', '암살자만 최종 대상을 확정할 수 있습니다.', 403);
      // All OTHER seats are valid. Rejection must never be an oracle for an unknown evil role.
      if (intent.targetId === playerId || !state.players.some((p) => p.id === intent.targetId))
        throw new GameError('INVALID_TARGET', '자신을 제외한 참가자를 선택해 주세요.', 400);
      const hit = state.secrets.roles[intent.targetId] === 'merlin';
      finish(
        state,
        hit ? 'evil' : 'good',
        hit ? 'merlin_assassinated' : 'assassination_missed',
        clock,
      );
      emit(state, 'assassination', clock, playerId, intent.targetId);
      return;
    }
  }
}

function copyEvent(event: AvalonEvent): AvalonEvent {
  return {
    id: event.id,
    type: event.type,
    actorId: event.actorId,
    targetId: event.targetId,
    questNumber: event.questNumber,
    proposalId: event.proposalId,
    at: event.at,
  };
}
function copyInvestigation(value: AvalonLadyInvestigation): AvalonLadyInvestigation {
  return { actorId: value.actorId, targetId: value.targetId, questNumber: value.questNumber };
}
/** Positive allowlists at every level. Adding an internal field cannot leak it by spread. */
export function projectAvalonPublic(state: AvalonInternalState): AvalonPublicState {
  return {
    schemaVersion: state.schemaVersion,
    protocolVersion: state.protocolVersion,
    gameType: 'avalon',
    roomId: state.roomId,
    code: state.code,
    gameId: state.gameId,
    rulesVersion: state.rulesVersion,
    phase: state.phase,
    version: state.version,
    presenceVersion: state.presenceVersion,
    hostId: state.hostId,
    players: state.players.map((p) => ({
      id: p.id,
      kind: p.kind,
      nickname: p.nickname,
      seat: p.seat,
      ready: p.ready,
      connected: p.connected,
      forfeited: p.forfeited,
      graceDeadline: p.graceDeadline,
    })),
    turnPlayerId: state.turnPlayerId,
    turnId: state.turnId,
    inputAfter: state.inputAfter,
    results: state.results.map((r) => ({
      playerId: r.playerId,
      rank: r.rank,
      total: r.total,
      forfeited: r.forfeited,
    })),
    updatedAt: state.updatedAt,
    expiresAt: state.expiresAt,
    stage: state.stage,
    phaseId: state.phaseId,
    config: { optionalRoles: [...state.config.optionalRoles], ladyOfLake: state.config.ladyOfLake },
    leaderId: state.leaderId,
    questNumber: state.questNumber,
    rejections: state.rejections,
    proposal: state.proposal
      ? {
          id: state.proposal.id,
          questNumber: state.proposal.questNumber,
          leaderId: state.proposal.leaderId,
          teamIds: [...state.proposal.teamIds],
          submittedIds: [...state.proposal.submittedIds],
        }
      : null,
    history: {
      proposals: state.history.proposals.map((p) => ({
        id: p.id,
        questNumber: p.questNumber,
        attempt: p.attempt,
        leaderId: p.leaderId,
        teamIds: [...p.teamIds],
        votes: p.votes.map((v) => ({ playerId: v.playerId, approve: v.approve })),
        approved: p.approved,
        at: p.at,
      })),
      quests: state.history.quests.map((q) => ({
        questNumber: q.questNumber,
        proposalId: q.proposalId,
        teamIds: [...q.teamIds],
        successCount: q.successCount,
        failCount: q.failCount,
        failed: q.failed,
        at: q.at,
      })),
      events: state.history.events.map(copyEvent),
    },
    lady: state.lady
      ? {
          holderId: state.lady.holderId,
          usedByIds: [...state.lady.usedByIds],
          investigations: state.lady.investigations.map(copyInvestigation),
        }
      : null,
    winner: state.winner,
    finishReason: state.finishReason,
    revealedRoles: state.revealedRoles.map((r) => ({
      playerId: r.playerId,
      role: r.role,
      alignment: r.alignment,
    })),
    latestEvent: state.latestEvent ? copyEvent(state.latestEvent) : null,
    chat: state.chat.map((m) => ({ id: m.id, playerId: m.playerId, text: m.text, at: m.at })),
    signals: state.signals.map((s) => ({
      id: s.id,
      playerId: s.playerId,
      targetId: s.targetId,
      kind: s.kind,
      at: s.at,
    })),
  };
}
export function projectAvalon(state: AvalonInternalState, recipientId: string): AvalonRoomState {
  const publicState = projectAvalonPublic(state);
  const role = Object.hasOwn(state.secrets.roles, recipientId)
    ? state.secrets.roles[recipientId]!
    : null;
  if (!role || !state.players.some((p) => p.id === recipientId))
    return { ...publicState, privateInfo: null };
  const alignment = avalonAlignment(role);
  const knownEvilIds = state.players
    .filter((p) => {
      const other = state.secrets.roles[p.id]!;
      if (p.id === recipientId || avalonAlignment(other) !== 'evil') return false;
      return role === 'merlin'
        ? other !== 'mordred'
        : alignment === 'evil' && role !== 'oberon' && other !== 'oberon';
    })
    .map((p) => p.id);
  const merlinCandidateIds =
    role === 'percival'
      ? state.players
          .filter((p) => ['merlin', 'morgana'].includes(state.secrets.roles[p.id]!))
          .map((p) => p.id)
      : [];
  return {
    ...publicState,
    privateInfo: {
      playerId: recipientId,
      role,
      alignment,
      knownEvilIds,
      merlinCandidateIds,
      ladyInsights: state.secrets.ladyInsights
        .filter((insight) => insight.actorId === recipientId)
        .map((insight) => ({ ...copyInvestigation(insight), alignment: insight.alignment })),
      myVote:
        state.stage === 'vote' && Object.hasOwn(state.secrets.votes, recipientId)
          ? state.secrets.votes[recipientId]!
          : null,
      myQuestCard:
        state.stage === 'quest' && Object.hasOwn(state.secrets.questCards, recipientId)
          ? state.secrets.questCards[recipientId]!
          : null,
    },
  };
}

const PUBLIC_KEYS = [
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
  'stage',
  'phaseId',
  'config',
  'leaderId',
  'questNumber',
  'rejections',
  'proposal',
  'history',
  'lady',
  'winner',
  'finishReason',
  'revealedRoles',
  'latestEvent',
  'chat',
  'signals',
] as const;
const PLAYER_KEYS = [
  'id',
  'kind',
  'nickname',
  'seat',
  'ready',
  'connected',
  'forfeited',
  'graceDeadline',
];
const ABORT_REASONS: readonly AvalonFinishReason[] = [
  'disconnected',
  'player_left',
  'session_expired',
  'room_expired',
];
const NORMAL_REASONS: readonly AvalonFinishReason[] = [
  'three_failed_quests',
  'five_rejections',
  'merlin_assassinated',
  'assassination_missed',
];
const STAGES: readonly AvalonStage[] = [
  'lobby',
  'team',
  'vote',
  'quest',
  'lady',
  'assassination',
  'finished',
];
const EVENT_TYPES: readonly AvalonEvent['type'][] = [
  'config',
  'start',
  'team_proposed',
  'vote_submitted',
  'vote_revealed',
  'quest_submitted',
  'quest_resolved',
  'lady_used',
  'assassination',
  'aborted',
];
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
const alignmentValue = (value: unknown): value is AvalonAlignment =>
  value === 'good' || value === 'evil';
const roleValue = (value: unknown): value is AvalonRole =>
  typeof value === 'string' && Object.hasOwn(AVALON_ROLE_LABELS, value);
const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);
function memberIds(value: unknown, ids: readonly string[]): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= ids.length &&
    new Set(value).size === value.length &&
    value.every((id) => typeof id === 'string' && ids.includes(id))
  );
}
function validEvent(value: unknown, ids: readonly string[]): value is AvalonEvent {
  if (!(
    object(value) &&
    exactKeys(value, ['id', 'type', 'actorId', 'targetId', 'questNumber', 'proposalId', 'at']) &&
    identifier(value.id) &&
    EVENT_TYPES.includes(value.type as AvalonEvent['type']) &&
    (value.actorId === null ||
      ids.includes(value.actorId as string) ||
      (value.type === 'config' && identifier(value.actorId))) &&
    (value.targetId === null || ids.includes(value.targetId as string)) &&
    integer(value.questNumber, 1, 5) &&
    (value.proposalId === null || identifier(value.proposalId)) &&
    integer(value.at)
  ))
    return false;
  if (['quest_resolved', 'vote_revealed', 'aborted'].includes(value.type as string))
    return value.actorId === null && value.targetId === null;
  if (value.type === 'lady_used' || value.type === 'assassination')
    return value.actorId !== null && value.targetId !== null && value.actorId !== value.targetId;
  return value.actorId !== null && value.targetId === null;
}
function validInvestigation(
  value: unknown,
  ids: readonly string[],
  insight = false,
): value is AvalonLadyInsight {
  return (
    object(value) &&
    exactKeys(
      value,
      insight
        ? ['actorId', 'targetId', 'questNumber', 'alignment']
        : ['actorId', 'targetId', 'questNumber'],
    ) &&
    ids.includes(value.actorId as string) &&
    ids.includes(value.targetId as string) &&
    value.actorId !== value.targetId &&
    integer(value.questNumber, 2, 4) &&
    (!insight || alignmentValue(value.alignment))
  );
}
function validBase(s: Record<string, unknown>): boolean {
  if (
    s.schemaVersion !== 2 ||
    s.protocolVersion !== 3 ||
    s.gameType !== 'avalon' ||
    s.rulesVersion !== AVALON_RULES_VERSION ||
    !identifier(s.roomId) ||
    !identifier(s.gameId) ||
    !identifier(s.turnId) ||
    s.turnId !== s.phaseId ||
    typeof s.code !== 'string' ||
    !/^[A-HJ-NP-Z2-9]{8}$/.test(s.code) ||
    !['lobby', 'playing', 'finished'].includes(s.phase as string) ||
    !STAGES.includes(s.stage as AvalonStage) ||
    !integer(s.version) ||
    !integer(s.presenceVersion) ||
    !integer(s.inputAfter) ||
    !integer(s.updatedAt) ||
    !integer(s.expiresAt) ||
    !Array.isArray(s.players) ||
    s.players.length > 10 ||
    !Array.isArray(s.results) ||
    !isAvalonConfig(s.config) ||
    !integer(s.questNumber, 1, 5) ||
    !integer(s.rejections, 0, 5)
  )
    return false;
  const ids: string[] = [],
    seats: number[] = [];
  for (const p of s.players) {
    if (
      !object(p) ||
      !exactKeys(p, PLAYER_KEYS) ||
      !identifier(p.id) ||
      ids.includes(p.id) ||
      p.kind !== 'human' ||
      typeof p.nickname !== 'string' ||
      [...p.nickname].length < 1 ||
      [...p.nickname].length > 16 ||
      /[\p{Cc}\p{Cf}<>]/u.test(p.nickname) ||
      !integer(p.seat, 0, 9) ||
      seats.includes(p.seat) ||
      typeof p.ready !== 'boolean' ||
      typeof p.connected !== 'boolean' ||
      typeof p.forfeited !== 'boolean' ||
      p.forfeited ||
      !(p.graceDeadline === null || integer(p.graceDeadline))
    )
      return false;
    ids.push(p.id);
    seats.push(p.seat);
  }
  if (
    (ids.length === 0
      ? s.hostId !== ''
      : !ids.includes(s.hostId as string) &&
        !(s.hostId === '' && s.phase === 'finished' && s.players.every((p) => !p.connected))) ||
    !(s.turnPlayerId === null || ids.includes(s.turnPlayerId as string)) ||
    !(s.leaderId === null || ids.includes(s.leaderId as string))
  )
    return false;
  if (
    s.phase === 'lobby'
      ? s.stage !== 'lobby'
      : s.phase === 'playing'
        ? ['lobby', 'finished'].includes(s.stage as string)
        : s.stage !== 'finished'
  )
    return false;
  if (
    s.phase !== 'lobby' &&
    (getAvalonStartIssues(ids.length, s.config).length || s.leaderId === null)
  )
    return false;
  if (s.phase !== 'lobby' && seats.some((seat, i) => seat !== i)) return false;
  if (
    s.stage === 'team'
      ? s.turnPlayerId !== s.leaderId
      : s.stage !== 'lady' && s.turnPlayerId !== null
  )
    return false;
  return true;
}
function validPublicFields(s: Record<string, unknown>): boolean {
  if (!validBase(s)) return false;
  const state = s as unknown as AvalonPublicState;
  const ids = state.players.map((p) => p.id);
  if (
    !object(s.history) ||
    !exactKeys(s.history, ['proposals', 'quests', 'events']) ||
    !Array.isArray(s.history.proposals) ||
    s.history.proposals.length > 25 ||
    !Array.isArray(s.history.quests) ||
    s.history.quests.length > 5 ||
    !Array.isArray(s.history.events) ||
    s.history.events.length > 128 ||
    !s.history.events.every((e) => validEvent(e, ids)) ||
    !(s.latestEvent === null || validEvent(s.latestEvent, ids))
  )
    return false;
  const proposalIds = new Set<string>();
  for (const p of s.history.proposals) {
    if (
      !object(p) ||
      !exactKeys(p, [
        'id',
        'questNumber',
        'attempt',
        'leaderId',
        'teamIds',
        'votes',
        'approved',
        'at',
      ]) ||
      !identifier(p.id) ||
      proposalIds.has(p.id) ||
      !integer(p.questNumber, 1, 5) ||
      !integer(p.attempt, 1, 5) ||
      !ids.includes(p.leaderId as string) ||
      !memberIds(p.teamIds, ids) ||
      p.teamIds.length !== getAvalonQuestSize(ids.length, p.questNumber) ||
      !Array.isArray(p.votes) ||
      p.votes.length !== ids.length ||
      typeof p.approved !== 'boolean' ||
      !integer(p.at)
    )
      return false;
    const voters: string[] = [];
    for (const v of p.votes) {
      if (
        !object(v) ||
        !exactKeys(v, ['playerId', 'approve']) ||
        !ids.includes(v.playerId as string) ||
        voters.includes(v.playerId as string) ||
        typeof v.approve !== 'boolean'
      )
        return false;
      voters.push(v.playerId as string);
    }
    if (
      p.votes.filter((v: { approve: boolean }) => v.approve).length > ids.length / 2 !==
      p.approved
    )
      return false;
    proposalIds.add(p.id);
  }
  let expectedQuest = 1,
    expectedAttempt = 1;
  for (const p of state.history.proposals) {
    if (p.questNumber !== expectedQuest || p.attempt !== expectedAttempt) return false;
    if (p.approved) {
      expectedQuest++;
      expectedAttempt = 1;
    } else expectedAttempt++;
  }
  for (let i = 0; i < s.history.quests.length; i++) {
    const q = s.history.quests[i];
    if (
      !object(q) ||
      !exactKeys(q, [
        'questNumber',
        'proposalId',
        'teamIds',
        'successCount',
        'failCount',
        'failed',
        'at',
      ]) ||
      q.questNumber !== i + 1 ||
      !identifier(q.proposalId) ||
      !memberIds(q.teamIds, ids) ||
      q.teamIds.length !== getAvalonQuestSize(ids.length, i + 1) ||
      !integer(q.successCount, 0, 5) ||
      !integer(q.failCount, 0, 5) ||
      q.successCount + q.failCount !== q.teamIds.length ||
      typeof q.failed !== 'boolean' ||
      q.failCount >= getAvalonFailThreshold(ids.length, i + 1) !== q.failed ||
      !integer(q.at)
    )
      return false;
    const vote = state.history.proposals.find((p) => p.id === q.proposalId);
    if (
      !vote ||
      !vote.approved ||
      vote.questNumber !== q.questNumber ||
      !sameIds(vote.teamIds, q.teamIds)
    )
      return false;
  }
  if (s.proposal !== null) {
    const p = s.proposal;
    if (
      !object(p) ||
      !exactKeys(p, ['id', 'questNumber', 'leaderId', 'teamIds', 'submittedIds']) ||
      !identifier(p.id) ||
      p.questNumber !== s.questNumber ||
      p.leaderId !== s.leaderId ||
      !memberIds(p.teamIds, ids) ||
      p.teamIds.length !== getAvalonQuestSize(ids.length, s.questNumber as number) ||
      !memberIds(p.submittedIds, ids) ||
      !sameIds(p.submittedIds, orderedIds(state, p.submittedIds))
    )
      return false;
    if (s.stage === 'vote') {
      if (proposalIds.has(p.id) || p.submittedIds.length >= ids.length) return false;
    } else if (s.stage === 'quest') {
      const vote = state.history.proposals.at(-1);
      if (
        !vote?.approved ||
        vote.id !== p.id ||
        !sameIds(vote.teamIds, p.teamIds) ||
        !memberIds(p.submittedIds, p.teamIds) ||
        p.submittedIds.length >= p.teamIds.length
      )
        return false;
    } else return false;
  } else if (s.stage === 'vote' || s.stage === 'quest') return false;
  if (
    !Array.isArray(s.revealedRoles) ||
    !Array.isArray(s.chat) ||
    s.chat.length > 100 ||
    !Array.isArray(s.signals) ||
    s.signals.length > 30
  )
    return false;
  const chatIds = new Set<string>();
  for (const m of s.chat) {
    // A lobby member may leave; the public chat identity remains a valid historical ID.
    if (
      !object(m) ||
      !exactKeys(m, ['id', 'playerId', 'text', 'at']) ||
      !identifier(m.id) ||
      chatIds.has(m.id) ||
      !identifier(m.playerId) ||
      typeof m.text !== 'string' ||
      [...m.text.trim()].length < 1 ||
      [...m.text].length > 300 ||
      // Reject control characters while preserving newline/tab in public chat.
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000b-\u001f\u007f\p{Cf}]/u.test(m.text) ||
      !integer(m.at)
    )
      return false;
    chatIds.add(m.id);
  }
  const signalIds = new Set<string>();
  for (const signal of s.signals) {
    if (
      !object(signal) ||
      !exactKeys(signal, ['id', 'playerId', 'targetId', 'kind', 'at']) ||
      !identifier(signal.id) ||
      signalIds.has(signal.id) ||
      !identifier(signal.playerId) ||
      !identifier(signal.targetId) ||
      !['question', 'speak', 'trust', 'suspect', 'agree'].includes(signal.kind as string) ||
      !integer(signal.at)
    )
      return false;
    signalIds.add(signal.id);
  }
  if (s.lady !== null) {
    const lady = s.lady;
    if (
      !state.config.ladyOfLake ||
      s.phase === 'lobby' ||
      !object(lady) ||
      !exactKeys(lady, ['holderId', 'usedByIds', 'investigations']) ||
      !ids.includes(lady.holderId as string) ||
      !memberIds(lady.usedByIds, ids) ||
      lady.usedByIds.length > 3 ||
      lady.usedByIds.includes(lady.holderId as string) ||
      !Array.isArray(lady.investigations) ||
      lady.investigations.length !== lady.usedByIds.length
    )
      return false;
    for (let i = 0; i < lady.investigations.length; i++) {
      const investigation = lady.investigations[i];
      if (
        !validInvestigation(investigation, ids) ||
        investigation.questNumber !== i + 2 ||
        investigation.actorId !== lady.usedByIds[i] ||
        investigation.questNumber > state.history.quests.length ||
        (i > 0 && investigation.actorId !== lady.investigations[i - 1].targetId) ||
        lady.usedByIds.slice(0, i + 1).includes(investigation.targetId)
      )
        return false;
    }
    if (lady.investigations.length && lady.investigations.at(-1).targetId !== lady.holderId)
      return false;
  } else if (state.config.ladyOfLake && s.phase !== 'lobby') return false;
  if (
    state.stage === 'lady' &&
    (!state.lady ||
      state.turnPlayerId !== state.lady.holderId ||
      state.questNumber < 2 ||
      state.questNumber > 4)
  )
    return false;
  const resolved = state.history.quests.length;
  const approvedCount = state.history.proposals.filter((p) => p.approved).length;
  const voided =
    state.phase === 'finished' && ABORT_REASONS.includes(state.finishReason as AvalonFinishReason);
  if (
    voided
      ? approvedCount < resolved || approvedCount > resolved + 1
      : approvedCount !== resolved + Number(state.stage === 'quest')
  )
    return false;
  if (['team', 'vote'].includes(state.stage) && expectedQuest !== state.questNumber) return false;
  if (state.phase !== 'lobby') {
    const opening = state.history.events[0];
    if (
      opening?.type !== 'start' ||
      !opening.actorId ||
      state.history.events.filter((event) => event.type === 'start').length !== 1
    )
      return false;
    const initialLeaderIndex = ids.indexOf(opening.actorId);
    // Every rejection and every nonterminal completed quest advances the fixed-seat leader once.
    const rejected = state.history.proposals.filter((p) => !p.approved).length;
    const terminalRejection = state.finishReason === 'five_rejections' ? 1 : 0;
    const terminalQuest =
      state.stage === 'assassination' ||
      ['three_failed_quests', 'merlin_assassinated', 'assassination_missed'].includes(
        state.finishReason ?? '',
      )
        ? 1
        : 0;
    // A void after the assassination phase also retains the last quest's leader.
    const voidAfterSuccess =
      voided && state.history.quests.filter((q) => !q.failed).length === 3 ? 1 : 0;
    const rotations = rejected - terminalRejection + resolved - terminalQuest - voidAfterSuccess;
    if (state.leaderId !== ids[(initialLeaderIndex + rotations) % ids.length]) return false;
    if (state.lady) {
      const initialHolder = ids[(initialLeaderIndex + ids.length - 1) % ids.length];
      if (
        state.lady.investigations.length
          ? state.lady.investigations[0]!.actorId !== initialHolder
          : state.lady.holderId !== initialHolder
      )
        return false;
    }
  }
  const failures = state.history.quests.filter((q) => q.failed).length;
  const successes = resolved - failures;
  // No further quests may be recorded after either side has reached three.
  const beforeLast = state.history.quests.slice(0, -1);
  if (
    beforeLast.filter((q) => q.failed).length >= 3 ||
    beforeLast.filter((q) => !q.failed).length >= 3
  )
    return false;
  if (state.stage === 'lobby') {
    if (
      state.leaderId !== null ||
      state.questNumber !== 1 ||
      state.rejections !== 0 ||
      state.proposal !== null ||
      state.history.proposals.length ||
      resolved ||
      state.lady !== null
    )
      return false;
  } else if (['team', 'vote', 'quest'].includes(state.stage)) {
    if (
      state.questNumber !== resolved + 1 ||
      failures >= 3 ||
      successes >= 3 ||
      state.rejections >= 5
    )
      return false;
    if (
      (state.stage === 'quest' && state.rejections !== 0) ||
      (state.stage !== 'quest' && state.rejections !== expectedAttempt - 1)
    )
      return false;
  } else if (state.stage === 'lady') {
    if (
      state.questNumber !== resolved ||
      failures >= 3 ||
      successes >= 3 ||
      state.rejections !== 0 ||
      state.lady!.investigations.length !== state.questNumber - 2
    )
      return false;
  } else if (state.stage === 'assassination') {
    if (
      successes !== 3 ||
      failures >= 3 ||
      state.questNumber !== resolved ||
      state.rejections !== 0
    )
      return false;
  }
  if (state.phase !== 'finished') {
    if (
      state.winner !== null ||
      state.finishReason !== null ||
      state.revealedRoles.length ||
      state.results.length
    )
      return false;
  } else if (ABORT_REASONS.includes(state.finishReason as AvalonFinishReason)) {
    if (state.winner !== null || state.revealedRoles.length || state.results.length) return false;
  } else {
    if (
      !alignmentValue(state.winner) ||
      !NORMAL_REASONS.includes(state.finishReason as AvalonFinishReason) ||
      state.revealedRoles.length !== ids.length ||
      state.results.length !== ids.length
    )
      return false;
    if (state.finishReason === 'three_failed_quests' && (failures !== 3 || state.winner !== 'evil'))
      return false;
    if (
      state.finishReason === 'five_rejections' &&
      (state.rejections !== 5 || expectedAttempt !== 6 || state.winner !== 'evil')
    )
      return false;
    if (
      state.finishReason === 'merlin_assassinated' &&
      (successes !== 3 || state.winner !== 'evil')
    )
      return false;
    if (
      state.finishReason === 'assassination_missed' &&
      (successes !== 3 || state.winner !== 'good')
    )
      return false;
    const roles: AvalonRole[] = [];
    const revealedIds: string[] = [];
    for (const r of state.revealedRoles) {
      if (
        !object(r) ||
        !exactKeys(r, ['playerId', 'role', 'alignment']) ||
        !ids.includes(r.playerId as string) ||
        revealedIds.includes(r.playerId as string) ||
        !roleValue(r.role) ||
        r.alignment !== avalonAlignment(r.role)
      )
        return false;
      roles.push(r.role);
      revealedIds.push(r.playerId as string);
    }
    if ([...roles].sort().join(',') !== getAvalonRoles(ids.length, state.config).sort().join(','))
      return false;
    const resultIds: string[] = [];
    for (const r of state.results) {
      if (
        !object(r) ||
        !exactKeys(r, ['playerId', 'rank', 'total', 'forfeited']) ||
        !ids.includes(r.playerId as string) ||
        resultIds.includes(r.playerId as string) ||
        r.forfeited !== false
      )
        return false;
      const won =
        state.revealedRoles.find((reveal) => reveal.playerId === r.playerId)!.alignment ===
        state.winner;
      if (r.rank !== (won ? 1 : 2) || r.total !== (won ? 1 : 0)) return false;
      resultIds.push(r.playerId as string);
    }
  }
  return true;
}
function validSecrets(state: AvalonInternalState): boolean {
  const value: unknown = state.secrets;
  if (
    !object(value) ||
    !exactKeys(value, ['roles', 'votes', 'questCards', 'ladyInsights']) ||
    !object(value.roles) ||
    !object(value.votes) ||
    !object(value.questCards) ||
    !Array.isArray(value.ladyInsights)
  )
    return false;
  const ids = state.players.map((p) => p.id);
  if (state.stage === 'lobby')
    return (
      Object.keys(value.roles).length === 0 &&
      Object.keys(value.votes).length === 0 &&
      Object.keys(value.questCards).length === 0 &&
      value.ladyInsights.length === 0
    );
  if (
    !sameIds(Object.keys(value.roles).sort(), [...ids].sort()) ||
    !Object.values(value.roles).every(roleValue) ||
    Object.values(value.roles).sort().join(',') !==
      getAvalonRoles(ids.length, state.config).sort().join(',')
  )
    return false;
  const votes = Object.keys(value.votes),
    cards = Object.keys(value.questCards);
  if (state.stage === 'vote') {
    if (
      !sameIds(orderedIds(state, votes), state.proposal!.submittedIds) ||
      votes.length !== state.proposal!.submittedIds.length ||
      !Object.values(value.votes).every((v) => typeof v === 'boolean')
    )
      return false;
  } else if (votes.length) return false;
  if (state.stage === 'quest') {
    if (
      !sameIds(orderedIds(state, cards), state.proposal!.submittedIds) ||
      cards.length !== state.proposal!.submittedIds.length
    )
      return false;
    for (const [id, card] of Object.entries(value.questCards))
      if (
        (card !== 'success' && card !== 'fail') ||
        (card === 'fail' && avalonAlignment(state.secrets.roles[id]!) === 'good')
      )
        return false;
  } else if (cards.length) return false;
  if (value.ladyInsights.length !== (state.lady?.investigations.length ?? 0)) return false;
  for (let i = 0; i < value.ladyInsights.length; i++) {
    const insight = value.ladyInsights[i];
    if (
      !validInvestigation(insight, ids, true) ||
      JSON.stringify(copyInvestigation(insight)) !==
        JSON.stringify(state.lady!.investigations[i]) ||
      insight.alignment !== avalonAlignment(state.secrets.roles[insight.targetId]!)
    )
      return false;
  }
  if (state.revealedRoles.some((r) => state.secrets.roles[r.playerId] !== r.role)) return false;
  if (
    state.finishReason === 'merlin_assassinated' ||
    state.finishReason === 'assassination_missed'
  ) {
    const event = state.latestEvent;
    if (
      event?.type !== 'assassination' ||
      !event.actorId ||
      state.secrets.roles[event.actorId] !== 'assassin' ||
      !event.targetId ||
      event.actorId === event.targetId ||
      (state.secrets.roles[event.targetId] === 'merlin') !==
        (state.finishReason === 'merlin_assassinated')
    )
      return false;
  }
  return true;
}
function validPrivateInfo(state: AvalonRoomState): boolean {
  const value: unknown = state.privateInfo;
  if (value === null) return true;
  const ids = state.players.map((p) => p.id);
  if (
    state.stage === 'lobby' ||
    !object(value) ||
    !exactKeys(value, [
      'playerId',
      'role',
      'alignment',
      'knownEvilIds',
      'merlinCandidateIds',
      'ladyInsights',
      'myVote',
      'myQuestCard',
    ]) ||
    !ids.includes(value.playerId as string) ||
    !roleValue(value.role) ||
    value.alignment !== avalonAlignment(value.role) ||
    !memberIds(value.knownEvilIds, ids) ||
    value.knownEvilIds.includes(value.playerId as string) ||
    !memberIds(value.merlinCandidateIds, ids) ||
    value.merlinCandidateIds.includes(value.playerId as string) ||
    !Array.isArray(value.ladyInsights) ||
    value.ladyInsights.length > 1
  )
    return false;
  if (!getAvalonRoles(ids.length, state.config).includes(value.role)) return false;
  if (value.role !== 'percival' && value.merlinCandidateIds.length) return false;
  if (
    value.role === 'percival' &&
    value.merlinCandidateIds.length !== (state.config.optionalRoles.includes('morgana') ? 2 : 1)
  )
    return false;
  if (['servant', 'percival', 'oberon'].includes(value.role) && value.knownEvilIds.length)
    return false;
  if (
    value.role === 'merlin' &&
    value.knownEvilIds.length !==
      AVALON_PLAYER_COUNTS[ids.length]!.evil -
        Number(state.config.optionalRoles.includes('mordred'))
  )
    return false;
  if (
    value.alignment === 'evil' &&
    value.role !== 'oberon' &&
    value.knownEvilIds.length !==
      AVALON_PLAYER_COUNTS[ids.length]!.evil -
        1 -
        Number(state.config.optionalRoles.includes('oberon'))
  )
    return false;
  for (const insight of value.ladyInsights) {
    if (
      !validInvestigation(insight, ids, true) ||
      insight.actorId !== value.playerId ||
      !state.lady?.investigations.some(
        (i) =>
          i.actorId === insight.actorId &&
          i.targetId === insight.targetId &&
          i.questNumber === insight.questNumber,
      )
    )
      return false;
  }
  const submitted = state.proposal?.submittedIds.includes(value.playerId as string) ?? false;
  if (
    state.stage === 'vote' && submitted ? typeof value.myVote !== 'boolean' : value.myVote !== null
  )
    return false;
  if (state.stage === 'quest' && submitted) {
    if (value.myQuestCard !== 'success' && value.myQuestCard !== 'fail') return false;
    if (value.myQuestCard === 'fail' && value.alignment === 'good') return false;
  } else if (value.myQuestCard !== null) return false;
  if (
    state.revealedRoles.length &&
    state.revealedRoles.find((r) => r.playerId === value.playerId)?.role !== value.role
  )
    return false;
  return true;
}
/** Fail closed on unknown fields and inconsistent persisted state; never include data in errors. */
export function isAvalonInternalState(value: unknown): value is AvalonInternalState {
  try {
    return (
      object(value) &&
      exactKeys(value, [...PUBLIC_KEYS, 'secrets']) &&
      validPublicFields(value) &&
      validSecrets(value as unknown as AvalonInternalState)
    );
  } catch {
    return false;
  }
}
export function isAvalonRoomState(value: unknown): value is AvalonRoomState {
  try {
    return (
      object(value) &&
      exactKeys(value, [...PUBLIC_KEYS, 'privateInfo']) &&
      validPublicFields(value) &&
      validPrivateInfo(value as unknown as AvalonRoomState)
    );
  } catch {
    return false;
  }
}
