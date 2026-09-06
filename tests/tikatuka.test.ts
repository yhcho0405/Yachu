import { describe, expect, it } from 'vitest';
import {
  applyIntent,
  chooseAI,
  createPlayer,
  createState,
  forfeit,
  reset,
  start,
} from '../src/server/games/tikatuka';
import {
  assertTikatukaState,
  getTikatukaTargets,
  isTikatukaState,
  previewTikatukaMove,
  scoreTikatukaLane,
  scoreTikatukaPlayers,
  type TikatukaBoard,
  type TikatukaDie,
  type TikatukaIntent,
  type TikatukaRoomState,
} from '../src/shared/tikatuka';
import type { EngineClock } from '../src/server/errors';

let sequence = 0;
const uuid = () => `test-id-${++sequence}`;
const clock = (die = 1): EngineClock => ({ now: 1_000_000, uuid, die: () => die });
const die = (value: number, kind: TikatukaDie['kind'] = 'normal'): TikatukaDie => ({
  id: uuid(),
  value,
  kind,
});
function fixture(computer = false): TikatukaRoomState {
  const state = createState({
    schemaVersion: 2,
    protocolVersion: 2,
    gameType: 'tikatuka',
    roomId: uuid(),
    code: 'ABCDEFGH',
    gameId: uuid(),
    rulesVersion: '',
    phase: 'lobby',
    version: 0,
    presenceVersion: 0,
    hostId: 'one',
    players: ['one', 'two'].map((id, seat) =>
      createPlayer({
        id,
        kind: computer && seat === 1 ? 'computer' : 'human',
        nickname: '동일',
        seat,
        ready: true,
        connected: true,
        forfeited: false,
        graceDeadline: null,
      }),
    ),
    turnPlayerId: null,
    turnId: uuid(),
    inputAfter: 0,
    results: [],
    updatedAt: 1_000_000,
    expiresAt: 2_000_000,
  });
  start(state, clock());
  return state;
}
function position(
  state: TikatukaRoomState,
  a: TikatukaBoard,
  b: TikatukaBoard,
  value: number,
  kind: TikatukaDie['kind'] = 'normal',
): void {
  state.players[0]!.lanes = a;
  state.players[1]!.lanes = b;
  Object.assign(state, {
    turnNumber: 2,
    nextRoll: kind === 'normal' ? 'normal' : 'bonus',
    stage: 'placing',
    pendingDie: { ...die(value, kind), source: kind === 'normal' ? 'normal' : 'bonus' },
    rerollChoices: null,
    inputAfter: 0,
  });
  for (const score of scoreTikatukaPlayers(state.players)) {
    const player = state.players.find((p) => p.id === score.playerId)!;
    Object.assign(player, {
      laneScores: score.laneScores,
      laneWins: score.laneWins,
      total: score.total,
    });
  }
}
function act(state: TikatukaRoomState, intent: TikatukaIntent, face = 1): void {
  applyIntent(state, state.turnPlayerId!, intent, {
    now: Math.max(state.inputAfter, 1_100_000),
    uuid,
    die: () => face,
  });
}
function seeded(seed: number): () => number {
  let n = seed;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 0x1_0000_0000;
  };
}

describe('original Tikatuka lane scoring', () => {
  it.each([
    [[], 0],
    [[2, 4, 6], 12],
    [[4, 4], 12],
    [[4, 4, 2], 14],
    [[4, 4, 4], 20],
    [[6, 6], 18],
    [[6, 6, 6], 30],
  ] as [number[], number][])('scores %j as %i', (faces, score) => {
    expect(scoreTikatukaLane(faces.map((value) => ({ value })))).toBe(score);
  });
  it('exhausts 216 triples with all eight normal/shield assignments and all smaller lanes', () => {
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++)
        for (let c = 1; c <= 6; c++) {
          const values = [a, b, c];
          const expected =
            values.reduce((sum, value) => sum + value, 0) +
            values.filter((v, i) => values.indexOf(v) !== i).reduce((sum, v) => sum + v, 0);
          for (let mask = 0; mask < 8; mask++)
            expect(
              scoreTikatukaLane(
                values.map((v, i) => die(v, mask & (1 << i) ? 'shield' : 'normal')),
              ),
            ).toBe(expected);
          expect(scoreTikatukaLane([die(a), die(b)])).toBe(a === b ? 3 * a : a + b);
          expect(scoreTikatukaLane([die(a)])).toBe(a);
        }
  });
});

