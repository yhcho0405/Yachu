import { CATEGORIES, PROTOCOL_VERSION, type Command } from '../shared/protocol';
import { GameError } from './errors';
import { isGameType, type GameType } from '../shared/games';

export const MAX_BODY_BYTES = 4096;

export const CLIENT_PROTOCOL_HEADER = 'X-Game-Protocol';
export type ClientProtocol = 2 | typeof PROTOCOL_VERSION | undefined;
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
  const versions = [header, ...query].filter((value): value is string => value !== null);
  if (
    versions.some((value) => value !== '2' && value !== String(PROTOCOL_VERSION)) ||
    new Set(versions).size > 1
  )
    throw refreshRequired();
  return versions.length ? (Number(versions[0]) as 2 | typeof PROTOCOL_VERSION) : undefined;
}
/** Legacy clients may receive Yacht snapshots only. Check before joining or mutating a room. */
export function requireGameProtocol(gameType: GameType, protocol: ClientProtocol): void {
  if (
    protocol === PROTOCOL_VERSION ||
    (protocol === 2 && gameType !== 'avalon') ||
    (protocol === undefined && gameType === 'yacht')
  )
    return;
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
  if (body.gameType === 'avalon' && body.solo)
    throw new GameError(
      'NO_SOLO_MODE',
      '아발론은 5~10명이 함께 플레이합니다. 온라인 방을 만들어 주세요.',
      400,
    );
  return { gameType: body.gameType, solo: body.solo };
}
export function parseCommand(value: unknown): Command {
  const body = object(value);
  if (typeof body.type !== 'string')
    throw new GameError('INVALID_REQUEST', '지원하지 않는 동작입니다.', 400);
  const modern = Object.hasOwn(body, 'gameType') || Object.hasOwn(body, 'protocolVersion');
  if (modern && body.protocolVersion !== 2 && body.protocolVersion !== PROTOCOL_VERSION)
    throw new GameError(
      'PROTOCOL_REFRESH',
      '경기와 좌석은 유지됩니다. 새로고침 후 계속해 주세요.',
      409,
    );
  if (modern && !isGameType(body.gameType))
    throw new GameError('INVALID_GAME', '게임 종류를 확인해 주세요.', 400);
  if (body.gameType === 'avalon' && body.protocolVersion !== PROTOCOL_VERSION)
    throw refreshRequired();
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
  const avalon = [
    'av_config',
    'av_team',
    'av_vote',
    'av_quest',
    'av_lady',
    'av_assassinate',
    'av_chat',
    'av_signal',
  ];
  if (
    !common.includes(body.type) &&
    !(
      modern && body.gameType === 'avalon'
        ? avalon
        : modern && body.gameType === 'tikatuka'
          ? tika
          : yacht
    ).includes(body.type)
  )
    throw new GameError('WRONG_GAME_TYPE', '이 게임에서 사용할 수 없는 동작입니다.', 400);
  if (body.type === 'ready') keys.push('ready');
  if (body.type === 'hold') keys.push('held');
  if (body.type === 'score') keys.push('category');
  if (body.type === 'tika_place') keys.push('ownerId', 'lane');
  if (body.type === 'tika_choose') keys.push('choice');
  if (body.type === 'tika_respond') keys.push('accept');
  if (body.type.startsWith('av_') && body.type !== 'av_chat' && body.type !== 'av_signal')
    keys.push('phaseId', 'proposalId');
  if (body.type === 'av_config') keys.push('config');
  if (body.type === 'av_team') keys.push('teamIds');
  if (body.type === 'av_vote') keys.push('approve');
  if (body.type === 'av_quest') keys.push('card');
  if (body.type === 'av_lady' || body.type === 'av_assassinate') keys.push('targetId');
  if (body.type === 'av_chat') keys.push('text');
  if (body.type === 'av_signal') keys.push('targetId', 'kind');
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
  if (body.type.startsWith('av_')) validateAvalonFields(body);
  return body as unknown as Command;
}
function validateAvalonFields(body: Record<string, unknown>): void {
  const invalid = () => {
    throw new GameError('INVALID_REQUEST', '아발론 동작의 내용을 확인해 주세요.', 400);
  };
  if (
    body.type !== 'av_chat' &&
    body.type !== 'av_signal' &&
    (!identifier(body.phaseId) || (body.proposalId !== null && !identifier(body.proposalId)))
  )
    invalid();
  if (body.type === 'av_config') {
    const config = object(body.config);
    exactKeys(config, ['optionalRoles', 'ladyOfLake']);
    if (
      !Array.isArray(config.optionalRoles) ||
      config.optionalRoles.length > 4 ||
      config.optionalRoles.some(
        (role) => !['percival', 'morgana', 'mordred', 'oberon'].includes(role),
      ) ||
      new Set(config.optionalRoles).size !== config.optionalRoles.length ||
      typeof config.ladyOfLake !== 'boolean'
    )
      invalid();
  }
  if (
    body.type === 'av_team' &&
    (!Array.isArray(body.teamIds) ||
      body.teamIds.length > 5 ||
      body.teamIds.length < 1 ||
      body.teamIds.some((id) => !identifier(id)) ||
      new Set(body.teamIds).size !== body.teamIds.length)
  )
    invalid();
  if (body.type === 'av_vote' && typeof body.approve !== 'boolean') invalid();
  if (body.type === 'av_quest' && !['success', 'fail'].includes(body.card as string)) invalid();
  if (
    ['av_lady', 'av_assassinate', 'av_signal'].includes(body.type as string) &&
    !identifier(body.targetId)
  )
    invalid();
  if (
    body.type === 'av_signal' &&
    !['question', 'speak', 'trust', 'suspect', 'agree'].includes(body.kind as string)
  )
    invalid();
  if (
    body.type === 'av_chat' &&
    (typeof body.text !== 'string' ||
      [...body.text.trim()].length < 1 ||
      [...body.text].length > 300 ||
      /[\p{Cc}\p{Cf}]/u.test(body.text.replace(/[\n\t]/g, '')))
  )
    invalid();
}
/** Key-order independent, strict schema prevents unbound payload fields. */
export function canonicalCommand(command: Command): string {
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, ordered(child)]),
          )
        : value;
  return JSON.stringify(ordered(command));
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
