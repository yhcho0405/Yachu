import { describe, expect, it } from 'vitest';
import {
  AVALON_OPTIONAL_ROLES,
  AVALON_PLAYER_COUNTS,
  abort,
  applyIntent,
  avalonAlignment,
  avalonRandomBelow,
  createState,
  getAvalonActions,
  getAvalonConfigWarnings,
  getAvalonFailThreshold,
  getAvalonQuestSize,
  getAvalonRoles,
  getAvalonStartIssues,
  isAvalonConfig,
  isAvalonInternalState,
  isAvalonRoomState,
  projectAvalon,
  projectAvalonPublic,
  reset,
  start,
  type AvalonConfig,
  type AvalonGameIntent,
  type AvalonInternalState,
  type AvalonQuestCard,
  type AvalonRole,
} from '../src/shared/avalon';
import type { EngineClock } from '../src/server/errors';

let sequence = 0;
const uuid = () => `avalon-id-${++sequence}`;
const clock = (die: () => number = () => 1): EngineClock => ({ now: 1_000_000, uuid, die });
function fixture(
  count = 5,
  config: AvalonConfig = { optionalRoles: [], ladyOfLake: false },
  started = true,
): AvalonInternalState {
  const state = createState({
    schemaVersion: 2,
    protocolVersion: 3,
    gameType: 'avalon',
    roomId: uuid(),
    code: 'ABCDEFGH',
    gameId: uuid(),
    rulesVersion: '',
    phase: 'lobby',
    version: 0,
    presenceVersion: 0,
    hostId: 'p0',
    players: Array.from({ length: count }, (_, seat) => ({
      id: `p${seat}`,
      kind: 'human',
      nickname: '같은이름',
      seat,
      ready: true,
      connected: true,
      forfeited: false,
      graceDeadline: null,
    })),
    turnPlayerId: null,
    turnId: uuid(),
    inputAfter: 0,
    results: [],
    updatedAt: 1_000_000,
    expiresAt: 2_000_000,
  });
  state.config = structuredClone(config);
  if (started) start(state, clock());
  return state;
}
type Action = AvalonGameIntent extends infer I
  ? I extends AvalonGameIntent
    ? Omit<I, 'phaseId' | 'proposalId'>
    : never
  : never;
function command(state: AvalonInternalState, action: Action): AvalonGameIntent {
  return {
    ...action,
    phaseId: state.phaseId,
    proposalId: state.proposal?.id ?? null,
  } as AvalonGameIntent;
}
function act(state: AvalonInternalState, id: string, action: Action): void {
  applyIntent(state, id, command(state, action), clock());
}
function scope(state: AvalonInternalState) {
  return { phaseId: state.phaseId, proposalId: state.proposal?.id ?? null };
}
function team(state: AvalonInternalState, ids?: string[]): string[] {
  const teamIds =
    ids ??
    state.players
      .slice(0, getAvalonQuestSize(state.players.length, state.questNumber))
      .map((p) => p.id);
  act(state, state.leaderId!, { type: 'av_team', teamIds });
  return teamIds;
}
function approve(state: AvalonInternalState, approve = true): void {
  const batch = scope(state);
  for (const p of state.players)
    applyIntent(state, p.id, { type: 'av_vote', approve, ...batch }, clock());
}
function quest(state: AvalonInternalState, failCount = 0): void {
  const evil = state.players
    .filter((p) => avalonAlignment(state.secrets.roles[p.id]!) === 'evil')
    .map((p) => p.id);
  const size = getAvalonQuestSize(state.players.length, state.questNumber);
  const ids = [
    ...evil.slice(0, failCount),
    ...state.players.map((p) => p.id).filter((id) => !evil.slice(0, failCount).includes(id)),
  ].slice(0, size);
  team(state, ids);
  approve(state);
  const batch = scope(state);
  for (const [index, id] of ids.entries())
    applyIntent(
      state,
      id,
      { type: 'av_quest', card: index < failCount ? 'fail' : 'success', ...batch },
      clock(),
    );
}
function check(state: AvalonInternalState): void {
  expect(isAvalonInternalState(state), `${state.stage}: internal`).toBe(true);
  for (const p of state.players)
    expect(isAvalonRoomState(projectAvalon(state, p.id)), `${state.stage}: ${p.id}`).toBe(true);
}
/** Secret assignment overrides only exist in these pure local tests. */
function assign(state: AvalonInternalState, roles: AvalonRole[]): void {
  state.secrets.roles = Object.fromEntries(
    state.players.map((p, i) => [p.id, roles[i]!]),
  ) as Record<string, AvalonRole>;
}

