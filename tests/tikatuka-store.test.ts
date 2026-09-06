import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Command, CommonIntent } from '../src/shared/protocol';
import type { TikatukaIntent } from '../src/shared/tikatuka';
import { addComputer, connect, joinRoom, newRoom } from '../src/server/engine';
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
const databases: DatabaseSync[] = [];
const directories: string[] = [];
const uuid = () => crypto.randomUUID();
const neverRoll = () => {
  throw new Error('must not generate another die');
};
afterEach(() => {
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      /* closed for restart */
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function diskFile() {
  mkdirSync('work/test-sqlite', { recursive: true });
  const directory = mkdtempSync('work/test-sqlite/tikatuka-');
  directories.push(directory);
  return join(directory, 'room.sqlite');
}
function setup(filename = ':memory:', computer = false) {
  const db = new DatabaseSync(filename);
  databases.push(db);
  const adapter = new SQLiteAdapter(db);
  const store = new RoomStore(adapter);
  if (!store.load()) {
    const room = newRoom(uuid(), 'ABCDEFGH', 1_000_000, uuid, 'tikatuka');
    joinRoom(room, 'one', '동일', 'session-one', 1_000_000);
    connect(room, 'one', 'session-one', 'connection-one', 1_000_000);
    if (computer) addComputer(room, 1_000_000, uuid);
    else {
      joinRoom(room, 'two', '동일', 'session-two', 1_000_000);
      connect(room, 'two', 'session-two', 'connection-two', 1_000_000);
    }
    store.save(room);
  }
  const read = () => {
    const room = store.load();
    if (room?.state.gameType !== 'tikatuka') throw new Error('Expected Tikatuka');
    return { ...room, state: room.state };
  };
  const command = (intent: CommonIntent | TikatukaIntent): Command => {
    const state = read().state;
    return {
      ...intent,
      gameType: 'tikatuka',
      protocolVersion: 2,
      requestId: uuid(),
      gameId: state.gameId,
      turnId: state.turnId,
      expectedVersion: state.version,
    };
  };
  const send = (
    cmd: Command,
    playerId = read().state.turnPlayerId ?? 'one',
    die = () => 1,
    now = Math.max(1_100_000, read().state.inputAfter),
  ) => {
    const result = store.process(playerId, `session-${playerId}`, cmd, { now, uuid, die });
    if (result.state?.gameType !== 'tikatuka') throw new Error('Expected Tikatuka result');
    return { ...result, state: result.state };
  };
  const start = (faces = [1, 6]) => {
    if (!computer) send(command({ type: 'ready', ready: true }), 'two');
    return send(command({ type: 'start' }), 'one', () => faces.shift() ?? 6);
  };
  const rows = () => ({
    rates: db.prepare('SELECT * FROM rate_limits ORDER BY key').all(),
    receipts: db.prepare('SELECT * FROM requests ORDER BY request_id').all(),
  });
  return { db, store, adapter, command, send, start, read, rows };
}
function beforeAttack(t: ReturnType<typeof setup>) {
  t.start();
  t.send(t.command({ type: 'tika_place', ownerId: 'one', lane: 0 }), 'one', () => 5);
  t.send(t.command({ type: 'tika_place', ownerId: 'two', lane: 1 }), 'two', () => 5);
  return t.command({ type: 'tika_place', ownerId: 'two', lane: 1 });
}

describe('Tikatuka SQLite commits and recovery', () => {
  it('restores the already generated attack bonus and original receipt after replacing the database connection', () => {
    const filename = diskFile();
    const first = setup(filename);
    const attack = beforeAttack(first);
    let draws = 0;
    const receipt = first.send(attack, 'one', () => {
      draws++;
      return 2;
    });
    expect(draws).toBe(1);
    expect(receipt.state.pendingDie).toMatchObject({ value: 2, source: 'bonus', kind: 'shield' });
    expect(receipt.state.players[1]!.lanes[1]).toEqual([]);
    first.db.close();
    const restored = setup(filename);
    expect(restored.read().state).toEqual(receipt.state);
    expect(restored.send(attack, 'one', neverRoll)).toEqual(receipt);
    expect(() => restored.send({ ...attack, requestId: uuid() }, 'one', neverRoll)).toThrow(
      '다른 변경',
    );
    expect(() =>
      restored.store.process('one', 'wrong-session', attack, {
        now: 1_200_000,
        uuid,
        die: neverRoll,
      }),
    ).toThrow('참가자');
    restored.send(
      restored.command({ type: 'tika_place', ownerId: 'two', lane: 2 }),
      'one',
      () => 4,
    );
    expect(restored.read().state.players[1]!.lanes[2][0]).toMatchObject({
      value: 2,
      kind: 'shield',
    });
  });
  it('rolls back removal, bonus RNG result, versions, limits and receipts when the final write fails', () => {
    const t = setup();
    const attack = beforeAttack(t);
    const before = t.read();
    const rows = t.rows();
    t.adapter.failReceipts = true;
    expect(() => t.send(attack, 'one', () => 6)).toThrow('disk failure');
    expect(t.read()).toEqual(before);
    expect(t.rows()).toEqual(rows);
    t.adapter.failReceipts = false;
    const receipt = t.send(attack, 'one', () => 3);
    expect(receipt.state.version).toBe(before.state.version + 1);
    expect(receipt.state.pendingDie).toMatchObject({ source: 'bonus', value: 3 });
    expect(t.send(attack, 'one', neverRoll)).toEqual(receipt);
  });
  it('preserves both reroll candidates, single-use skill and selected original die through two reloads', () => {
    const filename = diskFile();
    const first = setup(filename);
    first.start();
    const reroll = first.command({ type: 'tika_reroll' });
    const receipt = first.send(reroll, 'one', () => 2);
    const original = receipt.state.rerollChoices!.original;
    first.db.close();
    const second = setup(filename);
    expect(second.send(reroll, 'one', neverRoll)).toEqual(receipt);
    expect(second.read().state.rerollChoices).toEqual(receipt.state.rerollChoices);
    const choose = second.command({ type: 'tika_choose', choice: 'original' });
    const selected = second.send(choose, 'one', neverRoll);
    second.db.close();
    const third = setup(filename);
    expect(third.send(choose, 'one', neverRoll)).toEqual(selected);
    expect(third.read().state.pendingDie).toEqual(original);
    expect(third.read().state.players[0]!.rerollUsed).toBe(true);
    expect(() => third.send(third.command({ type: 'tika_reroll' }), 'one', neverRoll)).toThrow(
      '사용할 수 없습니다',
    );
  });
  it('serializes competing placements and choices, while duplicate retries preserve exactly one transition', async () => {
    const t = setup();
    t.start();
    const reroll = t.command({ type: 'tika_reroll' });
    const placement = t.command({ type: 'tika_place', ownerId: 'one', lane: 0 });
    const race = await Promise.allSettled([
      Promise.resolve().then(() => t.send(reroll, 'one', () => 2)),
      Promise.resolve().then(() => t.send(placement, 'one', neverRoll)),
    ]);
    expect(race.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    const choose = t.command({ type: 'tika_choose', choice: 'rerolled' });
    const duplicate = await Promise.all([
      Promise.resolve().then(() => t.send(choose, 'one', neverRoll)),
      Promise.resolve().then(() => t.send(choose, 'one', neverRoll)),
    ]);
    expect(duplicate[0]).toEqual(duplicate[1]);
    expect(t.read().state.pendingDie?.value).toBe(2);
    expect(() => t.send({ ...choose, choice: 'original' } as Command, 'one', neverRoll)).toThrow(
      '요청 번호',
    );
  });
  it('rejects a legacy Yacht envelope without changing the preserved Tikatuka game', () => {
    const t = setup();
    t.start();
    const before = t.read();
    const legacy: Command = {
      type: 'roll',
      requestId: uuid(),
      expectedVersion: before.state.version,
      gameId: before.state.gameId,
      turnId: before.state.turnId,
    };
    expect(() => t.send(legacy, 'one', neverRoll)).toThrow('새로고침');
    expect(t.read()).toEqual(before);
  });
  it('recovers AI deadlines and commits one reroll/choice per alarm without giving its seat a credential', () => {
    const filename = diskFile();
    const first = setup(filename, true);
    first.start([6, 1]);
    const before = first.read();
    const ai = before.state.players.find((p) => p.kind === 'computer')!;
    expect(before.members[ai.id]).toBeUndefined();
    const due = before.state.aiDueAt!;
    expect(first.store.processComputer({ now: due - 1, uuid, die: neverRoll })).toBe(false);
    first.adapter.failReceipts = true;
    expect(() => first.store.processComputer({ now: due, uuid, die: () => 6 })).toThrow(
      'disk failure',
    );
    expect(first.read()).toEqual(before);
    first.db.close();
    const second = setup(filename, true);
    expect(second.store.processComputer({ now: due, uuid, die: () => 6 })).toBe(true);
    const choosing = second.read().state;
    expect(choosing.stage).toBe('choosingReroll');
    expect(choosing.rerollChoices?.rerolled.value).toBe(6);
    expect(second.store.processComputer({ now: due, uuid, die: neverRoll })).toBe(false);
    second.db.close();
    const third = setup(filename, true);
    expect(third.read().state).toEqual(choosing);
    expect(third.store.processComputer({ now: choosing.aiDueAt!, uuid, die: neverRoll })).toBe(
      true,
    );
    expect(third.read().state.pendingDie?.value).toBe(6);
    expect(third.store.processComputer({ now: choosing.aiDueAt!, uuid, die: neverRoll })).toBe(
      false,
    );
    const aiReceipts = third.db
      .prepare('SELECT COUNT(*) AS count FROM requests WHERE player_id=?')
      .get(ai.id);
    expect(aiReceipts?.count).toBe(2);
    expect(() =>
      third.store.process(ai.id, 'invented-session', third.command({ type: 'tika_hold' }), {
        now: due + 10_000,
        uuid,
        die: neverRoll,
      }),
    ).toThrow('참가자');
  });
});
