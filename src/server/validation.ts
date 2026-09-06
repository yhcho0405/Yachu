import { CATEGORIES, PROTOCOL_VERSION, type Command } from '../shared/protocol';
import { GameError } from './errors';
import { isGameType, type GameType } from '../shared/games';

export const MAX_BODY_BYTES = 4096;

export const CLIENT_PROTOCOL_HEADER = 'X-Game-Protocol';
export type ClientProtocol = typeof PROTOCOL_VERSION | undefined;
const refreshRequired = () =>
  new GameError(
    'PROTOCOL_REFRESH',
    '이 게임을 계속하려면 화면을 새로고침해 주세요. 기존 경기와 참가 자리는 유지됩니다.',
    409,
  );
/** Public compatibility metadata only; authentication remains the same cookie/CSRF flow. */
export function readClientProtocol(request: Request): ClientProtocol {
  const url = new URL(request.url);
  const header = request.headers.get(CLIENT_PROTOCOL_HEADER);
  const query = url.pathname.endsWith('/ws') ? url.searchParams.getAll('protocolVersion') : [];
  if (query.length > 1) throw refreshRequired();
  for (const value of [header, ...query])
    if (value !== null && value !== String(PROTOCOL_VERSION)) throw refreshRequired();
  return header !== null || query.length > 0 ? PROTOCOL_VERSION : undefined;
}
/** Legacy clients may receive Yacht snapshots only. Check before joining or mutating a room. */
export function requireGameProtocol(gameType: GameType, protocol: ClientProtocol): void {
  if (protocol === PROTOCOL_VERSION || (protocol === undefined && gameType === 'yacht')) return;
  throw refreshRequired();
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GameError('INVALID_REQUEST', '요청 형식이 올바르지 않습니다.', 400);
  return value as Record<string, unknown>;
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new GameError('INVALID_REQUEST', '요청 항목이 올바르지 않습니다.', 400);
}
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);
export function parseCreateRoom(value: unknown): { gameType: GameType; solo: boolean } {
  const body = object(value);
  if (Object.keys(body).length === 0) return { gameType: 'yacht', solo: false };
  exactKeys(body, ['gameType', 'solo']);
  if (!isGameType(body.gameType) || typeof body.solo !== 'boolean')
    throw new GameError('INVALID_GAME', '게임과 시작 방식을 확인해 주세요.', 400);
  return { gameType: body.gameType, solo: body.solo };
}
export function parseCommand(value: unknown): Command {
  const body = object(value);
  if (typeof body.type !== 'string')
    throw new GameError('INVALID_REQUEST', '지원하지 않는 동작입니다.', 400);
  const modern = Object.hasOwn(body, 'gameType') || Object.hasOwn(body, 'protocolVersion');
  if (modern && body.protocolVersion !== 2)
    throw new GameError(
      'PROTOCOL_REFRESH',
      '경기와 좌석은 유지됩니다. 새로고침 후 계속해 주세요.',
      409,
    );
  if (modern && !isGameType(body.gameType))
    throw new GameError('INVALID_GAME', '게임 종류를 확인해 주세요.', 400);
  const keys = ['type', 'requestId', 'gameId', 'expectedVersion', 'turnId'];
  if (modern) keys.push('gameType', 'protocolVersion');
  const common = ['ready', 'start', 'rematch', 'leave'];
  const yacht = ['roll', 'hold', 'score'];
  const tika = [
    'tika_place',
    'tika_reroll',
    'tika_choose',
    'tika_hold',
    'tika_declare',
    'tika_respond',
  ];
  if (
    !common.includes(body.type) &&
    !(modern && body.gameType === 'tikatuka' ? tika : yacht).includes(body.type)
  )
    throw new GameError('WRONG_GAME_TYPE', '이 게임에서 사용할 수 없는 동작입니다.', 400);
  if (body.type === 'ready') keys.push('ready');
  if (body.type === 'hold') keys.push('held');
  if (body.type === 'score') keys.push('category');
  if (body.type === 'tika_place') keys.push('ownerId', 'lane');
  if (body.type === 'tika_choose') keys.push('choice');
  if (body.type === 'tika_respond') keys.push('accept');
  exactKeys(body, keys);
  if (
    !identifier(body.requestId) ||
    !identifier(body.gameId) ||
    !identifier(body.turnId) ||
    !Number.isSafeInteger(body.expectedVersion) ||
    (body.expectedVersion as number) < 0
  )
    throw new GameError('INVALID_REQUEST', '요청 식별자가 올바르지 않습니다.', 400);
  if (body.type === 'ready' && typeof body.ready !== 'boolean')
    throw new GameError('INVALID_REQUEST', '준비 상태가 올바르지 않습니다.', 400);
  if (
    body.type === 'hold' &&
    (!Array.isArray(body.held) ||
      body.held.length !== 5 ||
      body.held.some((value) => typeof value !== 'boolean'))
  )
    throw new GameError('INVALID_REQUEST', '보관할 주사위가 올바르지 않습니다.', 400);
  if (body.type === 'score' && !CATEGORIES.includes(body.category as never))
    throw new GameError('INVALID_REQUEST', '점수 항목이 올바르지 않습니다.', 400);
  if (
    body.type === 'tika_place' &&
    (!identifier(body.ownerId) ||
      !Number.isInteger(body.lane) ||
      (body.lane as number) < 0 ||
      (body.lane as number) > 2)
  )
    throw new GameError('INVALID_REQUEST', '배치할 보드와 라인을 확인해 주세요.', 400);
  if (body.type === 'tika_choose' && !['original', 'rerolled'].includes(body.choice as string))
    throw new GameError('INVALID_REQUEST', '주사위 후보를 선택해 주세요.', 400);
  if (body.type === 'tika_respond' && typeof body.accept !== 'boolean')
    throw new GameError('INVALID_REQUEST', '선언에 대한 응답을 확인해 주세요.', 400);
  return body as unknown as Command;
}
/** Key-order independent, strict schema prevents unbound payload fields. */
export function canonicalCommand(command: Command): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(command).sort(([a], [b]) => a.localeCompare(b))),
  );
}
export function nickname(value: unknown): string {
  if (typeof value !== 'string')
    throw new GameError('INVALID_NICKNAME', '닉네임을 입력해 주세요.', 400);
  const clean = value.trim().normalize('NFC');
  if ([...clean].length < 1 || [...clean].length > 16 || /[\p{Cc}\p{Cf}<>]/u.test(clean))
    throw new GameError(
      'INVALID_NICKNAME',
      '닉네임은 특수 제어문자 없이 1~16자로 입력해 주세요.',
      400,
    );
  return clean;
}
export function roomCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-HJ-NP-Z2-9]{8}$/.test(value))
    throw new GameError('INVALID_CODE', '방 코드 8자리를 확인해 주세요.', 400);
  return value;
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new GameError('INVALID_REQUEST', 'JSON 요청이 필요합니다.', 415);
  const size = request.headers.get('content-length');
  if (size && Number(size) > MAX_BODY_BYTES)
    throw new GameError('TOO_LARGE', '요청이 너무 큽니다.', 413);
  if (!request.body) throw new GameError('INVALID_REQUEST', '요청 내용이 없습니다.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new GameError('TOO_LARGE', '요청이 너무 큽니다.', 413);
    }
    chunks.push(part.value);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as unknown;
  } catch {
    throw new GameError('INVALID_JSON', '요청을 읽을 수 없습니다.', 400);
  }
}
export function requireOrigin(request: Request): void {
  const url = new URL(request.url);
  if (
    request.headers.get('origin') !== url.origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new GameError('BAD_ORIGIN', '같은 사이트에서만 요청할 수 있습니다.', 403);
}