describe('Avalon original setup and random assignment', () => {
  it.each([5, 6, 7, 8, 9, 10])(
    'matches every quest size and faction count for %i players',
    (count) => {
      const rows = {
        5: [2, 3, 2, 3, 3],
        6: [2, 3, 4, 3, 4],
        7: [2, 3, 3, 4, 4],
        8: [3, 4, 4, 5, 5],
        9: [3, 4, 4, 5, 5],
        10: [3, 4, 4, 5, 5],
      };
      expect(Array.from({ length: 5 }, (_, i) => getAvalonQuestSize(count, i + 1))).toEqual(
        rows[count as keyof typeof rows],
      );
      const state = fixture(count);
      const roles = Object.values(state.secrets.roles);
      expect(roles.filter((r) => avalonAlignment(r) === 'evil')).toHaveLength(
        AVALON_PLAYER_COUNTS[count]!.evil,
      );
      expect(roles.filter((r) => r === 'merlin')).toHaveLength(1);
      expect(roles.filter((r) => r === 'assassin')).toHaveLength(1);
      check(state);
    },
  );
  it('checks all optional-role subsets for every supported player count', () => {
    for (let count = 5; count <= 10; count++)
      for (let mask = 0; mask < 16; mask++) {
        const optionalRoles = AVALON_OPTIONAL_ROLES.filter((_, i) => mask & (1 << i));
        const config = { optionalRoles, ladyOfLake: !!(mask & 1) };
        const tooManyEvil =
          1 + optionalRoles.filter((r) => r !== 'percival').length >
          AVALON_PLAYER_COUNTS[count]!.evil;
        const missingCounter =
          count === 5 &&
          optionalRoles.includes('percival') &&
          !optionalRoles.includes('morgana') &&
          !optionalRoles.includes('mordred');
        const issues = getAvalonStartIssues(count, config);
        expect(issues.length > 0).toBe(tooManyEvil || missingCounter);
        if (issues.length) expect(() => fixture(count, config)).toThrow();
        else {
          const state = fixture(count, config);
          expect(getAvalonRoles(count, config)).toHaveLength(count);
          check(state);
        }
      }
    expect(isAvalonConfig({ optionalRoles: ['morgana', 'morgana'], ladyOfLake: false })).toBe(
      false,
    );
    expect(isAvalonConfig({ optionalRoles: ['lancelot'], ladyOfLake: false })).toBe(false);
    expect(isAvalonConfig({ optionalRoles: [], ladyOfLake: false, roles: {} })).toBe(false);
    expect(getAvalonStartIssues(4, { optionalRoles: [], ladyOfLake: false })).not.toEqual([]);
    expect(getAvalonStartIssues(11, { optionalRoles: [], ladyOfLake: false })).not.toEqual([]);
    expect(getAvalonConfigWarnings(5, { optionalRoles: [], ladyOfLake: true })).toHaveLength(1);
    expect(getAvalonStartIssues(5, { optionalRoles: [], ladyOfLake: true })).toEqual([]);
  });
  it('rejection sampling has equal accepted outcome counts for all bounds', () => {
    for (let bound = 1; bound <= 10; bound++) {
      const count = Array<number>(bound).fill(0);
      const limit = Math.floor(36 / bound) * bound;
      for (let value = 0; value < limit; value++) {
        const draws = [Math.floor(value / 6) + 1, (value % 6) + 1];
        count[avalonRandomBelow(bound, () => draws.shift()!)]!++;
      }
      expect(new Set(count).size).toBe(1);
      expect(count.reduce((a, b) => a + b, 0)).toBe(limit);
    }
    const rejected = [6, 6, 1, 4];
    expect(avalonRandomBelow(10, () => rejected.shift()!)).toBe(3);
    expect(rejected).toEqual([]);
  });
  it('fails without partial role assignment when the supplied random source fails', () => {
    const state = fixture(10, undefined, false),
      before = structuredClone(state);
    expect(() =>
      start(
        state,
        clock(() => 6),
      ),
    ).toThrow('경기를 준비할 수 없습니다.');
    expect(state).toEqual(before);
    expect(() =>
      start(
        state,
        clock(() => 0),
      ),
    ).toThrow();
    expect(state).toEqual(before);
  });
  it('starts from an unbiased selected leader and keeps clockwise seat order', () => {
    const state = fixture(5, { optionalRoles: [], ladyOfLake: true }, false);
    // Four shuffle pairs followed by leader index three.
    const draws = [...Array<number>(8).fill(1), 1, 4];
    start(
      state,
      clock(() => draws.shift()!),
    );
    expect(state.leaderId).toBe('p3');
    expect(state.lady!.holderId).toBe('p2');
    team(state);
    approve(state, false);
    expect(state.leaderId).toBe('p4');
    team(state);
    approve(state, false);
    expect(state.leaderId).toBe('p0');
    check(state);
  });
  it('keeps lobby config public, clears readiness, and rejects edits after start', () => {
    const state = fixture(5, undefined, false);
    const beforePhase = state.phaseId;
    act(state, 'p0', {
      type: 'av_config',
      config: { optionalRoles: ['morgana', 'percival'], ladyOfLake: true },
    });
    expect(state.players.every((p) => !p.ready)).toBe(true);
    expect(state.phaseId).not.toBe(beforePhase);
    expect(state.turnId).toBe(state.phaseId);
    expect(projectAvalon(state, 'p1').privateInfo).toBeNull();
    check(state);
    expect(() =>
      act(state, 'p1', { type: 'av_config', config: { optionalRoles: [], ladyOfLake: false } }),
    ).toThrow();
    start(state, clock());
    expect(() =>
      act(state, 'p0', { type: 'av_config', config: { optionalRoles: [], ladyOfLake: false } }),
    ).toThrow();
    check(state);
  });
  it('retains valid public lobby records when the configuring host leaves before start', () => {
    const state = fixture(6, undefined, false);
    act(state, 'p0', { type: 'av_config', config: { optionalRoles: [], ladyOfLake: true } });
    state.players = state.players.filter((p) => p.id !== 'p0');
    state.hostId = 'p1';
    check(state);
    start(state, clock());
    expect(state.players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4]);
    expect(state.leaderId).toBe('p1');
    expect(state.lady!.holderId).toBe('p5');
    check(state);
  });
  it('compacts sparse lobby seats once while keeping role, leader, Lady and reconnect identities', () => {
    const state = fixture(6, { optionalRoles: ['percival', 'morgana'], ladyOfLake: true }, false);
    // Seat three departed; a reused lobby seat can also be last in the join-order array.
    const byId = new Map(state.players.map((player) => [player.id, player]));
    state.players = ['p5', 'p2', 'p0', 'p4', 'p1'].map((id) => byId.get(id)!);
    check(state);
    const originalObjects = [...state.players];
    const draws = [...Array<number>(8).fill(1), 1, 4];
    start(
      state,
      clock(() => draws.shift()!),
    );
    const seatMap = [
      { id: 'p0', seat: 0 },
      { id: 'p1', seat: 1 },
      { id: 'p2', seat: 2 },
      { id: 'p4', seat: 3 },
      { id: 'p5', seat: 4 },
    ];
    const seats = (room: AvalonInternalState) => room.players.map(({ id, seat }) => ({ id, seat }));
    expect(seats(state)).toEqual(seatMap);
    expect(originalObjects.map((player) => player.seat)).toEqual([5, 2, 0, 4, 1]);
    expect(state.secrets.roles).toEqual({
      p0: 'assassin',
      p1: 'percival',
      p2: 'morgana',
      p4: 'servant',
      p5: 'merlin',
    });
    const roles = structuredClone(state.secrets.roles);
    expect(state.leaderId).toBe('p4');
    expect(state.lady!.holderId).toBe('p2');
    check(state);
    team(state);
    approve(state, false);
    expect(state.leaderId).toBe('p5');
    team(state);
    approve(state, false);
    expect(state.leaderId).toBe('p0');
    quest(state);
    expect(state.leaderId).toBe('p1');
    quest(state, 1);
    expect(state.leaderId).toBe('p2');
    expect(state.stage).toBe('lady');
    act(state, 'p2', { type: 'av_lady', targetId: 'p4' });
    expect(state.lady!.holderId).toBe('p4');
    expect(state.lady!.usedByIds).toEqual(['p2']);
    expect(seats(state)).toEqual(seatMap);
    expect(state.secrets.roles).toEqual(roles);
    check(state);
    state.players.find((player) => player.id === 'p4')!.connected = false;
    state.players.find((player) => player.id === 'p4')!.graceDeadline = clock().now + 120_000;
    const restored: AvalonInternalState = JSON.parse(JSON.stringify(state));
    check(restored);
    restored.players.find((player) => player.id === 'p4')!.connected = true;
    restored.players.find((player) => player.id === 'p4')!.graceDeadline = null;
    expect(seats(restored)).toEqual(seatMap);
    expect(restored.secrets.roles).toEqual(roles);
    for (const player of restored.players)
      expect(
        projectAvalon(restored, player.id).players.map(({ id, seat }) => ({ id, seat })),
      ).toEqual(seatMap);
    expect(restored.leaderId).toBe('p2');
    expect(restored.lady!.holderId).toBe('p4');
    check(restored);
  });
  it('does not compact or mutate sparse seats when configuration or the last random selection fails', () => {
    const state = fixture(6, undefined, false);
    state.players = state.players.filter((player) => player.id !== 'p3');
    const before = structuredClone(state);
    let drawIndex = 0;
    // Role shuffling completes; only the later five-way leader draw fails.
    expect(() =>
      start(
        state,
        clock(() => (drawIndex++ < 8 ? 1 : 6)),
      ),
    ).toThrow('경기를 준비할 수 없습니다.');
    expect(state).toEqual(before);
    state.config.optionalRoles = ['morgana', 'mordred'];
    const invalid = structuredClone(state);
    expect(() =>
      start(
        state,
        clock(() => {
          throw new Error('Configuration must be checked first');
        }),
      ),
    ).toThrow('악의 특수 역할');
    expect(state).toEqual(invalid);
  });
});

