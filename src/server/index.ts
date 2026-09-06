import { COMMIT } from '../shared/build';
import type { Session } from '../shared/protocol';
import { cookieHeader, keyedHash, randomToken, readCookie, requireSecret } from './crypto';
import { GameError } from './engine';
import { failure, json, SECURITY_HEADERS } from './response';
import { SESSION_MS } from './registry';
import type { AuthSession, Env } from './types';
import {
  CLIENT_PROTOCOL_HEADER,
  exactKeys,
  nickname,
  object,
  parseCreateRoom,
  readClientProtocol,
  readJson,
  requireGameProtocol,
  requireOrigin,
  roomCode,
} from './validation';
export { GameRoom } from './room';
export { SessionRegistry } from './registry';

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') {
    requireSecret(env.SESSION_SECRET);
    return json({ ok: true, commit: COMMIT });
  }
  if (!url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/internal/'))
      return json({ error: '요청한 경로를 찾을 수 없습니다.' }, 404);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  if (
    url.pathname !== '/api/session' &&
    url.pathname !== '/api/rooms' &&
    url.pathname !== '/api/join' &&
    !/^\/api\/rooms\/[^/]+(?:\/(command|ws))?$/.test(url.pathname)
  )
    throw new GameError('NOT_FOUND', '요청한 경로를 찾을 수 없습니다.', 404);
  requireSecret(env.SESSION_SECRET);
  const registry = env.REGISTRY.getByName('global-v1');
  const ipHash = await keyedHash(
    env.SESSION_SECRET,
    'rate-ip',
    request.headers.get('cf-connecting-ip') ?? 'local',
  );
  async function rate(bucket: string, limit: number, window = 60_000): Promise<void> {
    if (!(await registry.rate(bucket, limit, window)))
      throw new GameError('RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429);
  }
  const token = readCookie(request);
  const key = token ? await keyedHash(env.SESSION_SECRET, 'session', token) : null;
  let auth: AuthSession | null = null;
  if (url.pathname === '/api/session') {
    await rate(`auth:${ipHash}`, 60);
    if (key) auth = await registry.authenticate(key);
    if (request.method === 'POST') {
      requireOrigin(request);
      const body = object(await readJson(request));
      exactKeys(body, ['nickname']);
      const name = nickname(body.nickname);
      if (auth && token)
        return json({
          ...auth,
          csrfToken: await keyedHash(env.SESSION_SECRET, 'csrf', token),
        } satisfies Session);
      const issued = randomToken();
      const digest = await keyedHash(env.SESSION_SECRET, 'session', issued);
      const session = await registry.createSession(digest, name);
      return json(
        {
          ...session,
          csrfToken: await keyedHash(env.SESSION_SECRET, 'csrf', issued),
        } satisfies Session,
        201,
        { 'Set-Cookie': cookieHeader(issued, SESSION_MS / 1000) },
      );
    }
    if (!auth || !key || !token)
      throw new GameError('UNAUTHORIZED', '게스트 세션이 필요합니다.', 401);
    if (request.method === 'GET')
      return json({
        ...auth,
        csrfToken: await keyedHash(env.SESSION_SECRET, 'csrf', token),
      } satisfies Session);
    if (request.method === 'DELETE') {
      requireOrigin(request);
      if (
        request.headers.get('x-csrf-token') !== (await keyedHash(env.SESSION_SECRET, 'csrf', token))
      )
        throw new GameError('BAD_CSRF', '요청 인증을 확인해 주세요.', 403);
      const rooms = await registry.revoke(key);
      await Promise.all(rooms.map((roomId) => env.ROOMS.getByName(roomId).revoke(key)));
      return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });
    }
    throw new GameError('METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식입니다.', 405);
  }
  if (!key || !token) throw new GameError('UNAUTHORIZED', '먼저 닉네임을 입력해 주세요.', 401);
  await rate(`request:${key}`, 360);
  auth = await registry.authenticate(key);
  if (!auth) throw new GameError('UNAUTHORIZED', '세션이 만료되었습니다. 다시 시작해 주세요.', 401);
  if (request.method !== 'GET') {
    requireOrigin(request);
    if (
      request.headers.get('x-csrf-token') !== (await keyedHash(env.SESSION_SECRET, 'csrf', token))
    )
      throw new GameError('BAD_CSRF', '요청 인증을 확인해 주세요.', 403);
  }
  const clientProtocol = readClientProtocol(request);
  async function forward(roomId: string, action: string, body?: unknown): Promise<Response> {
    const headers = new Headers();
    headers.set('x-dice-session-key', key!);
    if (clientProtocol !== undefined) headers.set(CLIENT_PROTOCOL_HEADER, String(clientProtocol));
    const origin = request.headers.get('origin');
    if (origin) headers.set('origin', origin);
    if (request.headers.get('upgrade')) headers.set('upgrade', request.headers.get('upgrade')!);
    if (body !== undefined) headers.set('content-type', 'application/json');
    return env.ROOMS.getByName(roomId).fetch(
      new Request(`${url.origin}/internal/${action}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    await rate(`create:${key}`, 6, 3_600_000);
    await rate(`create-ip:${ipHash}`, 30, 3_600_000);
    const options = parseCreateRoom(await readJson(request));
    requireGameProtocol(options.gameType, clientProtocol);
    const room = await registry.reserveRoom();
    await registry.trackRoom(key, room.roomId);
    return forward(room.roomId, 'create', { ...room, ...options });
  }
  if (url.pathname === '/api/join' && request.method === 'POST') {
    await rate(`join:${key}`, 30);
    await rate(`join-ip:${ipHash}`, 60);
    const body = object(await readJson(request));
    exactKeys(body, ['code']);
    const code = roomCode(body.code);
    const roomId = await registry.lookup(code);
    if (!roomId) throw new GameError('ROOM_NOT_FOUND', '방을 찾을 수 없거나 만료되었습니다.', 404);
    await registry.trackRoom(key, roomId);
    return forward(roomId, 'join', {});
  }
  const match = /^\/api\/rooms\/([^/]+)(?:\/(command|ws))?$/.exec(url.pathname);
  if (match) {
    const code = roomCode(match[1]);
    const action = match[2] ?? 'state';
    if (
      (action === 'command' && request.method !== 'POST') ||
      (action !== 'command' && request.method !== 'GET')
    )
      throw new GameError('METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식입니다.', 405);
    if (action === 'ws') {
      requireOrigin(request);
      await rate(`ws-connect:${key}`, 30);
    }
    await rate(`lookup:${key}`, 180);
    const roomId = await registry.lookup(code);
    if (!roomId) throw new GameError('ROOM_NOT_FOUND', '방을 찾을 수 없거나 만료되었습니다.', 404);
    return forward(roomId, action, action === 'command' ? await readJson(request) : undefined);
  }
  throw new GameError('NOT_FOUND', '요청한 경로를 찾을 수 없습니다.', 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      return failure(error);
    }
  },
} satisfies ExportedHandler<Env>;
