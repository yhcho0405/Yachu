import type { Command, ServerMessage } from '../shared/protocol';
import {
  applyCommand,
  applyComputerTurn,
  GameError,
  member,
  recipientState,
  type EngineClock,
  type StoredRoom,
} from './engine';
import { canonicalCommand } from './validation';
import { migratePublicState, migrateStoredRoom } from './migration';

export interface SqlAdapter {
  exec(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): Record<string, unknown>[] };
}
export interface StorageAdapter {
  sql: SqlAdapter;
  transactionSync<T>(callback: () => T): T;
}
/** All cursors are consumed synchronously and no room state is cached in memory. */
export class RoomStore {
  constructor(private storage: StorageAdapter) {
    storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS room (singleton INTEGER PRIMARY KEY CHECK(singleton=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (player_id TEXT NOT NULL, game_id TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(player_id, game_id, request_id));
      CREATE INDEX IF NOT EXISTS requests_expiry ON requests(created_at);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS revoked_sessions (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);
  }
  load(): StoredRoom | null {
    const row = this.storage.sql.exec('SELECT data FROM room WHERE singleton=1').toArray()[0];
    if (!row) return null;
    let value: unknown;
    try {
      value = JSON.parse(row.data as string) as unknown;
    } catch {
      throw new GameError(
        'STORED_STATE_INVALID',
        '저장된 경기 형식을 확인할 수 없습니다. 경기 데이터는 보존되어 있습니다.',
        503,
      );
    }
    return migrateStoredRoom(value);
  }
  save(room: StoredRoom): void {
    this.storage.sql.exec(
      'INSERT INTO room(singleton,data) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET data=excluded.data',
      JSON.stringify(room),
    );
  }
  transaction<T>(work: () => T): T {
    return this.storage.transactionSync(work);
  }
  assertNotRevoked(key: string): void {
    if (
      this.storage.sql.exec('SELECT 1 AS revoked FROM revoked_sessions WHERE key=?', key).toArray()
        .length
    )
      throw new GameError('UNAUTHORIZED', '세션이 폐기되었습니다.', 401);
  }
  rate(key: string, now: number, maximum: number, windowMs: number): void {
    const row = this.storage.sql
      .exec('SELECT window_start,count FROM rate_limits WHERE key=?', key)
      .toArray()[0];
    const fresh = !row || now >= Number(row.window_start) + windowMs;
    if (!fresh && Number(row.count) >= maximum)
      throw new GameError('RATE_LIMITED', '입력이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', 429);
    this.storage.sql.exec(
      'INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=excluded.count',
      key,
      fresh ? now : Number(row.window_start),
      fresh ? 1 : Number(row.count) + 1,
    );
  }
  process(
    playerId: string,
    sessionKey: string,
    command: Command,
    clock: EngineClock,
  ): ServerMessage {
    return this.transaction(() => {
      this.assertNotRevoked(sessionKey);
      const room = this.load();
      if (!room) throw new GameError('ROOM_NOT_FOUND', '방을 찾을 수 없거나 만료되었습니다.', 404);
      // Identity was revalidated at registry before this synchronous transaction.
      // Deduplication precedes game/version/seat-state checks, including leave and rematch.
      const auth = room.members[playerId];
      if (!auth || auth.sessionKey !== sessionKey)
        throw new GameError('NOT_MEMBER', '이 방의 참가자가 아닙니다.', 403);
      const payload = canonicalCommand(command);
      const previous = this.storage.sql
        .exec(
          'SELECT payload,response FROM requests WHERE player_id=? AND game_id=? AND request_id=?',
          playerId,
          command.gameId,
          command.requestId,
        )
        .toArray()[0];
      if (previous) {
        if (previous.payload !== payload)
          throw new GameError('REQUEST_ID_REUSED', '요청 번호가 다른 동작에 사용되었습니다.', 409);
        const response = JSON.parse(previous.response as string) as ServerMessage;
        if (response.state) response.state = migratePublicState(response.state);
        if (
          response.state?.gameType === 'avalon' &&
          response.state.privateInfo &&
          response.state.privateInfo.playerId !== playerId
        )
          throw new GameError(
            'STORED_STATE_INVALID',
            '저장된 응답의 수신자를 확인할 수 없습니다.',
            503,
          );
        return response;
      }
      member(room, playerId, sessionKey);
      this.rate(`command:${playerId}`, clock.now, 60, 10_000);
      this.rate('room-command', clock.now, 180, 10_000);
      if (command.type === 'av_chat') {
        this.rate(`chat:${playerId}`, clock.now, 30, 60_000);
        this.rate(`chat-gap:${playerId}`, clock.now, 1, 800);
      }
      if (command.type === 'av_signal') {
        this.rate(`signal:${playerId}`, clock.now, 12, 60_000);
        this.rate(`signal-gap:${playerId}`, clock.now, 1, 1500);
      }
      const count = this.storage.sql.exec('SELECT COUNT(*) AS count FROM requests').toArray()[0];
      if (Number(count?.count) >= 50_000)
        throw new GameError(
          'ROOM_LIMIT',
          '방의 기록 한도에 도달했습니다. 새 방을 만들어 주세요.',
          429,
        );
      applyCommand(room, playerId, sessionKey, command, clock);
      const response: ServerMessage = {
        type: 'result',
        requestId: command.requestId,
        state: recipientState(room, playerId),
      };
      this.save(room);
      this.storage.sql.exec(
        'INSERT INTO requests(player_id,game_id,request_id,payload,response,created_at) VALUES(?,?,?,?,?,?)',
        playerId,
        command.gameId,
        command.requestId,
        payload,
        JSON.stringify(response),
        clock.now,
      );
      return response;
    });
  }
  /** Durable one-step AI dispatch: state, generated faces and receipt share one commit. */
  processComputer(clock: EngineClock): boolean {
    return this.transaction(() => {
      const room = this.load();
      if (!room || room.state.gameType !== 'tikatuka') return false;
      const before = room.state;
      const requestId = `ai-${before.turnId}-${before.version}`;
      const gameId = before.gameId;
      const playerId = before.players.find((p) => p.kind === 'computer')?.id;
      if (!playerId) return false;
      const payload = JSON.stringify({
        type: 'server_ai',
        version: before.version,
        turnId: before.turnId,
      });
      if (
        this.storage.sql
          .exec(
            'SELECT 1 AS processed FROM requests WHERE player_id=? AND game_id=? AND request_id=?',
            playerId,
            gameId,
            requestId,
          )
          .toArray().length
      )
        return false;
      if (!applyComputerTurn(room, clock)) return false;
      const response: ServerMessage = { type: 'result', requestId, state: room.state };
      this.save(room);
      this.storage.sql.exec(
        'INSERT INTO requests(player_id,game_id,request_id,payload,response,created_at) VALUES(?,?,?,?,?,?)',
        playerId,
        gameId,
        requestId,
        payload,
        JSON.stringify(response),
        clock.now,
      );
      return true;
    });
  }
  cleanup(now: number): void {
    // Successful current-game request IDs remain until the entire room expires.
    // Previous games are rejected by gameId after their 24-hour result retention.
    const current = this.load()?.state.gameId ?? '';
    this.storage.sql.exec(
      'DELETE FROM requests WHERE created_at < ? AND game_id <> ?',
      now - 86_400_000,
      current,
    );
    this.storage.sql.exec('DELETE FROM rate_limits WHERE window_start < ?', now - 60_000);
    this.storage.sql.exec('DELETE FROM revoked_sessions WHERE expires_at<=?', now);
  }
}
