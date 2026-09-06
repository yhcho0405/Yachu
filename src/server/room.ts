import { DurableObject } from 'cloudflare:workers';
import type { ServerMessage } from '../shared/protocol';
import {
  connect,
  addComputer,
  depart,
  disconnect,
  expireGrace,
  GameError,
  joinRoom,
  member,
  newRoom,
  recipientState,
  type StoredRoom,
} from './engine';
import { cryptoDie, requireSecret } from './crypto';
import { RoomStore } from './store';
import { failure, json } from './response';
import {
  MAX_BODY_BYTES,
  parseCommand,
  readClientProtocol,
  readJson,
  requireGameProtocol,
  requireOrigin,
  type ClientProtocol,
} from './validation';
import type { AuthSession, Env } from './types';
import type { GameType } from '../shared/games';

interface Connection {
  playerId: string;
  sessionKey: string;
  connectionId: string;
  expiresAt: number;
  protocolVersion?: ClientProtocol;
}
export class GameRoom extends DurableObject<Env> {
  private store: RoomStore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new RoomStore(ctx.storage);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // Attachments survive hibernation; missing connections after restart start grace.
    ctx.blockConcurrencyWhile(async () => {
      const live = new Set(
        ctx
          .getWebSockets()
          .map((socket) => (socket.deserializeAttachment() as Connection | null)?.connectionId),
      );
      this.store.transaction(() => {
        const room = this.store.load();
        if (!room) return;
        for (const [id, auth] of Object.entries(room.members)) {
          if (auth.connectionId && !live.has(auth.connectionId))
            disconnect(room, id, auth.connectionId, Date.now());
        }
        // Persist the validated v1-to-v2 conversion in this same transaction.
        this.store.save(room);
      });
      await this.schedule();
    });
  }
  private async auth(key: string): Promise<AuthSession> {
    requireSecret(this.env.SESSION_SECRET);
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new GameError('UNAUTHORIZED', '게스트 세션이 필요합니다.', 401);
    const session = await this.env.REGISTRY.getByName('global-v1').authenticate(key);
    if (!session)
      throw new GameError(
        'UNAUTHORIZED',
        '세션이 만료되었습니다. 첫 화면에서 다시 시작해 주세요.',
        401,
      );
    return session;
  }
  private maintain(now: number): StoredRoom | null {
    return this.store.transaction(() => {
      const room = this.store.load();
      if (!room) return null;
      if (room.state.expiresAt <= now) {
        this.ctx.storage.sql.exec(
          'DELETE FROM room; DELETE FROM requests; DELETE FROM rate_limits;',
        );
        return null;
      }
      if (expireGrace(room, now, () => crypto.randomUUID())) this.store.save(room);
      return room;
    });
  }
  private async schedule(): Promise<void> {
    const room = this.store.load();
    if (!room) {
      const deadline = this.ctx.storage.sql
        .exec('SELECT MIN(expires_at) AS expiry FROM revoked_sessions')
        .toArray()[0]?.expiry;
      if (deadline) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Number(deadline)));
      else await this.ctx.storage.deleteAlarm();
      return;
    }
    const deadlines = [
      room.state.expiresAt,
      ...(room.state.gameType === 'tikatuka' && room.state.aiDueAt !== null
        ? [room.state.aiDueAt]
        : []),
      ...room.state.players.flatMap((player) =>
        player.graceDeadline === null ? [] : [player.graceDeadline],
      ),
      ...this.ctx.getWebSockets().flatMap((socket) => {
        const a = socket.deserializeAttachment() as Connection | null;
        return a ? [a.expiresAt] : [];
      }),
    ];
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
  }
  private send(socket: WebSocket, message: ServerMessage): void {
    if (message.state) {
      const attachment = socket.deserializeAttachment() as Connection | null;
      try {
        requireGameProtocol(message.state.gameType, attachment?.protocolVersion);
        if (
          message.state.gameType === 'avalon' &&
          message.state.privateInfo &&
          message.state.privateInfo.playerId !== attachment?.playerId
        )
          throw new GameError(
            'RECIPIENT_MISMATCH',
            '현재 참가자의 상태를 다시 확인해 주세요.',
            503,
          );
      } catch (error) {
        message = {
          type: 'error',
          code: 'PROTOCOL_REFRESH',
          error: (error as GameError).message,
          ...(message.requestId ? { requestId: message.requestId } : {}),
        };
      }
    }
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* close/error callback persists disconnect */
    }
  }
  private broadcast(): void {
    const room = this.store.load();
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const a = socket.deserializeAttachment() as Connection | null;
      const auth = a ? room?.members[a.playerId] : undefined;
      if (
        !a ||
        !room ||
        !auth ||
        auth.departed ||
        auth.connectionId !== a.connectionId ||
        a.expiresAt <= now
      ) {
        try {
          socket.close(4001, '연결 권한이 만료되었습니다.');
        } catch {
          /* already closed */
        }
        continue;
      }
      this.send(socket, { type: 'state', state: recipientState(room, a.playerId) });
    }
  }
  private errorMessage(
    error: unknown,
    key: string,
    playerId: string,
    requestId?: string,
    authenticated = true,
    clientProtocol?: ClientProtocol,
  ): ServerMessage {
    const room = this.store.load();
    const compatible =
      room &&
      (clientProtocol === 3 ||
        (clientProtocol === 2 && room.state.gameType !== 'avalon') ||
        (clientProtocol === undefined && room.state.gameType === 'yacht'));
    const permitted =
      compatible &&
      authenticated &&
      !(error instanceof GameError && error.code === 'UNAUTHORIZED') &&
      room &&
      room.members[playerId]?.sessionKey === key &&
      !room.members[playerId]?.departed;
    return {
      type: 'error',
      ...(requestId ? { requestId } : {}),
      code: error instanceof GameError ? error.code : 'SERVER_ERROR',
      error:
        error instanceof GameError
          ? error.message
          : '요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      ...(permitted ? { state: recipientState(room, playerId) } : {}),
    };
  }
  async fetch(request: Request): Promise<Response> {
    let session: AuthSession | undefined;
    const key = request.headers.get('x-dice-session-key') ?? '';
    try {
      session = await this.auth(key);
      const path = new URL(request.url).pathname;
      const clientProtocol = readClientProtocol(request);
      const now = Date.now();
      const beforeMaintenance = this.store.load();
      if (beforeMaintenance) requireGameProtocol(beforeMaintenance.state.gameType, clientProtocol);
      const maintained = this.maintain(now);
      const maintenanceChanged =
        beforeMaintenance?.state.version !== maintained?.state.version ||
        beforeMaintenance?.state.presenceVersion !== maintained?.state.presenceVersion;
      if (path === '/internal/create') {
        const body = (await readJson(request)) as {
          roomId: string;
          code: string;
          gameType: GameType;
          solo: boolean;
        };
        requireGameProtocol(body.gameType, clientProtocol);
        this.store.transaction(() => {
          this.store.assertNotRevoked(key);
          if (this.store.load()) throw new GameError('ROOM_EXISTS', '이미 만들어진 방입니다.');
          const room = newRoom(
            body.roomId,
            body.code,
            now,
            () => crypto.randomUUID(),
            body.gameType,
          );
          joinRoom(room, session!.playerId, session!.nickname, key, now);
          if (body.gameType === 'tikatuka' && body.solo)
            addComputer(room, now, () => crypto.randomUUID());
          this.store.save(room);
        });
      } else if (path === '/internal/join') {
        this.store.transaction(() => {
          this.store.assertNotRevoked(key);
          const room = this.store.load();
          if (!room)
            throw new GameError('ROOM_NOT_FOUND', '방을 찾을 수 없거나 만료되었습니다.', 404);
          joinRoom(room, session!.playerId, session!.nickname, key, now);
          this.store.save(room);
        });
      } else if (path === '/internal/ws') {
        requireOrigin(request);
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
          throw new GameError('UPGRADE_REQUIRED', 'WebSocket 연결이 필요합니다.', 426);
        return this.ctx.blockConcurrencyWhile(async () => {
          try {
            const maximumConnections = beforeMaintenance?.state.gameType === 'avalon' ? 20 : 8;
            if (this.ctx.getWebSockets().length >= maximumConnections)
              throw new GameError(
                'CONNECTION_LIMIT',
                '이전 연결이 닫히는 중입니다. 잠시 후 다시 접속해 주세요.',
                429,
              );
            const connectionId = crypto.randomUUID();
            this.store.transaction(() => {
              this.store.assertNotRevoked(key);
              const room = this.store.load();
              if (!room)
                throw new GameError('ROOM_NOT_FOUND', '방을 찾을 수 없거나 만료되었습니다.', 404);
              connect(room, session!.playerId, key, connectionId, Date.now());
              this.store.save(room);
            });
            await this.ctx.storage.sync();
            for (const old of this.ctx.getWebSockets()) {
              const a = old.deserializeAttachment() as Connection | null;
              if (a?.playerId === session!.playerId) {
                this.send(old, {
                  type: 'replaced',
                  error: '다른 탭에서 연결되어 이 탭의 연결이 닫혔습니다.',
                });
                old.close(4000, '다른 탭에서 연결되었습니다.');
              }
            }
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
            this.ctx.acceptWebSocket(server, [session!.playerId]);
            server.serializeAttachment({
              playerId: session!.playerId,
              sessionKey: key,
              connectionId,
              expiresAt: session!.expiresAt,
              protocolVersion: clientProtocol,
            } satisfies Connection);
            await this.schedule();
            this.broadcast();
            return new Response(null, { status: 101, webSocket: client });
          } catch (error) {
            // Expected rejections must not escape blockConcurrencyWhile: the runtime
            // resets an object on an uncaught exception in that callback.
            if (error instanceof GameError) return failure(error);
            throw error;
          }
        });
      } else if (path === '/internal/command') {
        const command = parseCommand(await readJson(request));
        let result: ServerMessage;
        try {
          result = this.store.process(session.playerId, key, command, {
            now: Date.now(),
            die: cryptoDie,
            uuid: () => crypto.randomUUID(),
          });
        } catch (error) {
          return json(
            this.errorMessage(
              error,
              key,
              session.playerId,
              command.requestId,
              true,
              clientProtocol,
            ),
            error instanceof GameError ? error.status : 503,
          );
        }
        await this.ctx.storage.sync();
        await this.schedule();
        this.broadcast();
        return json(result);
      } else if (path !== '/internal/state')
        throw new GameError('NOT_FOUND', '요청한 경로를 찾을 수 없습니다.', 404);
      const room = this.store.load();
      if (!room) throw new GameError('ROOM_NOT_FOUND', '방을 찾을 수 없거나 만료되었습니다.', 404);
      member(room, session.playerId, key);
      await this.ctx.storage.sync();
      await this.schedule();
      if (path !== '/internal/state' || maintenanceChanged) this.broadcast();
      return json({ state: recipientState(room, session.playerId) });
    } catch (error) {
      if (session) this.broadcast();
      return failure(error);
    }
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = socket.deserializeAttachment() as Connection | null;
    if (!a) {
      socket.close(4001, '인증이 필요합니다.');
      return;
    }
    let requestId: string | undefined;
    let authenticated = false;
    try {
      const allowed = await this.env.REGISTRY.getByName('global-v1').rate(
        `ws-command:${a.sessionKey}`,
        240,
        60_000,
      );
      if (!allowed)
        throw new GameError(
          'RATE_LIMITED',
          '입력이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.',
          429,
        );
      // Byte limit checked before JSON.parse, binary frames are not a command format.
      if (
        typeof message !== 'string' ||
        message.length > MAX_BODY_BYTES ||
        new TextEncoder().encode(message).length > MAX_BODY_BYTES
      )
        throw new GameError('TOO_LARGE', '메시지가 너무 크거나 형식이 다릅니다.', 413);
      const session = await this.auth(a.sessionKey);
      authenticated = true;
      const room = this.maintain(Date.now());
      if (!room || room.members[session.playerId]?.connectionId !== a.connectionId)
        throw new GameError('CONNECTION_REPLACED', '현재 연결에서 다시 접속해 주세요.', 403);
      requireGameProtocol(room.state.gameType, a.protocolVersion);
      let value: unknown;
      try {
        value = JSON.parse(message) as unknown;
      } catch {
        throw new GameError('INVALID_JSON', '요청을 읽을 수 없습니다.', 400);
      }
      const command = parseCommand(value);
      requestId = command.requestId;
      const result = this.store.process(session.playerId, a.sessionKey, command, {
        now: Date.now(),
        die: cryptoDie,
        uuid: () => crypto.randomUUID(),
      });
      await this.ctx.storage.sync();
      await this.schedule();
      this.send(socket, result);
      this.broadcast();
    } catch (error) {
      this.send(
        socket,
        this.errorMessage(
          error,
          a.sessionKey,
          a.playerId,
          requestId,
          authenticated,
          a.protocolVersion,
        ),
      );
      if (
        error instanceof GameError &&
        ['UNAUTHORIZED', 'CONNECTION_REPLACED', 'TOO_LARGE', 'RATE_LIMITED'].includes(error.code)
      )
        socket.close(4001, '연결을 확인해 주세요.');
    }
  }
  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.closed(socket);
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    await this.closed(socket);
  }
  private async closed(socket: WebSocket): Promise<void> {
    const a = socket.deserializeAttachment() as Connection | null;
    if (!a) return;
    this.store.transaction(() => {
      const room = this.store.load();
      if (room && disconnect(room, a.playerId, a.connectionId, Date.now())) this.store.save(room);
    });
    await this.ctx.storage.sync();
    await this.schedule();
    this.broadcast();
  }
  /** Invoked only by the bound Worker after registry revocation has committed. */
  async revoke(sessionKey: string): Promise<void> {
    this.store.transaction(() => {
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO revoked_sessions(key,expires_at) VALUES(?,?)',
        sessionKey,
        Date.now() + 7 * 86_400_000,
      );
      const room = this.store.load();
      if (!room) return;
      for (const [id, auth] of Object.entries(room.members))
        if (auth.sessionKey === sessionKey)
          depart(room, id, Date.now(), () => crypto.randomUUID(), 'session_expired');
      this.store.save(room);
    });
    await this.ctx.storage.sync();
    await this.schedule();
    this.broadcast();
  }
  async alarm(): Promise<void> {
    const now = Date.now();
    this.maintain(now);
    const expiredKeys = new Set(
      this.ctx
        .getWebSockets()
        .map((socket) => socket.deserializeAttachment() as Connection | null)
        .filter((a): a is Connection => !!a && a.expiresAt <= now)
        .map((a) => a.sessionKey),
    );
    for (const key of expiredKeys) await this.revoke(key);
    this.store.processComputer({ now, die: cryptoDie, uuid: () => crypto.randomUUID() });
    this.store.transaction(() => {
      this.store.cleanup(now);
    });
    await this.ctx.storage.sync();
    await this.schedule();
    this.broadcast();
  }
}
