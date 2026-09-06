import { describe, expect, it } from 'vitest';
import legacy from './fixtures/yacht-v1.json';
import { migratePublicState, migrateStoredRoom } from '../src/server/migration';
import { applyCommand, connect } from '../src/server/engine';

const fixture = () => structuredClone(legacy);
describe('migration of the actual cdf76f0 Yacht SQLite format', () => {
  it('adds only the versioned game identity while retaining every original game field', () => {
    const old = fixture();
    const migrated = migrateStoredRoom(old);
    expect(migrated.state.gameType).toBe('yacht');
    expect(migrated.state.schemaVersion).toBe(2);
    expect(migrated.state.protocolVersion).toBe(2);
    expect(migrated.members).toEqual(old.members);
    if (migrated.state.gameType !== 'yacht') throw new Error('Expected Yacht');
    const {
      gameType: _gameType,
      schemaVersion: _schemaVersion,
      protocolVersion: _protocolVersion,
      ...state
    } = migrated.state;
    expect({ ...state, players: state.players.map(({ kind: _kind, ...p }) => p) }).toEqual(
      old.state,
    );
    expect(migrateStoredRoom(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    expect(old).toEqual(legacy);
  });
  it('resumes the existing seat and executes a legacy command without rerolling stored faces', () => {
    const room = migrateStoredRoom(fixture());
    if (room.state.gameType !== 'yacht') throw new Error('Expected Yacht');
    const faces = room.state.dice.map((d) => d.value);
    const now = room.state.updatedAt;
    connect(room, 'legacy-player-0', 'legacy-session-0', 'restored-connection', now);
    applyCommand(
      room,
      'legacy-player-0',
      'legacy-session-0',
      {
        type: 'hold',
        held: [true, false, false, false, false],
        requestId: 'restored-request',
        gameId: room.state.gameId,
        expectedVersion: room.state.version,
        turnId: room.state.turnId,
      },
      {
        now: Math.max(now, room.state.inputAfter),
        uuid: () => crypto.randomUUID(),
        die: () => {
          throw new Error('No RNG during migration or hold');
        },
      },
    );
    expect(room.state.dice.map((d) => d.value)).toEqual(faces);
    expect(room.state.dice[0].held).toBe(true);
    expect(room.state.gameId).toBe(legacy.state.gameId);
    expect(room.state.players[0].seat).toBe(legacy.state.players[0].seat);
  });
  it('refuses unknown, mixed, incomplete and corrupt formats without rewriting them', () => {
    const variants: unknown[] = [null, [], {}, { ...fixture(), extra: 1 }];
    for (const edit of [
      (r: Record<string, unknown>) => {
        r.gameType = 'future-game';
      },
      (r: Record<string, unknown>) => {
        r.gameType = 'yacht';
      },
      (r: Record<string, unknown>) => {
        r.schemaVersion = 999;
      },
      (r: Record<string, unknown>) => {
        r.rulesVersion = 'unrecognized-yacht-rules';
      },
      (r: Record<string, unknown>) => {
        delete r.previews;
      },
      (r: Record<string, unknown>) => {
        r.dice = [{ id: 0, value: 9, held: false }];
      },
      (r: Record<string, unknown>) => {
        r.turnPlayerId = 'missing-player';
      },
    ]) {
      const value = fixture();
      edit(value.state);
      variants.push(value);
    }
    const score = fixture();
    score.state.players[0].total++;
    variants.push(score);
    const missingMember = fixture() as { state: unknown; members: Record<string, unknown> };
    missingMember.members = {};
    variants.push(missingMember);
    for (const value of variants) {
      const before = JSON.stringify(value);
      expect(() => migrateStoredRoom(value)).toThrow('보존');
      expect(JSON.stringify(value)).toBe(before);
    }
  });
  it('upgrades a legacy receipt snapshot with the same faces, score and revision', () => {
    const state = migratePublicState(fixture().state);
    if (state.gameType !== 'yacht') throw new Error('Expected Yacht');
    expect(state.dice).toEqual(legacy.state.dice);
    expect(state.version).toBe(legacy.state.version);
    expect(state.results).toEqual(legacy.state.results);
    const malformed = {
      ...fixture().state,
      gameType: 'tikatuka',
      schemaVersion: 2,
      protocolVersion: 2,
    };
    expect(() => migratePublicState(malformed)).toThrow('보존');
  });
});