describe('Tikatuka authority and original transitions', () => {
  it('automatically rolls a first-player shield, restricts it to that board, and alternates', () => {
    const state = fixture();
    expect(state.stage).toBe('placing');
    expect(state.pendingDie).toMatchObject({ value: 1, kind: 'shield', source: 'opening' });
    expect(getTikatukaTargets(state)).toEqual(
      [0, 1, 2].map((lane) => ({ ownerId: 'one', lane, action: 'place' })),
    );
    expect(() =>
      applyIntent(state, 'one', { type: 'tika_place', ownerId: 'two', lane: 0 }, clock()),
    ).toThrow('잠시');
    expect(() => act(state, { type: 'tika_place', ownerId: 'two', lane: 0 })).toThrow('없는 칸');
    act(state, { type: 'tika_place', ownerId: 'one', lane: 1 }, 6);
    expect(state.turnPlayerId).toBe('two');
    expect(state.pendingDie).toMatchObject({ value: 6, kind: 'normal', source: 'normal' });
    expect(() =>
      applyIntent(state, 'one', { type: 'tika_hold' }, { ...clock(), now: state.inputAfter }),
    ).toThrow('자신의 차례');
    assertTikatukaState(state);
  });
  it('offers an attack instead of own-lane placement, consumes its die, removes all matching normals, keeps shields, and rolls a bonus atomically', () => {
    const state = fixture();
    const shield = die(5, 'shield');
    const removed = [die(5), die(5)];
    position(state, [[die(4)], [], []], [[...removed, shield], [die(5)], []], 5);
    const before = JSON.stringify(state);
    const preview = previewTikatukaMove(state, 'two', 0)!;
    expect(JSON.stringify(state)).toBe(before);
    expect(preview.removedIds).toEqual(removed.map((d) => d.id));
    expect(preview.players[1]!.laneScores[0]).toBe(5);
    expect(preview.consumesDie).toBe(true);
    expect(getTikatukaTargets(state)).not.toContainEqual({
      ownerId: 'one',
      lane: 0,
      action: 'place',
    });
    expect(() => act(state, { type: 'tika_place', ownerId: 'one', lane: 0 })).toThrow('없는 칸');
    act(state, { type: 'tika_place', ownerId: 'two', lane: 0 }, 2);
    expect(state.players[0]!.lanes[0]).toHaveLength(1);
    expect(state.players[1]!.lanes[0]).toEqual([shield]);
    expect(state.players[1]!.lanes[1]).toHaveLength(1);
    expect(state.turnPlayerId).toBe('one');
    expect(state.pendingDie).toMatchObject({ value: 2, kind: 'shield', source: 'bonus' });
    expect(state.latestEvent).toMatchObject({
      type: 'attack',
      removedIds: removed.map((d) => d.id),
    });
    expect(getTikatukaTargets(state)).toHaveLength(6);
    const saved = structuredClone(state);
    assertTikatukaState(saved);
    act(saved, { type: 'tika_place', ownerId: 'two', lane: 2 }, 4);
    expect(saved.players[1]!.lanes[2][0]).toMatchObject({ value: 2, kind: 'shield' });
    expect(saved.turnPlayerId).toBe('two');
    assertTikatukaState(saved);
  });
  it('requires an empty own slot for attacks and lets shield dice coexist without attacking', () => {
    const state = fixture();
    position(state, [[die(2), die(3), die(4)], [], []], [[die(6)], [die(6, 'shield')], []], 6);
    expect(getTikatukaTargets(state)).toEqual([
      { ownerId: 'one', lane: 1, action: 'place' },
      { ownerId: 'one', lane: 2, action: 'place' },
    ]);
    expect(previewTikatukaMove(state, 'two', 0)).toBeNull();
    position(state, [[], [], []], [[die(6)], [], []], 6, 'shield');
    act(state, { type: 'tika_place', ownerId: 'two', lane: 0 });
    expect(state.players[1]!.lanes[0]).toHaveLength(2);
    expect(state.players[1]!.laneScores[0]).toBe(18);
  });
  it('persists two distinct reroll choices, consumes the skill once, and preserves the opening-shield restriction and identity', () => {
    const state = fixture();
    const original = state.pendingDie!;
    let calls = 0;
    applyIntent(
      state,
      'one',
      { type: 'tika_reroll' },
      { now: state.inputAfter, uuid, die: () => (++calls === 1 ? 1 : 6) },
    );
    expect(calls).toBe(2);
    expect(state.stage).toBe('choosingReroll');
    expect(state.pendingDie).toBeNull();
    expect(state.players[0]!.rerollUsed).toBe(true);
    expect(state.rerollChoices?.original).toEqual(original);
    expect(state.rerollChoices?.rerolled).toMatchObject({
      value: 6,
      kind: 'shield',
      source: 'opening',
    });
    expect(getTikatukaTargets(state)).toEqual([]);
    const restored = JSON.parse(JSON.stringify(state)) as TikatukaRoomState;
    assertTikatukaState(restored);
    act(restored, { type: 'tika_choose', choice: 'original' });
    expect(restored.pendingDie).toEqual(original);
    expect(() => act(restored, { type: 'tika_reroll' })).toThrow('사용할 수 없습니다');
    expect(getTikatukaTargets(restored).every((t) => t.ownerId === 'one')).toBe(true);
  });
  it('allows early hold, discards its pending die, never revives a voluntary hold, and ends after the other board fills', () => {
    const state = fixture();
    act(state, { type: 'tika_hold' });
    expect(state.players[0]!.held).toBe(true);
    expect(state.players[0]!.lanes.flat()).toHaveLength(0);
    expect(state.turnPlayerId).toBe('two');
    for (let n = 0; n < 9; n++) {
      expect(state.turnPlayerId).toBe('two');
      const target = getTikatukaTargets(state)[0]!;
      act(state, { type: 'tika_place', ownerId: target.ownerId, lane: target.lane });
    }
    expect(state.phase).toBe('finished');
    expect(state.finishReason).toBe('holds');
    expect(state.results.find((p) => p.playerId === 'two')?.rank).toBe(1);
    assertTikatukaState(state);
  });
  it('skips a full opponent board, then revives its turn when an attack makes space', () => {
    const state = fixture();
    position(
      state,
      [[], [], []],
      [
        [die(5), die(2, 'shield'), die(3, 'shield')],
        [die(2, 'shield'), die(3, 'shield'), die(4, 'shield')],
        [die(2, 'shield'), die(3, 'shield'), die(4, 'shield')],
      ],
      1,
    );
    act(state, { type: 'tika_place', ownerId: 'one', lane: 0 }, 5);
    expect(state.phase).toBe('playing');
    expect(state.turnPlayerId).toBe('one');
    act(state, { type: 'tika_place', ownerId: 'two', lane: 0 }, 6);
    expect(state.players[1]!.lanes[0]).toHaveLength(2);
    expect(state.turnPlayerId).toBe('one');
    act(state, { type: 'tika_place', ownerId: 'one', lane: 2 }, 4);
    expect(state.turnPlayerId).toBe('two');
    expect(state.players[1]!.held).toBe(false);
    assertTikatukaState(state);
  });
  it('matches the original 29–29 draw, ranks by lanes before total, and retains forensic scores on forfeit', () => {
    const state = fixture();
    position(
      state,
      [
        [die(6), die(3)],
        [die(6), die(5)],
        [die(6), die(3)],
      ],
      [
        [die(6), die(4)],
        [die(6), die(4)],
        [die(6), die(3)],
      ],
      1,
    );
    state.players[1]!.held = true;
    act(state, { type: 'tika_hold' });
    expect(state.results.map((r) => [r.total, r.rank])).toEqual([
      [29, 1],
      [29, 1],
    ]);
    assertTikatukaState(state);
    const wins = fixture();
    position(wins, [[die(6)], [die(6)], []], [[die(5)], [die(5)], [die(6), die(6), die(6)]], 1);
    wins.players[1]!.held = true;
    act(wins, { type: 'tika_hold' });
    expect(wins.results[0]).toMatchObject({ playerId: 'one', rank: 1, total: 12 });
    const quit = fixture();
    const board = structuredClone(quit.players);
    forfeit(quit, 'one', {
      now: 1_100_000,
      uuid,
      die: () => {
        throw new Error('forfeit must never draw');
      },
    });
    expect(quit.players[0]!.lanes).toEqual(board[0]!.lanes);
    expect(quit.results[0]).toMatchObject({ playerId: 'two', rank: 1 });
    expect(quit.finishReason).toBe('forfeit');
    assertTikatukaState(quit);
  });
  it('uses total only after an equal number of lane wins and preserves a voluntary hold after removal', () => {
    const tiedLanes = fixture();
    position(
      tiedLanes,
      [
        [die(6), die(3)],
        [die(6), die(6)],
        [die(6), die(3)],
      ],
      [
        [die(6), die(4)],
        [die(6), die(5)],
        [die(6), die(3)],
      ],
      1,
    );
    tiedLanes.players[1]!.held = true;
    act(tiedLanes, { type: 'tika_hold' });
    expect(tiedLanes.players.map((p) => p.laneWins)).toEqual([1, 1]);
    expect(tiedLanes.results).toMatchObject([
      { playerId: 'one', total: 36, rank: 1 },
      { playerId: 'two', total: 30, rank: 2 },
    ]);
    assertTikatukaState(tiedLanes);

    const held = fixture();
    position(held, [[], [], []], [[die(5)], [], []], 5);
    held.players[1]!.held = true;
    act(held, { type: 'tika_place', ownerId: 'two', lane: 0 }, 6);
    expect(held.players[1]!.lanes[0]).toEqual([]);
    act(held, { type: 'tika_place', ownerId: 'one', lane: 0 }, 4);
    expect(held.turnPlayerId).toBe('one');
    expect(held.players[1]!.held).toBe(true);
    assertTikatukaState(held);
  });
  it('keeps candidate choice exclusive and rejects unresolved declaration actions without changing the board', () => {
    const state = fixture();
    const before = JSON.stringify(state);
    for (const intent of [
      { type: 'tika_declare' },
      { type: 'tika_respond', accept: true },
    ] as const) {
      expect(() => act(state, intent)).toThrow('원본 규칙');
      expect(JSON.stringify(state)).toBe(before);
    }
    act(state, { type: 'tika_reroll' }, 6);
    const choosing = JSON.stringify(state);
    for (const intent of [
      { type: 'tika_hold' },
      { type: 'tika_place', ownerId: 'one', lane: 0 },
      { type: 'tika_reroll' },
    ] as const) {
      expect(() => act(state, intent)).toThrow();
      expect(JSON.stringify(state)).toBe(choosing);
    }
  });
  it('clears all game-specific state for rematch and refuses unverifiable persisted combinations', () => {
    const state = fixture();
    const corruptions = [
      (s: Record<string, unknown>) => {
        s.pendingDie = { id: 'bad', value: 7, kind: 'shield', source: 'opening' };
      },
      (s: Record<string, unknown>) => {
        s.stage = 'choosingReroll';
      },
      (s: Record<string, unknown>) => {
        s.nextRoll = 'normal';
      },
      (s: Record<string, unknown>) => {
        s.aiDueAt = 1_200_000;
      },
      (s: Record<string, unknown>) => {
        s.latestEvent = { ...(s.latestEvent as Record<string, unknown>), at: 0.5 };
      },
      (s: Record<string, unknown>) => {
        s.futureOption = true;
      },
      (s: Record<string, unknown>) => {
        (s.players as TikatukaRoomState['players'])[0]!.laneScores[0] = 99;
      },
      (s: Record<string, unknown>) => {
        (s.players as TikatukaRoomState['players'])[0]!.lanes[0] = [die(1), die(2), die(3), die(4)];
      },
    ];
    for (const corrupt of corruptions) {
      const copy = structuredClone(state) as unknown as Record<string, unknown>;
      corrupt(copy);
      expect(isTikatukaState(copy)).toBe(false);
    }
    act(state, { type: 'tika_hold' });
    act(state, { type: 'tika_hold' });
    state.phase = 'lobby';
    reset(state);
    expect(state.pendingDie).toBeNull();
    expect(state.latestEvent).toBeNull();
    expect(state.players.every((p) => !p.held && !p.rerollUsed && p.total === 0)).toBe(true);
    assertTikatukaState(state);
  });
});

