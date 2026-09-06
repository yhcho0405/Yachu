import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Command, type Intent } from '../src/shared/protocol';
import {
  applyCommand,
  connect,
  depart,
  disconnect,
  expireGrace,
  GRACE_MS,
  joinRoom,
  newRoom,
  type StoredRoom,
} from '../src/server/engine';

const uuid = () => crypto.randomUUID();
function fixture(count = 1) {
  const room = newRoom(uuid(), 'ABCDEFGH', 1_000_000, uuid);
  for (let i = 0; i < count; i++) {
    joinRoom(room, `player-${i}`, '같은 닉네임', `session-${i}`, 1_000_000);
    connect(room, `player-${i}`, `session-${i}`, `connection-${i}`, 1_000_000);
  }
  return room;
}
function command(room: StoredRoom, intent: Intent): Command {
  return {
    ...intent,
    requestId: uuid(),
    gameId: room.state.gameId,
    turnId: room.state.turnId,
    expectedVersion: room.state.version,
  };
}
function play(room: StoredRoom, player: number, intent: Intent, now = 1_100_000): void {
  applyCommand(room, `player-${player}`, `session-${player}`, command(room, intent), {
    now,
    die: () => 1,
    uuid,
  });
}
function start(room: StoredRoom) {
  for (let i = 1; i < room.state.players.length; i++) play(room, i, { type: 'ready', ready: true });
  play(room, 0, { type: 'start' });
}
describe('authoritative transitions', () => {
  for (const count of [1, 2, 3, 4])
    it(`completes ${count}-player game and rematch, preserving tie ranks`, () => {
      const room = fixture(count);
      start(room);
      let now = 1_200_000;
      for (const category of CATEGORIES)
        for (let player = 0; player < count; player++) {
          expect(room.state.turnPlayerId).toBe(`player-${player}`);
          play(room, player, { type: 'roll' }, (now += 2000));
          play(room, player, { type: 'score', category }, (now += 2000));
        }
      expect(room.state.phase).toBe('finished');
      expect(room.state.turnPlayerId).toBeNull();
      expect(room.state.results.map((result) => result.rank)).toEqual(Array(count).fill(1));
      expect(
        room.state.players.every((player) =>
          CATEGORIES.every((key) => player.scores[key] !== null),
        ),
      ).toBe(true);
      const gameId = room.state.gameId;
      play(room, 0, { type: 'rematch' }, now + 2000);
      expect(room.state.gameId).not.toBe(gameId);
      expect(room.state.phase).toBe('lobby');
      expect(room.state.players).toHaveLength(count);
      expect(
        room.state.players.every((player) =>
          CATEGORIES.every((key) => player.scores[key] === null),
        ),
      ).toBe(true);
      start(room);
      expect(room.state.phase).toBe('playing');
    });
  it('separates same-nickname identities; refuses outsiders, wrong sessions, opponents and host overrides', () => {
    const room = fixture(2);
    expect(room.state.players[0]!.nickname).toBe(room.state.players[1]!.nickname);
    expect(room.state.players[0]!.id).not.toBe(room.state.players[1]!.id);
    expect(() =>
      applyCommand(room, 'outsider', 'session-0', command(room, { type: 'start' }), {
        now: 0,
        uuid,
        die: () => 1,
      }),
    ).toThrow('참가자');
    expect(() =>
      applyCommand(room, 'player-0', 'session-1', command(room, { type: 'start' }), {
        now: 0,
        uuid,
        die: () => 1,
      }),
    ).toThrow('참가자');
    expect(() => play(room, 1, { type: 'start' })).toThrow('방장');
    expect(() => play(room, 0, { type: 'start' })).toThrow('준비');
    start(room);
    expect(() => play(room, 1, { type: 'roll' })).toThrow('자신의 차례');
    expect(() => joinRoom(room, 'new-player', '신규', 'new-key', 1_100_000)).toThrow('시작된');
    play(room, 0, { type: 'roll' });
    play(room, 0, { type: 'score', category: 'aces' }, 1_102_000);
    expect(() => play(room, 0, { type: 'roll' }, 1_104_000)).toThrow('자신의 차례');
  });
  it('validates first roll, fourth roll, held dice, category reuse, version and turn', () => {
    const room = fixture();
    start(room);
    expect(() => play(room, 0, { type: 'score', category: 'yacht' })).toThrow('먼저');
    expect(() => play(room, 0, { type: 'hold', held: [true, false, false, false, false] })).toThrow(
      '먼저',
    );
    play(room, 0, { type: 'roll' });
    expect(() => play(room, 0, { type: 'score', category: 'yacht' })).toThrow('잠시');
    play(room, 0, { type: 'hold', held: [true, false, false, false, false] }, 1_102_000);
    applyCommand(room, 'player-0', 'session-0', command(room, { type: 'roll' }), {
      now: 1_104_000,
      uuid,
      die: () => 6,
    });
    expect(room.state.dice.map((die) => die.value)).toEqual([1, 6, 6, 6, 6]);
    play(room, 0, { type: 'roll' }, 1_106_000);
    expect(() => play(room, 0, { type: 'roll' }, 1_108_000)).toThrow('모두');
    play(room, 0, { type: 'score', category: 'aces' }, 1_108_000);
    play(room, 0, { type: 'roll' }, 1_110_000);
    expect(() => play(room, 0, { type: 'score', category: 'aces' }, 1_112_000)).toThrow('이미');
    const stale = { ...command(room, { type: 'roll' }), expectedVersion: room.state.version - 1 };
    expect(() =>
      applyCommand(room, 'player-0', 'session-0', stale, { now: 1_120_000, uuid, die: () => 1 }),
    ).toThrow('다른 변경');
    expect(() =>
      applyCommand(
        room,
        'player-0',
        'session-0',
        { ...stale, expectedVersion: room.state.version, turnId: uuid() },
        { now: 1_120_000, uuid, die: () => 1 },
      ),
    ).toThrow('차례');
  });
  it('last-seat joins cannot exceed four and lobby departures hand off host', () => {
    const room = fixture(3);
    joinRoom(room, 'fourth', '넷', 'fourth-key', 1_000_000);
    expect(() => joinRoom(room, 'fifth', '다섯', 'fifth-key', 1_000_000)).toThrow('네 명');
    expect(room.state.players).toHaveLength(4);
    depart(room, 'player-0', 1_000_001, uuid);
    expect(room.state.hostId).toBe('player-1');
  });
  it('new connection survives old close, presence changes do not invalidate gameplay version', () => {
    const room = fixture();
    start(room);
    const version = room.state.version;
    connect(room, 'player-0', 'session-0', 'replacement', 1_101_000);
    expect(disconnect(room, 'player-0', 'connection-0', 1_102_000)).toBe(false);
    expect(room.state.players[0]!.connected).toBe(true);
    expect(room.state.version).toBe(version);
  });
  it('disconnect budget is cumulative, grace boundary wins over late reconnect, alarms are idempotent', () => {
    const room = fixture(2);
    start(room);
    disconnect(room, 'player-0', 'connection-0', 1_200_000);
    expect(room.state.players[0]!.graceDeadline).toBe(1_200_000 + GRACE_MS);
    connect(room, 'player-0', 'session-0', 'second', 1_260_000);
    disconnect(room, 'player-0', 'second', 1_270_000);
    expect(room.state.players[0]!.graceDeadline).toBe(1_330_000);
    expect(() => connect(room, 'player-0', 'session-0', 'late', 1_330_000)).toThrow('대기 시간');
    expect(expireGrace(room, 1_330_000, uuid)).toBe(true);
    expect(room.state.turnPlayerId).toBe('player-1');
    expect(room.state.hostId).toBe('player-1');
    const state = JSON.stringify(room);
    expect(expireGrace(room, 1_330_001, uuid)).toBe(false);
    expect(JSON.stringify(room)).toBe(state);
    expect(() => connect(room, 'player-0', 'session-0', 'late2', 1_330_001)).toThrow('참가자');
  });
  it('leaving midgame cannot change retained scores and last player leaving finishes', () => {
    const room = fixture(2);
    start(room);
    play(room, 0, { type: 'roll' });
    play(room, 0, { type: 'score', category: 'aces' }, 1_102_000);
    depart(room, 'player-0', 1_104_000, uuid);
    expect(room.state.players[0]!.scores.aces).toBe(5);
    depart(room, 'player-1', 1_104_001, uuid);
    expect(room.state.phase).toBe('finished');
    expect(room.state.turnPlayerId).toBeNull();
  });
});
