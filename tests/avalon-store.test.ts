import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Command, CommonIntent } from '../src/shared/protocol';
import { avalonAlignment, type AvalonGameIntent, type AvalonIntent } from '../src/shared/avalon';
import {
  connect,
  depart,
  disconnect,
  expireGrace,
  joinRoom,
  newRoom,
  recipientState,
} from '../src/server/engine';
import { migratePublicState, migrateStoredRoom } from '../src/server/migration';
import { parseCommand, parseCreateRoom } from '../src/server/validation';
import { RoomStore, type StorageAdapter } from '../src/server/store';

class Adapter implements StorageAdapter {
  failReceipt = false;
  constructor(public db: DatabaseSync) {}
  sql = {
    exec: (query: string, ...values: (string | number | null)[]) => {
      if (this.failReceipt && query.startsWith('INSERT INTO requests'))
        throw new Error('disk failure');
      if (query.trim().split(';').filter(Boolean).length > 1) {
        this.db.exec(query);
        return { toArray: () => [] };
      }
      const rows = this.db.prepare(query).all(...values) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
  transactionSync<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
const databases: DatabaseSync[] = [],
  directories: string[] = [];
const uuid = () => crypto.randomUUID();
const noRandom = () => {
  throw new Error('unexpected random draw');
};
afterEach(() => {
  databases.splice(0).forEach((db) => {
    try {
      db.close();
    } catch {
      /* closed to reopen */
    }
  });
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});
function setup(count = 5, filename = ':memory:') {
  const db = new DatabaseSync(filename);
  databases.push(db);
  const adapter = new Adapter(db),
    store = new RoomStore(adapter);
  let now = 1_100_000;
  if (!store.load()) {
    const room = newRoom(uuid(), 'ABCDEFGH', 1_000_000, uuid, 'avalon');
    for (let i = 0; i < count; i++) {
      const id = `player-${String(i).padStart(2, '0')}`;
      joinRoom(room, id, `원탁 ${i + 1}`, `session-${id}`, 1_000_000);
      connect(room, id, `session-${id}`, `socket-${id}`, 1_000_000);
    }
    store.save(room);
  }
  const read = () => {
    const room = store.load();
    if (room?.state.gameType !== 'avalon') throw Error('expected Avalon');
    return { ...room, state: room.state };
  };
  const command = (intent: CommonIntent | AvalonIntent): Command => {
    const state = read().state;
    return {
      ...intent,
      gameType: 'avalon',
      protocolVersion: 3,
      requestId: uuid(),
      gameId: state.gameId,
      turnId: state.turnId,
      expectedVersion: state.version,
    };
  };
  const scoped = (intent: Omit<AvalonGameIntent, 'phaseId' | 'proposalId'>) => {
    const state = read().state;
    return command({
      ...intent,
      phaseId: state.phaseId,
      proposalId: state.proposal?.id ?? null,
    } as AvalonIntent);
  };
  const send = (cmd: Command, playerId: string, die: () => number = noRandom) => {
    now += 1600;
    const result = store.process(playerId, `session-${playerId}`, cmd, { now, uuid, die });
    if (result.state?.gameType !== 'avalon') throw Error('expected recipient Avalon');
    expect(result.state).not.toHaveProperty('secrets');
    expect(result.state.privateInfo?.playerId ?? playerId).toBe(playerId);
    return { ...result, state: result.state };
  };
  const ids = () => read().state.players.map((player) => player.id);
  const start = () => {
    for (const id of ids().slice(1)) send(command({ type: 'ready', ready: true }), id);
    return send(command({ type: 'start' }), ids()[0]!, () => 1);
  };
  const propose = () => {
    const state = read().state;
    return send(
      scoped({ type: 'av_team', teamIds: ids().slice(0, count === 5 ? 2 : 3) } as Omit<
        AvalonGameIntent,
        'phaseId' | 'proposalId'
      >),
      state.leaderId!,
    );
  };
  return { db, adapter, store, read, command, scoped, send, ids, start, propose, now: () => now };
}

describe('Avalon authority, SQLite and recipient boundaries', () => {
  it('binds lobby readiness to the displayed configuration without rejecting concurrent readiness', () => {
    const t = setup();
    const oldReady = t.command({ type: 'ready', ready: true });
    const config = t.scoped({
      type: 'av_config',
      config: { optionalRoles: ['morgana'], ladyOfLake: false },
    } as Omit<AvalonGameIntent, 'phaseId' | 'proposalId'>);
    const configured = t.send(config, t.ids()[0]!);
    expect(() => t.send(oldReady, t.ids()[1]!)).toThrow('설정이나 진행 단계');
    expect(t.read().state.players[1]!.ready).toBe(false);
    const ready = t
      .ids()
      .slice(1)
      .map(() => t.command({ type: 'ready', ready: true }));
    ready.forEach((cmd, i) => t.send(cmd, t.ids()[i + 1]!));
    expect(
      t
        .read()
        .state.players.slice(1)
        .every((player) => player.ready),
    ).toBe(true);
    const reordered = {
      ...config,
      config: { ladyOfLake: false, optionalRoles: ['morgana'] },
    } as Command;
    expect(t.send(reordered, t.ids()[0]!)).toEqual(configured);
  });

  it('keeps all ten simultaneous votes valid despite chat and earlier submissions, and resolves the last race once', async () => {
    const t = setup(10);
    t.start();
    t.propose();
    const before = t.read().state;
    const commands = t
      .ids()
      .map(() =>
        t.scoped({ type: 'av_vote', approve: true } as Omit<
          AvalonGameIntent,
          'phaseId' | 'proposalId'
        >),
      );
    t.send(t.command({ type: 'av_chat', text: '<b>제안에 찬성합니다</b>' }), t.ids()[0]!);
    const first = await Promise.all(
      commands.slice(0, 8).map((cmd, i) => Promise.resolve().then(() => t.send(cmd, t.ids()[i]!))),
    );
    for (const result of first) {
      expect(result.state.stage).toBe('vote');
      expect(result.state.history.proposals).toHaveLength(0);
      expect(result.state.privateInfo?.myVote).toBe(true);
    }
    const last = await Promise.all(
      commands.slice(8).map((cmd, i) => Promise.resolve().then(() => t.send(cmd, t.ids()[i + 8]!))),
    );
    expect(t.read().state.stage).toBe('quest');
    expect(t.read().state.phaseId).not.toBe(before.phaseId);
    expect(t.read().state.history.proposals).toHaveLength(1);
    expect(t.read().state.history.proposals[0]!.votes).toHaveLength(10);
    expect(t.send(commands[9]!, t.ids()[9]!)).toEqual(last[1]);
    expect(() => t.send({ ...commands[9]!, requestId: uuid() }, t.ids()[9]!)).toThrow();
    expect(() => t.send({ ...commands[9]!, approve: false } as Command, t.ids()[9]!)).toThrow(
      '요청 번호',
    );
  });

  it('stores private cards atomically and publishes only anonymous counts after the final card', () => {
    const t = setup();
    t.start();
    t.propose();
    const votes = t
      .ids()
      .map(() =>
        t.scoped({ type: 'av_vote', approve: true } as Omit<
          AvalonGameIntent,
          'phaseId' | 'proposalId'
        >),
      );
    votes.forEach((cmd, i) => t.send(cmd, t.ids()[i]!));
    const state = t.read().state,
      team = state.proposal!.teamIds;
    const cards = team.map(() =>
      t.scoped({ type: 'av_quest', card: 'success' } as Omit<
        AvalonGameIntent,
        'phaseId' | 'proposalId'
      >),
    );
    t.send(cards[0]!, team[0]!);
    const observer = t.ids().find((id) => !team.includes(id))!;
    const view = recipientState(t.read(), observer);
    expect(JSON.stringify(view)).not.toContain('questCards');
    if (view.gameType !== 'avalon') throw Error('expected Avalon');
    expect(view.privateInfo?.myQuestCard).toBeNull();
    expect(view.history.quests).toHaveLength(0);
    const beforeFinal = t.read(),
      receipts = t.db.prepare('SELECT COUNT(*) AS count FROM requests').get();
    t.adapter.failReceipt = true;
    expect(() => t.send(cards[1]!, team[1]!)).toThrow('disk failure');
    expect(t.read()).toEqual(beforeFinal);
    expect(t.db.prepare('SELECT COUNT(*) AS count FROM requests').get()).toEqual(receipts);
    t.adapter.failReceipt = false;
    const final = t.send(cards[1]!, team[1]!);
    expect(final.state.history.quests[0]).toMatchObject({
      successCount: 2,
      failCount: 0,
      failed: false,
    });
    expect(Object.keys(final.state.history.quests[0]!)).not.toContain('cards');
    expect(t.read().state.secrets.questCards).toEqual({});
    expect(final.state.privateInfo?.myQuestCard).toBeNull();
    expect(t.send(cards[1]!, team[1]!)).toEqual(final);
  });

  it('recovers roles, a committed private vote and the exact authorized receipt after reopening SQLite', () => {
    mkdirSync('work/test-sqlite', { recursive: true });
    const directory = mkdtempSync('work/test-sqlite/avalon-');
    directories.push(directory);
    const filename = join(directory, 'room.sqlite');
    const t = setup(5, filename);
    t.start();
    t.propose();
    const voter = t.ids()[0]!,
      cmd = t.scoped({ type: 'av_vote', approve: false } as Omit<
        AvalonGameIntent,
        'phaseId' | 'proposalId'
      >);
    const response = t.send(cmd, voter),
      internal = t.read();
    t.db.close();
    const restored = setup(5, filename);
    expect(restored.read()).toEqual(internal);
    expect(restored.send(cmd, voter)).toEqual(response);
    expect(() =>
      restored.store.process(voter, 'wrong-session', cmd, { now: 2_000_000, uuid, die: noRandom }),
    ).toThrow();
    for (const id of restored.ids()) {
      const view = recipientState(restored.read(), id);
      expect(view).not.toHaveProperty('secrets');
      if (view.gameType !== 'avalon') throw Error('expected Avalon');
      expect(view.privateInfo?.playerId).toBe(id);
      expect(view.privateInfo?.myVote).toBe(id === voter ? false : null);
    }
  });

  it('voids departures or exhausted reconnect grace without changing teams or revealing roles', () => {
    const t = setup();
    t.start();
    const room = t.read(),
      ids = t.ids(),
      beforeRoles = structuredClone(room.state.secrets.roles);
    disconnect(room, ids[0]!, `socket-${ids[0]}`, t.now());
    expect(expireGrace(room, t.now() + 119_999, uuid)).toBe(false);
    expect(expireGrace(room, t.now() + 120_000, uuid)).toBe(true);
    expect(room.state).toMatchObject({
      phase: 'finished',
      stage: 'finished',
      winner: null,
      finishReason: 'disconnected',
      revealedRoles: [],
    });
    expect(room.state.players.map((p) => p.id)).toEqual(ids);
    expect(room.state.secrets.roles).toEqual(beforeRoles);
    expect(recipientState(room, ids[1]!)).not.toHaveProperty('secrets');
    const other = setup();
    other.start();
    const leaving = other.read();
    depart(leaving, other.ids()[0]!, other.now(), uuid);
    expect(leaving.state).toMatchObject({
      winner: null,
      finishReason: 'player_left',
      revealedRoles: [],
    });
  });

  it('rejects oversized chat, duplicate opinions, old protocols and client-forged role fields without mutation', () => {
    const t = setup();
    t.start();
    expect(() => parseCreateRoom({ gameType: 'avalon', solo: true })).toThrow('5~10');
    const cmd = t.command({ type: 'av_chat', text: '토론을 시작합시다.' });
    expect(parseCommand(cmd)).toEqual(cmd);
    const before = t.read();
    for (const bad of [
      { ...cmd, text: 'a'.repeat(301) },
      { ...cmd, role: 'merlin' },
      { ...cmd, protocolVersion: 2 },
    ])
      expect(() => parseCommand(bad)).toThrow();
    expect(t.read()).toEqual(before);
    const id = t.ids()[0]!;
    const response = t.send(cmd, id);
    expect(t.send(cmd, id)).toEqual(response);
    expect(() => t.send({ ...cmd, requestId: uuid() }, id)).toThrow('같은 글');
    expect(() => migratePublicState(t.read().state)).toThrow('저장된');
    const publicState = recipientState(t.read(), id);
    expect(() => migrateStoredRoom({ ...t.read(), state: publicState })).toThrow('저장된');
    const invalid = structuredClone(t.read());
    invalid.state.players[0]!.seat = 10;
    expect(() => migrateStoredRoom(invalid)).toThrow('저장된');
    expect(avalonAlignment(t.read().state.secrets.roles[id]!)).toBe(
      response.state.privateInfo!.alignment,
    );
  });
});