describe('Avalon proposals, simultaneous submissions and quest rules', () => {
  it('rejects duplicate/nonmember/wrong-sized teams and nonleaders without mutation', () => {
    const state = fixture();
    for (const [id, teamIds] of [
      ['p1', ['p0', 'p1']],
      ['p0', ['p0']],
      ['p0', ['p0', 'p0']],
      ['p0', ['p0', 'outsider']],
    ] as [string, string[]][]) {
      const before = structuredClone(state);
      expect(() => act(state, id, { type: 'av_team', teamIds })).toThrow();
      expect(state).toEqual(before);
    }
  });
  it('preserves one phase across submissions regardless of version/presence/chat', () => {
    const state = fixture(6);
    team(state);
    const batch = scope(state);
    for (const [index, p] of state.players.entries()) {
      state.version += 9;
      state.presenceVersion++;
      state.chat.push({ id: uuid(), playerId: p.id, text: '토론 중입니다.', at: clock().now });
      applyIntent(state, p.id, { type: 'av_vote', approve: index < 3, ...batch }, clock());
      if (index < 5) {
        expect(scope(state)).toEqual(batch);
        expect(state.history.proposals).toHaveLength(0);
      }
    }
    expect(state.history.proposals).toHaveLength(1);
    expect(state.history.proposals[0]!.approved).toBe(false);
    expect(state.stage).toBe('team');
    expect(state.rejections).toBe(1);
    expect(state.leaderId).toBe('p1');
    expect(state.history.proposals[0]!.votes.filter((v) => v.approve)).toHaveLength(3);
    check(state);
    const before = structuredClone(state);
    expect(() =>
      applyIntent(state, 'p0', { type: 'av_vote', approve: true, ...batch }, clock()),
    ).toThrow('진행 단계가 바뀌었습니다.');
    expect(state).toEqual(before);
  });
  it('locks a submitted vote and never discloses a partial tally', () => {
    const state = fixture();
    team(state);
    act(state, 'p0', { type: 'av_vote', approve: false });
    const samePublic = projectAvalonPublic(state);
    expect(samePublic.proposal!.submittedIds).toEqual(['p0']);
    expect(samePublic.history.proposals).toEqual([]);
    expect(projectAvalon(state, 'p0').privateInfo!.myVote).toBe(false);
    expect(projectAvalon(state, 'p1').privateInfo!.myVote).toBeNull();
    const before = structuredClone(state);
    expect(() => act(state, 'p0', { type: 'av_vote', approve: true })).toThrow(
      '이미 제출했습니다.',
    );
    expect(state).toEqual(before);
    check(state);
  });
  it('ends on the fifth consecutive rejection and clears the counter after approval', () => {
    const state = fixture();
    for (let i = 1; i <= 4; i++) {
      team(state);
      approve(state, false);
      expect(state.rejections).toBe(i);
      check(state);
    }
    team(state);
    approve(state, false);
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('evil');
    expect(state.finishReason).toBe('five_rejections');
    check(state);
    const resetCounter = fixture();
    team(resetCounter);
    approve(resetCounter, false);
    expect(resetCounter.rejections).toBe(1);
    team(resetCounter);
    approve(resetCounter);
    expect(resetCounter.rejections).toBe(0);
    check(resetCounter);
  });
  it('rejects good failure cards and nonmember submissions without exposing other cards', () => {
    const state = fixture();
    assign(state, ['merlin', 'servant', 'servant', 'assassin', 'minion']);
    team(state, ['p0', 'p3']);
    approve(state);
    for (const [id, card] of [
      ['p0', 'fail'],
      ['p1', 'success'],
    ] as [string, AvalonQuestCard][]) {
      const before = structuredClone(state);
      expect(() => act(state, id, { type: 'av_quest', card })).toThrow();
      expect(state).toEqual(before);
    }
    act(state, 'p3', { type: 'av_quest', card: 'fail' });
    expect(projectAvalon(state, 'p0').privateInfo!.myQuestCard).toBeNull();
    expect(projectAvalon(state, 'p3').privateInfo!.myQuestCard).toBe('fail');
    expect(projectAvalonPublic(state).history.quests).toEqual([]);
    check(state);
    act(state, 'p0', { type: 'av_quest', card: 'success' });
    expect(state.history.quests[0]).toMatchObject({ successCount: 1, failCount: 1, failed: true });
    expect(state.secrets.questCards).toEqual({});
    expect(projectAvalon(state, 'p3').privateInfo!.myQuestCard).toBeNull();
    check(state);
  });
  it.each([5, 6, 7, 8, 9, 10])(
    'applies only the fourth-quest two-fail exception for %i players',
    (count) => {
      for (let number = 1; number <= 5; number++)
        expect(getAvalonFailThreshold(count, number)).toBe(count >= 7 && number === 4 ? 2 : 1);
      const state = fixture(count);
      quest(state, 0);
      quest(state, 1);
      quest(state, 0);
      expect(state.stage).toBe('team');
      expect(state.questNumber).toBe(4);
      quest(state, 1);
      expect(state.history.quests[3]!.failed).toBe(count < 7);
      check(state);
      const twoFails = fixture(count);
      quest(twoFails, 0);
      quest(twoFails, 1);
      quest(twoFails, 0);
      quest(twoFails, 2);
      expect(twoFails.history.quests[3]!.failed).toBe(true);
      check(twoFails);
    },
  );
  it('ends three failures immediately and does not open an assassination stage', () => {
    const state = fixture();
    quest(state, 1);
    quest(state, 1);
    quest(state, 1);
    expect(state.stage).toBe('finished');
    expect(state.finishReason).toBe('three_failed_quests');
    expect(state.winner).toBe('evil');
    check(state);
  });
  it.each([true, false])(
    'waits for the assassin after three successes and resolves hit=%s',
    (hit) => {
      const state = fixture();
      quest(state);
      quest(state);
      quest(state);
      expect(state.phase).toBe('playing');
      expect(state.stage).toBe('assassination');
      expect(state.winner).toBeNull();
      expect(state.results).toEqual([]);
      expect(state.revealedRoles).toEqual([]);
      expect(state.turnPlayerId).toBeNull();
      check(state);
      const assassin = state.players.find((p) => state.secrets.roles[p.id] === 'assassin')!.id;
      const target = state.players.find((p) =>
        hit ? state.secrets.roles[p.id] === 'merlin' : state.secrets.roles[p.id] === 'minion',
      )!.id;
      const innocent = state.players.find((p) => p.id !== assassin)!.id;
      expect(
        getAvalonActions(projectAvalon(state, assassin), assassin).assassinationTargetIds,
      ).toEqual(state.players.filter((p) => p.id !== assassin).map((p) => p.id));
      expect(getAvalonActions(projectAvalon(state, innocent), innocent).canAssassinate).toBe(false);
      expect(() => act(state, innocent, { type: 'av_assassinate', targetId: assassin })).toThrow();
      expect(() => act(state, assassin, { type: 'av_assassinate', targetId: assassin })).toThrow();
      // Even another evil seat is accepted and resolves a miss, never an alignment oracle.
      act(state, assassin, { type: 'av_assassinate', targetId: target });
      expect(state.winner).toBe(hit ? 'evil' : 'good');
      expect(state.revealedRoles).toHaveLength(5);
      check(state);
    },
  );
});

