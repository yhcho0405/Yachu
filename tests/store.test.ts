import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  LegacyYachtCommand as Command,
  YachtIntent as Intent,
  YachtRoomState,
} from '../src/shared/protocol';
import { connect, joinRoom, newRoom } from '../src/server/engine';
import { RoomStore, type StorageAdapter } from '../src/server/store';

class SQLiteAdapter implements StorageAdapter {
  failReceipts = false;
  constructor(public db: DatabaseSync) {}
  sql = {
    exec: (query: string, ...bindings: (string | number | null)[]) => {
      if (this.failReceipts && query.startsWith('INSERT INTO requests'))
        throw new Error('simulated disk failure');
      if (query.trim().split(';').filter(Boolean).length > 1) {
        this.db.exec(query);
        return { toArray: () => [] };
      }
      const rows = this.db.prepare(query).all(...bindings) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
  transactionSync<T>(callback: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
const uuid = () => crypto.randomUUID();
const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed for restart test */
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function setup(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  databases.push(db);
  const adapter = new SQLiteAdapter(db);
  const store = new RoomStore(adapter);
  if (!store.load()) {
    const room = newRoom(uuid(), 'ABCDEFGH', 1_000_000, uuid);
    joinRoom(room, 'player-0', '주인', 'session-0', 1_000_000);
    connect(room, 'player-0', 'session-0', 'connection-0', 1_000_000);
    store.save(room);
  }
  const read = () => {
    const room = store.load();
    if (room && room.state.gameType !== 'yacht') throw new Error('Expected a Yacht room');
    return room as { state: YachtRoomState; members: NonNullable<typeof room>['members'] } | null;
  };
  const command = (intent: Intent): Command => {
    const state = store.load()!.state;
    return {
      ...intent,
      requestId: uuid(),
      gameId: state.gameId,
      turnId: state.turnId,
      expectedVersion: state.version,
    };
  };
  const send = (cmd: Command, now = 1_100_000, die = () => 1) => {
    const result = store.process('player-0', 'session-0', cmd, { now, uuid, die });
    if (result.state?.gameType !== 'yacht') throw new Error('Expected a Yacht result');
    return { ...result, state: result.state };
  };
  return { db, adapter, store, command, send, read };
}
describe('SQLite transaction and request receipts', () => {
  it('returns original roll on retry before stale version checks, without calling RNG twice', () => {
    const t = setup();
    t.send(t.command({ type: 'start' }));
    let calls = 0;
    const cmd = t.command({ type: 'roll' });
    const first = t.send(cmd, 1_200_000, () => {
      calls++;
      return 6;
    });
    const retry = t.send(cmd, 1_202_000, () => {
      throw new Error('must not draw again');
    });
    expect(retry).toEqual(first);
    expect(calls).toBe(5);
    expect(t.read()!.state.rolls).toBe(1);
    expect(() => t.send({ ...cmd, type: 'score', category: 'yacht' }, 1_202_000)).toThrow(
      '요청 번호',
    );
    expect(() => t.send({ ...cmd, requestId: uuid() }, 1_202_000)).toThrow('다른 변경');
  });
  it('rolls back state, versions, rate rows and receipts together on storage failure', () => {
    const t = setup();
    t.send(t.command({ type: 'start' }));
    const before = t.read();
    const cmd = t.command({ type: 'roll' });
    t.adapter.failReceipts = true;
    expect(() => t.send(cmd, 1_200_000, () => 6)).toThrow('disk failure');
    expect(t.read()).toEqual(before);
    t.adapter.failReceipts = false;
    const result = t.send(cmd, 1_202_000, () => 3);
    expect(result.state!.dice.map((die) => die.value)).toEqual([3, 3, 3, 3, 3]);
    expect(result.state!.rolls).toBe(1);
  });
  it('persists dice, identity, turns and dedup after actual SQLite connection replacement', () => {
    mkdirSync('work/test-sqlite', { recursive: true });
    const directory = mkdtempSync('work/test-sqlite/restart-');
    directories.push(directory);
    const filename = join(directory, 'room.sqlite');
    const first = setup(filename);
    first.send(first.command({ type: 'start' }));
    const cmd = first.command({ type: 'roll' });
    const result = first.send(cmd, 1_200_000, () => 4);
    first.db.close();
    const restored = setup(filename);
    expect(restored.read()!.state).toEqual(result.state);
    expect(
      restored.send(cmd, 1_204_000, () => {
        throw new Error('must not regenerate');
      }),
    ).toEqual(result);
    expect(() =>
      restored.store.process('player-0', 'wrong-session', cmd, {
        now: 1_204_000,
        uuid,
        die: () => 1,
      }),
    ).toThrow('참가자');
  });
  it('serializes competing hold/roll and duplicate score requests to one version', async () => {
    const t = setup();
    t.send(t.command({ type: 'start' }));
    t.send(t.command({ type: 'roll' }));
    const hold = t.command({ type: 'hold', held: [true, false, false, false, false] });
    const roll = t.command({ type: 'roll' });
    const racing = await Promise.allSettled([
      Promise.resolve().then(() => t.send(hold, 1_102_000)),
      Promise.resolve().then(() => t.send(roll, 1_102_000)),
    ]);
    expect(racing.map((value) => value.status)).toEqual(['fulfilled', 'rejected']);
    expect(t.read()!.state.rolls).toBe(1);
    const score = t.command({ type: 'score', category: 'yacht' });
    const duplicates = await Promise.all([
      Promise.resolve().then(() => t.send(score, 1_104_000)),
      Promise.resolve().then(() => t.send(score, 1_104_000)),
    ]);
    expect(duplicates[0]).toEqual(duplicates[1]);
    expect(t.read()!.state.players[0]!.scores.yacht).toBe(50);
    expect(t.read()!.state.rolls).toBe(0);
  });
  it('retains receipts for a departed identity but local revocation overrides every receipt', () => {
    const t = setup();
    const cmd = t.command({ type: 'leave' });
    const response = t.send(cmd);
    expect(t.send(cmd)).toEqual(response);
    t.adapter.sql
      .exec('INSERT INTO revoked_sessions(key,expires_at) VALUES(?,?)', 'session-0', 2_000_000)
      .toArray();
    expect(() => t.send(cmd)).toThrow('폐기');
  });
  it('persists limits through repository reconstruction and resets expired windows', () => {
    const t = setup();
    t.store.rate('attempt', 1000, 2, 1000);
    new RoomStore(t.adapter).rate('attempt', 1001, 2, 1000);
    expect(() => new RoomStore(t.adapter).rate('attempt', 1002, 2, 1000)).toThrow('너무 빠릅니다');
    expect(() => new RoomStore(t.adapter).rate('attempt', 2000, 2, 1000)).not.toThrow();
  });
});