describe('Tikatuka public-information AI', () => {
  it('chooses a strategic attack over the first legal placement and can return an original reroll candidate', () => {
    const state = fixture(true);
    state.turnPlayerId = 'two';
    position(state, [[], [die(6), die(6)], []], [[], [], []], 6);
    state.players[1]!.rerollUsed = true;
    const before = JSON.stringify(state);
    expect(chooseAI(state)).toEqual({ type: 'tika_place', ownerId: 'one', lane: 1 });
    expect(JSON.stringify(state)).toBe(before);
    Object.assign(state, {
      stage: 'choosingReroll',
      pendingDie: null,
      rerollChoices: {
        original: { ...die(6), source: 'normal' },
        rerolled: { ...die(1), source: 'normal' },
      },
    });
    expect(chooseAI(state)).toEqual({ type: 'tika_choose', choice: 'original' });
  });
  it('completes 48 deterministic games against varied legal opponents without looking ahead at RNG', () => {
    for (let seed = 1; seed <= 48; seed++) {
      const rng = seeded(seed);
      const state = fixture(true);
      let moves = 0;
      while (state.phase === 'playing' && moves++ < 500) {
        const actor = state.players.find((p) => p.id === state.turnPlayerId)!;
        let intent: TikatukaIntent;
        if (actor.kind === 'computer') intent = chooseAI(state)!;
        else if (state.stage === 'choosingReroll')
          intent = { type: 'tika_choose', choice: rng() < 0.5 ? 'original' : 'rerolled' };
        else {
          const targets = getTikatukaTargets(state);
          const target = targets[Math.floor(rng() * targets.length)]!;
          intent =
            !actor.rerollUsed && rng() < 0.1
              ? { type: 'tika_reroll' }
              : { type: 'tika_place', ownerId: target.ownerId, lane: target.lane };
        }
        expect(intent).not.toBeNull();
        applyIntent(state, actor.id, intent, {
          now: state.inputAfter + 1,
          uuid,
          die: () => 1 + Math.floor(rng() * 6),
        });
        assertTikatukaState(state);
      }
      expect(state.phase, `seed ${seed}`).toBe('finished');
      expect(moves).toBeLessThan(500);
      expect(state.results).toHaveLength(2);
    }
  });
});