describe('Avalon information boundaries and Lady of the Lake', () => {
  it('provides exactly the original information for every role, without detailed ally roles', () => {
    const state = fixture(10, { optionalRoles: [...AVALON_OPTIONAL_ROLES], ladyOfLake: false });
    assign(state, [
      'merlin',
      'percival',
      'assassin',
      'morgana',
      'mordred',
      'oberon',
      'servant',
      'servant',
      'servant',
      'servant',
    ]);
    expect(projectAvalon(state, 'p0').privateInfo).toMatchObject({
      knownEvilIds: ['p2', 'p3', 'p5'],
      merlinCandidateIds: [],
    });
    expect(projectAvalon(state, 'p1').privateInfo).toMatchObject({
      knownEvilIds: [],
      merlinCandidateIds: ['p0', 'p3'],
    });
    expect(projectAvalon(state, 'p2').privateInfo).toMatchObject({
      knownEvilIds: ['p3', 'p4'],
      merlinCandidateIds: [],
    });
    expect(projectAvalon(state, 'p4').privateInfo).toMatchObject({ knownEvilIds: ['p2', 'p3'] });
    for (const id of ['p5', 'p6'])
      expect(projectAvalon(state, id).privateInfo).toMatchObject({
        knownEvilIds: [],
        merlinCandidateIds: [],
      });
    expect(projectAvalon(state, 'outsider').privateInfo).toBeNull();
    check(state);
  });
  it('is observationally identical when hidden assignments change but allowed knowledge does not', () => {
    const a = fixture(10, { optionalRoles: [...AVALON_OPTIONAL_ROLES], ladyOfLake: false });
    assign(a, [
      'merlin',
      'percival',
      'assassin',
      'morgana',
      'mordred',
      'oberon',
      'servant',
      'servant',
      'servant',
      'servant',
    ]);
    const b = structuredClone(a);
    [b.secrets.roles.p0, b.secrets.roles.p3] = [b.secrets.roles.p3!, b.secrets.roles.p0!];
    expect(projectAvalon(a, 'p1')).toEqual(projectAvalon(b, 'p1')); // Merlin/Morgana are indistinguishable to Percival.
    expect(projectAvalon(a, 'p6')).toEqual(projectAvalon(b, 'p6')); // A servant cannot see any assignment change.
    const c = structuredClone(a);
    [c.secrets.roles.p4, c.secrets.roles.p7] = [c.secrets.roles.p7!, c.secrets.roles.p4!];
    expect(projectAvalon(a, 'p0')).toEqual(projectAvalon(c, 'p0')); // Mordred/servant are invisible to Merlin.
    const d = structuredClone(a);
    [d.secrets.roles.p5, d.secrets.roles.p8] = [d.secrets.roles.p8!, d.secrets.roles.p5!];
    expect(projectAvalon(a, 'p2')).toEqual(projectAvalon(d, 'p2')); // Oberon/servant are invisible to ordinary evil.
    const e = structuredClone(a);
    [e.secrets.roles.p3, e.secrets.roles.p4] = [e.secrets.roles.p4!, e.secrets.roles.p3!];
    expect(projectAvalon(a, 'p2')).toEqual(projectAvalon(e, 'p2')); // An ally gets alignment, not its special role.
  });
  it('does not leak unresolved choices or link resolved cards to their authors', () => {
    const state = fixture();
    assign(state, ['merlin', 'servant', 'servant', 'assassin', 'minion']);
    team(state);
    act(state, 'p1', { type: 'av_vote', approve: true });
    const differentVote = structuredClone(state);
    differentVote.secrets.votes.p1 = false;
    expect(projectAvalon(state, 'p0')).toEqual(projectAvalon(differentVote, 'p0'));
    const a = fixture();
    assign(a, ['merlin', 'servant', 'servant', 'assassin', 'minion']);
    team(a, ['p3', 'p4']);
    approve(a);
    act(a, 'p3', { type: 'av_quest', card: 'fail' });
    const differentCard = structuredClone(a);
    differentCard.secrets.questCards.p3 = 'success';
    expect(projectAvalon(a, 'p0')).toEqual(projectAvalon(differentCard, 'p0'));
    const scopeA = scope(a),
      scopeB = scope(differentCard);
    const resolutionClock = (): EngineClock => ({
      now: 1_000_010,
      die: () => 1,
      uuid: (() => {
        let i = 0;
        return () => `shared-resolution-${++i}`;
      })(),
    });
    applyIntent(a, 'p4', { type: 'av_quest', card: 'success', ...scopeA }, resolutionClock());
    applyIntent(
      differentCard,
      'p4',
      { type: 'av_quest', card: 'fail', ...scopeB },
      resolutionClock(),
    );
    expect(projectAvalon(a, 'p0')).toEqual(projectAvalon(differentCard, 'p0'));
    expect(a.secrets.questCards).toEqual({});
    expect(Object.keys(a.history.quests[0]!)).toEqual([
      'questNumber',
      'proposalId',
      'teamIds',
      'successCount',
      'failCount',
      'failed',
      'at',
    ]);
    expect(a.latestEvent!.actorId).toBeNull();
    expect(a.latestEvent!.type).toBe('quest_resolved');
    check(a);
    check(differentCard);
  });
  it('uses positive nested allowlists and returns independent projection objects', () => {
    const state = fixture();
    Object.assign(state, { unexpectedSecret: 'CANARY' });
    Object.assign(state.players[0]!, { role: 'CANARY' });
    Object.assign(state.config, { hidden: 'CANARY' });
    Object.assign(state.latestEvent!, { cardAuthor: 'CANARY' });
    const view = projectAvalon(state, 'p0');
    expect(JSON.stringify(view)).not.toContain('CANARY');
    expect(Object.hasOwn(view, 'secrets')).toBe(false);
    view.players[0]!.nickname = '바뀐이름';
    view.privateInfo!.knownEvilIds.length = 0;
    view.config.optionalRoles.push('oberon');
    view.history.events[0]!.actorId = 'changed';
    expect(state.players[0]!.nickname).toBe('같은이름');
    expect(state.config.optionalRoles).toEqual([]);
    expect(state.history.events[0]!.actorId).toBe('p0');
  });
  it('offers Lady only after quests 2/3/4, transfers its holder and privately reveals alignment', () => {
    const state = fixture(7, { optionalRoles: ['morgana', 'percival'], ladyOfLake: true });
    assign(state, ['merlin', 'percival', 'servant', 'servant', 'assassin', 'morgana', 'minion']);
    expect(state.lady!.holderId).toBe('p6');
    quest(state);
    expect(state.stage).toBe('team');
    quest(state, 1);
    expect(state.stage).toBe('lady');
    expect(state.questNumber).toBe(2);
    expect(getAvalonActions(projectAvalon(state, 'p6'), 'p6').ladyTargetIds).not.toContain('p6');
    expect(() => act(state, 'p0', { type: 'av_lady', targetId: 'p1' })).toThrow();
    expect(() => act(state, 'p6', { type: 'av_lady', targetId: 'p6' })).toThrow();
    act(state, 'p6', { type: 'av_lady', targetId: 'p5' });
    expect(state.lady!.holderId).toBe('p5');
    expect(projectAvalon(state, 'p6').privateInfo!.ladyInsights).toEqual([
      { actorId: 'p6', targetId: 'p5', questNumber: 2, alignment: 'evil' },
    ]);
    expect(projectAvalon(state, 'p5').privateInfo!.ladyInsights).toEqual([]);
    expect(projectAvalonPublic(state).lady!.investigations[0]).toEqual({
      actorId: 'p6',
      targetId: 'p5',
      questNumber: 2,
    });
    check(state);
    quest(state);
    expect(state.stage).toBe('lady');
    expect(() => act(state, 'p5', { type: 'av_lady', targetId: 'p6' })).toThrow();
    act(state, 'p5', { type: 'av_lady', targetId: 'p0' });
    quest(state, 2);
    expect(state.stage).toBe('lady');
    act(state, 'p0', { type: 'av_lady', targetId: 'p1' });
    expect(state.questNumber).toBe(5);
    expect(state.lady!.usedByIds).toEqual(['p6', 'p5', 'p0']);
    expect(state.lady!.investigations).toHaveLength(3);
    check(state);
    quest(state);
    expect(state.stage).toBe('assassination');
    expect(state.lady!.investigations).toHaveLength(3);
    check(state);
  });
  it('gives immediate victory/assassination precedence over another Lady inspection', () => {
    for (const fails of [0, 1]) {
      const state = fixture(7, { optionalRoles: [], ladyOfLake: true });
      quest(state, fails);
      quest(state, fails);
      act(state, state.lady!.holderId, { type: 'av_lady', targetId: 'p0' });
      quest(state, fails);
      expect(state.stage).toBe(fails ? 'finished' : 'assassination');
      expect(state.lady!.investigations).toHaveLength(1);
      check(state);
    }
  });
});

