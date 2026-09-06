import { describe, expect, it } from 'vitest';
import {
  addComputer,
  applyCommand,
  applyComputerTurn,
  connect,
  depart,
  joinRoom,
  member,
  newRoom,
  type StoredRoom,
} from '../src/server/engine';
import { parseCommand, parseCreateRoom } from '../src/server/validation';
import type { Command, Intent } from '../src/shared/protocol';
import { migrateStoredRoom } from '../src/server/migration';
const uuid = () => crypto.randomUUID();
const now = 1_000_000;
function setup(computer = false) {
  const room = newRoom(uuid(), 'ABCDEFGH', now, uuid, 'tikatuka');
  joinRoom(room, 'player-host', '호스트', 'session-host', now);
  connect(room, 'player-host', 'session-host', 'connection-host', now);
  if (computer) addComputer(room, now, uuid);
  else {
    joinRoom(room, 'player-guest', '상대', 'session-guest', now);
    connect(room, 'player-guest', 'session-guest', 'connection-guest', now);
  }
  return room;
}
function command(room: StoredRoom, intent: Intent): Command {
  return {
    ...intent,
    gameType: room.state.gameType,
    protocolVersion: 2,
    gameId: room.state.gameId,
    turnId: room.state.turnId,
    expectedVersion: room.state.version,
    requestId: uuid(),
  } as Command;
}
function play(room: StoredRoom, playerId: string, key: string, intent: Intent, die = () => 1) {
  applyCommand(room, playerId, key, command(room, intent), { now, uuid, die });
}
describe('common authority with separate game adapters', () => {
  it('preserves legacy creation and requires an exact modern catalog choice', () => {
    expect(parseCreateRoom({})).toEqual({ gameType: 'yacht', solo: false });
    expect(parseCreateRoom({ gameType: 'tikatuka', solo: true })).toEqual({
      gameType: 'tikatuka',
      solo: true,
    });
    for (const value of [
      { gameType: 'unknown', solo: true },
      { gameType: 'tikatuka' },
      { gameType: 'yacht', solo: 1 },
      { gameType: 'tikatuka', solo: true, opponent: 'custom' },
    ])
      expect(() => parseCreateRoom(value)).toThrow();
  });
  it('caps Tikatuka at two, requires the second seat, and does not reuse Yacht scoring fields', () => {
    const room = newRoom(uuid(), 'ABCDEFGH', now, uuid, 'tikatuka');
    joinRoom(room, 'player-host', '호스트', 'session-host', now);
    connect(room, 'player-host', 'session-host', 'connection-host', now);
    expect(() => play(room, 'player-host', 'session-host', { type: 'start' })).toThrow('상대');
    joinRoom(room, 'player-guest', '상대', 'session-guest', now);
    expect(() => joinRoom(room, 'player-third', '세 번째', 'session-third', now)).toThrow('두 명');
    expect(room.state.players[0]).not.toHaveProperty('scores');
    expect(room.state).not.toHaveProperty('rolls');
    expect(migrateStoredRoom(JSON.parse(JSON.stringify(room)))).toEqual(room);
  });
  it('binds game-specific commands to the server room and protects the retained state', () => {
    const room = setup();
    const previous = JSON.stringify(room);
    const legacy = {
      type: 'roll',
      requestId: uuid(),
      gameId: room.state.gameId,
      expectedVersion: room.state.version,
      turnId: room.state.turnId,
    } as const;
    for (const cmd of [legacy, { ...legacy, gameType: 'yacht', protocolVersion: 2 } as Command]) {
      expect(() =>
        applyCommand(room, 'player-host', 'session-host', cmd, {
          now,
          uuid,
          die: () => {
            throw new Error('No RNG');
          },
        }),
      ).toThrow();
      expect(JSON.stringify(room)).toBe(previous);
    }
    const wrongWire = { ...legacy, gameType: 'tikatuka', protocolVersion: 2 };
    expect(() => parseCommand(wrongWire)).toThrow('동작');
    expect(() =>
      parseCommand({ ...wrongWire, type: 'ready', ready: true, protocolVersion: 4 }),
    ).toThrow('좌석');
  });
  it('a computer has no externally usable membership and alarms consume only a due action', () => {
    const room = setup(true);
    const computer = room.state.players.find((p) => p.kind === 'computer')!;
    expect(room.members[computer.id]).toBeUndefined();
    expect(() => member(room, computer.id, 'session-host')).toThrow('참가자');
    play(room, 'player-host', 'session-host', { type: 'start' }, () => 6);
    const version = room.state.version;
    expect(room.state.aiDueAt).not.toBeNull();
    const due = room.state.aiDueAt!;
    expect(
      applyComputerTurn(room, {
        now: due - 1,
        uuid,
        die: () => {
          throw new Error('Too early');
        },
      }),
    ).toBe(false);
    expect(room.state.version).toBe(version);
    expect(applyComputerTurn(room, { now: due, uuid, die: () => 4 })).toBe(true);
    const once = JSON.stringify(room);
    expect(
      applyComputerTurn(room, {
        now: due,
        uuid,
        die: () => {
          throw new Error('Duplicate alarm');
        },
      }),
    ).toBe(false);
    expect(JSON.stringify(room)).toBe(once);
    expect(migrateStoredRoom(JSON.parse(once))).toEqual(room);
  });
  it('forfeit ends a computer match without leaving a pending alarm', () => {
    const room = setup(true);
    play(room, 'player-host', 'session-host', { type: 'start' });
    depart(room, 'player-host', now + 1, uuid);
    expect(room.state.phase).toBe('finished');
    expect(room.state.aiDueAt).toBeNull();
    expect(room.state.hostId).toBe('');
    expect(room.state.results.find((r) => r.playerId === 'player-host')?.forfeited).toBe(true);
  });
  it('refuses a saved computer turn whose durable deadline is missing without altering it', () => {
    const room = setup(true);
    play(room, 'player-host', 'session-host', { type: 'start' }, () => 6);
    expect(migrateStoredRoom(structuredClone(room))).toEqual(room);
    const broken = structuredClone(room);
    broken.state.aiDueAt = null;
    const before = JSON.stringify(broken);
    expect(() => migrateStoredRoom(broken)).toThrow('보존');
    expect(JSON.stringify(broken)).toBe(before);
  });
});
