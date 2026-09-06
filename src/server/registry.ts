import { DurableObject } from 'cloudflare:workers';
import { GameError } from './engine';
import { randomCode, requireSecret } from './crypto';
import type { AuthSession, Env } from './types';

export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
/** Only credential digests, code routing and global rate buckets live here. */
export class SessionRegistry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, player_id TEXT NOT NULL, nickname TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, room_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rates (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS session_rooms (session_key TEXT NOT NULL, room_id TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(session_key,room_id));
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS codes_expiry ON codes(expires_at);`);
  }
  async createSession(key: string, nickname: string): Promise<AuthSession> {
    requireSecret(this.env.SESSION_SECRET);
    const now = Date.now();
    const session = { playerId: crypto.randomUUID(), nickname, expiresAt: now + SESSION_MS };
    this.ctx.storage.sql.exec(
      'INSERT INTO sessions(key,player_id,nickname,expires_at) VALUES(?,?,?,?)',
      key,
      session.playerId,
      nickname,
      session.expiresAt,
    );
    await this.ensureAlarm();
    return session;
  }
  authenticate(key: string): AuthSession | null {
    requireSecret(this.env.SESSION_SECRET);
    const row = this.ctx.storage.sql
      .exec(
        'SELECT player_id,nickname,expires_at FROM sessions WHERE key=? AND revoked=0 AND expires_at>?',
        key,
        Date.now(),
      )
      .toArray()[0];
    return row
      ? {
          playerId: String(row.player_id),
          nickname: String(row.nickname),
          expiresAt: Number(row.expires_at),
        }
      : null;
  }
  revoke(key: string): string[] {
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('UPDATE sessions SET revoked=1 WHERE key=?', key);
      return this.ctx.storage.sql
        .exec('SELECT room_id FROM session_rooms WHERE session_key=?', key)
        .toArray()
        .map((row) => String(row.room_id));
    });
  }
  trackRoom(key: string, roomId: string): void {
    if (!this.authenticate(key)) throw new GameError('UNAUTHORIZED', '세션이 만료되었습니다.', 401);
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO session_rooms(session_key,room_id,expires_at) VALUES(?,?,?)',
      key,
      roomId,
      Date.now() + SESSION_MS,
    );
  }
  async reserveRoom(): Promise<{ roomId: string; code: string }> {
    const roomId = crypto.randomUUID();
    const now = Date.now();
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomCode();
      const inserted = this.ctx.storage.sql
        .exec(
          'INSERT OR IGNORE INTO codes(code,room_id,expires_at) VALUES(?,?,?) RETURNING code',
          code,
          roomId,
          now + SESSION_MS,
        )
        .toArray();
      if (inserted.length) {
        await this.ensureAlarm();
        return { roomId, code };
      }
    }
    throw new GameError('SERVICE_BUSY', '잠시 후 방을 다시 만들어 주세요.', 503);
  }
  lookup(code: string): string | null {
    const row = this.ctx.storage.sql
      .exec('SELECT room_id FROM codes WHERE code=? AND expires_at>?', code, Date.now())
      .toArray()[0];
    return row ? String(row.room_id) : null;
  }
  async rate(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const allowed = this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec('SELECT window_start,count FROM rates WHERE key=?', key)
        .toArray()[0];
      const fresh = !row || now >= Number(row.window_start) + windowMs;
      if (!fresh && Number(row.count) >= limit) return false;
      this.ctx.storage.sql.exec(
        'INSERT INTO rates(key,window_start,count) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=excluded.count',
        key,
        fresh ? now : Number(row.window_start),
        fresh ? 1 : Number(row.count) + 1,
      );
      return true;
    });
    await this.ensureAlarm();
    return allowed;
  }
  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + 3_600_000);
  }
  async alarm(): Promise<void> {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires_at<=?', now);
      this.ctx.storage.sql.exec('DELETE FROM codes WHERE expires_at<=?', now);
      this.ctx.storage.sql.exec('DELETE FROM session_rooms WHERE expires_at<=?', now);
      this.ctx.storage.sql.exec('DELETE FROM rates WHERE window_start<?', now - 3_600_000);
    });
    const any = this.ctx.storage.sql
      .exec(
        'SELECT 1 AS present FROM sessions UNION ALL SELECT 1 FROM codes UNION ALL SELECT 1 FROM rates LIMIT 1',
      )
      .toArray().length;
    if (any) await this.ctx.storage.setAlarm(now + 3_600_000);
  }
}