describe('Avalon snapshot validation, recovery and void termination', () => {
  it('preserves role and own submissions in JSON rehydration at every intermediate stage', () => {
    const state = fixture();
    team(state);
    act(state, 'p2', { type: 'av_vote', approve: false });
    let restored: AvalonInternalState = JSON.parse(JSON.stringify(state));
    check(restored);
    expect(projectAvalon(restored, 'p2')).toEqual(projectAvalon(state, 'p2'));
    for (const id of ['p0', 'p1', 'p3', 'p4'])
      act(restored, id, { type: 'av_vote', approve: true });
    const member = restored.proposal!.teamIds[0]!;
    act(restored, member, { type: 'av_quest', card: 'success' });
    restored = JSON.parse(JSON.stringify(restored));
    check(restored);
    expect(projectAvalon(restored, member).privateInfo!.myQuestCard).toBe('success');
    act(restored, restored.proposal!.teamIds[1]!, { type: 'av_quest', card: 'success' });
    check(restored);
    expect(restored.history.quests).toHaveLength(1);
  });
  it('fails closed for malformed common data, secrets, stage invariants and unknown fields', () => {
    const valid = fixture();
    const mutations: ((s: AvalonInternalState) => void)[] = [
      (s) => {
        s.players[0]!.seat = 10;
      },
      (s) => {
        s.players[1]!.id = s.players[0]!.id;
      },
      (s) => {
        s.players[0]!.kind = 'computer';
      },
      (s) => {
        s.players[0]!.forfeited = true;
      },
      (s) => {
        s.version = -1;
      },
      (s) => {
        s.protocolVersion = 2;
      },
      (s) => {
        s.code = 'bad';
      },
      (s) => {
        s.phaseId = 'other';
      },
      (s) => {
        s.questNumber = 5;
      },
      (s) => {
        s.leaderId = 'p1';
        s.turnPlayerId = 'p1';
      },
      (s) => {
        s.secrets.roles.p0 = 'merlin';
        s.secrets.roles.p1 = 'merlin';
      },
      (s) => {
        s.secrets.votes = { p0: true };
      },
      (s) => {
        s.secrets.questCards = { p0: 'fail' };
      },
      (s) => {
        s.revealedRoles = [{ playerId: 'p0', role: 'merlin', alignment: 'good' }];
      },
      (s) => {
        Object.assign(s, { secretBypass: true });
      },
    ];
    for (const mutate of mutations) {
      const broken = structuredClone(valid);
      mutate(broken);
      expect(isAvalonInternalState(broken)).toBe(false);
    }
    const view = projectAvalon(valid, 'p0');
    expect(isAvalonRoomState({ ...view, secrets: valid.secrets })).toBe(false);
    expect(
      isAvalonRoomState({ ...view, privateInfo: { ...view.privateInfo, myQuestCard: 'fail' } }),
    ).toBe(false);
    expect(
      isAvalonRoomState({
        ...view,
        privateInfo: { ...view.privateInfo, role: 'morgana', alignment: 'evil' },
      }),
    ).toBe(false);
    expect(isAvalonInternalState(view)).toBe(false);
    expect(isAvalonRoomState(valid)).toBe(false);
  });
  it('rejects a tampered aggregate or an exposed author field in a saved public record', () => {
    const state = fixture();
    quest(state, 1);
    check(state);
    const tampered = structuredClone(state);
    tampered.history.quests[0]!.failed = false;
    expect(isAvalonInternalState(tampered)).toBe(false);
    const publicTamper = projectAvalon(state, 'p0');
    Object.assign(publicTamper.history.quests[0]!, { authors: ['p0'] });
    expect(isAvalonRoomState(publicTamper)).toBe(false);
  });
  it('requires dense immutable seats in playing, completed and void snapshots', () => {
    const playing = fixture();
    const finished = fixture();
    quest(finished, 1);
    quest(finished, 1);
    quest(finished, 1);
    const voided = fixture();
    abort(voided, 'player_left', clock());
    for (const state of [playing, finished, voided]) {
      check(state);
      // Still unique, sorted and within 0..9, but seat five overlaps zero on a five-seat ring.
      state.players[4]!.seat = 5;
      expect(isAvalonInternalState(state)).toBe(false);
      expect(isAvalonRoomState(projectAvalon(state, 'p0'))).toBe(false);
    }
  });
  it('voids a broken match without revealing roles or granting either side a win, then resets cleanly', () => {
    const state = fixture(7, { optionalRoles: ['morgana', 'percival'], ladyOfLake: true });
    team(state);
    act(state, 'p1', { type: 'av_vote', approve: false });
    const roles = structuredClone(state.secrets.roles);
    abort(state, 'disconnected', clock());
    expect(state.winner).toBeNull();
    expect(state.finishReason).toBe('disconnected');
    expect(state.revealedRoles).toEqual([]);
    expect(state.results).toEqual([]);
    expect(state.secrets.roles).toEqual(roles);
    expect(projectAvalon(state, 'p1').privateInfo!.myVote).toBeNull();
    check(state);
    const aborted = structuredClone(state);
    abort(state, 'player_left', clock());
    expect(state).toEqual(aborted);
    state.gameId = uuid();
    state.turnId = uuid();
    reset(state);
    expect(state.config).toEqual({ optionalRoles: ['morgana', 'percival'], ladyOfLake: true });
    expect(state.secrets).toEqual({ roles: {}, votes: {}, questCards: {}, ladyInsights: [] });
    expect(projectAvalon(state, 'p1').privateInfo).toBeNull();
    check(state);
    start(state, clock());
    check(state);
  });
  it('can recover a void termination from quest submission and from assassination', () => {
    const duringQuest = fixture();
    team(duringQuest);
    approve(duringQuest);
    abort(duringQuest, 'player_left', clock());
    check(duringQuest);
    const duringAssassination = fixture();
    quest(duringAssassination);
    quest(duringAssassination);
    quest(duringAssassination);
    abort(duringAssassination, 'session_expired', clock());
    check(duringAssassination);
    expect(duringAssassination.revealedRoles).toEqual([]);
    expect(duringAssassination.winner).toBeNull();
  });
  it('keeps completed and void games valid until cleanup after every member departs', () => {
    const normal = fixture();
    quest(normal, 1);
    quest(normal, 1);
    quest(normal, 1);
    const voided = fixture();
    abort(voided, 'player_left', clock());
    for (const state of [normal, voided]) {
      state.hostId = '';
      for (const player of state.players) {
        player.connected = false;
        player.graceDeadline = null;
      }
      check(state);
    }
    const active = fixture();
    active.hostId = '';
    for (const player of active.players) player.connected = false;
    expect(isAvalonInternalState(active)).toBe(false);
  });
});
