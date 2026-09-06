import { describe, expect, it, vi } from 'vitest';
import {
  cookieHeader,
  cryptoDie,
  keyedHash,
  randomCode,
  randomToken,
  readCookie,
  requireSecret,
} from '../src/server/crypto';
import {
  canonicalCommand,
  nickname,
  parseCommand,
  readClientProtocol,
  requireGameProtocol,
  readJson,
  requireOrigin,
  roomCode,
} from '../src/server/validation';

const valid = {
  type: 'roll',
  requestId: 'request-123',
  gameId: 'game-1234',
  expectedVersion: 0,
  turnId: 'turn-1234',
};
describe('closed schemas and authentication primitives', () => {
  it('rejects unexpected fields and malformed command shape', () => {
    expect(parseCommand(valid)).toEqual(valid);
    expect(() => parseCommand({ ...valid, type: { toString: null } })).toThrow(
      '지원하지 않는 동작',
    );
    for (const value of [
      null,
      [],
      'roll',
      { ...valid, playerId: 'spoof' },
      { ...valid, dice: [6, 6, 6, 6, 6] },
      { ...valid, expectedVersion: -1 },
      { ...valid, expectedVersion: 1.5 },
      { ...valid, expectedVersion: Infinity },
      { ...valid, type: 'setScore' },
      { ...valid, type: 'hold', held: [true] },
      { ...valid, type: 'hold', held: [true, false, 1, false, true] },
      { ...valid, type: 'score', category: 'joker' },
      { ...valid, type: 'ready', ready: 1 },
      { ...valid, requestId: 'x'.repeat(81) },
    ])
      expect(() => parseCommand(value)).toThrow();
    expect(canonicalCommand(parseCommand(valid))).toBe(
      canonicalCommand(
        parseCommand({
          turnId: valid.turnId,
          expectedVersion: 0,
          gameId: valid.gameId,
          requestId: valid.requestId,
          type: 'roll',
        }),
      ),
    );
  });
  it('enforces exact origin including scheme, host and port', () => {
    for (const origin of [
      'https://attacker.invalid',
      'https://play.example:444',
      'http://play.example',
      'null',
      'https://sub.play.example',
    ])
      expect(() =>
        requireOrigin(
          new Request('https://play.example/api/session', { headers: { Origin: origin } }),
        ),
      ).toThrow('사이트');
    expect(() => requireOrigin(new Request('https://play.example/api/session'))).toThrow('사이트');
    expect(() =>
      requireOrigin(
        new Request('https://play.example/api/session', {
          headers: { Origin: 'https://play.example' },
        }),
      ),
    ).not.toThrow();
  });
  it('checks streamed byte limits before parsing and requires JSON', async () => {
    await expect(
      readJson(
        new Request('https://play.example/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'x'.repeat(4097),
        }),
      ),
    ).rejects.toThrow('너무 큽니다');
    await expect(
      readJson(
        new Request('https://play.example/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '"' + '한'.repeat(1500) + '"',
        }),
      ),
    ).rejects.toThrow('너무 큽니다');
    await expect(
      readJson(new Request('https://play.example/api', { method: 'POST', body: '{}' })),
    ).rejects.toThrow('JSON');
    await expect(
      readJson(
        new Request('https://play.example/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        }),
      ),
    ).rejects.toThrow('읽을');
  });
  it('normalizes nicknames but separates identity from names and codes', () => {
    expect(nickname(' 친구 ')).toBe('친구');
    expect(() => nickname('<script>')).toThrow();
    expect(() => nickname('a\u202eb')).toThrow();
    expect(() => nickname('가'.repeat(17))).toThrow();
    for (let i = 0; i < 100; i++) expect(roomCode(randomCode())).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(() => roomCode('ABCDEFG0')).toThrow();
    expect(() => roomCode('short')).toThrow();
  });
  it('requires configured secret, stores a keyed digest and domain-separates CSRF', async () => {
    expect(() => requireSecret(undefined)).toThrow('인증 설정');
    expect(() => requireSecret('short')).toThrow();
    const secret = 'unit-test-only-secret-value-32-bytes-minimum';
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await keyedHash(secret, 'session', token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
    expect(await keyedHash(secret, 'session', token)).toBe(digest);
    expect(await keyedHash(secret, 'csrf', token)).not.toBe(digest);
    expect(cookieHeader(token, 30)).toContain('HttpOnly; Secure; SameSite=Strict');
    expect(
      readCookie(
        new Request('https://play.example', {
          headers: { cookie: `__Host-dice_session=${token}` },
        }),
      ),
    ).toBe(token);
    expect(
      readCookie(
        new Request('https://play.example', {
          headers: { cookie: `__Host-dice_session=${token}; __Host-dice_session=${token}` },
        }),
      ),
    ).toBeNull();
  });
  it('rejects the biased high tail of the 32-bit RNG range', () => {
    const sequence = [4_294_967_295, 4_294_967_294, 4_294_967_292, 5];
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint32Array)[0] = sequence.shift()!;
      return array;
    });
    try {
      expect(cryptoDie()).toBe(6);
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('client protocol negotiation before room state delivery', () => {
  it('keeps missing-version clients compatible with Yacht only', () => {
    const legacy = readClientProtocol(new Request('https://play.example/api/join'));
    expect(legacy).toBeUndefined();
    expect(() => requireGameProtocol('yacht', legacy)).not.toThrow();
    expect(() => requireGameProtocol('tikatuka', legacy)).toThrow('새로고침');
  });
  it('accepts explicit HTTP and WebSocket version 2 without changing authentication', () => {
    const header = readClientProtocol(
      new Request('https://play.example/api/rooms/ABCDEFGH', {
        headers: { 'X-Game-Protocol': '2' },
      }),
    );
    const socket = readClientProtocol(
      new Request('https://play.example/api/rooms/ABCDEFGH/ws?protocolVersion=2'),
    );
    expect(header).toBe(2);
    expect(socket).toBe(2);
    for (const game of ['yacht', 'tikatuka'] as const)
      expect(() => requireGameProtocol(game, header)).not.toThrow();
  });
  it('requests refresh for every explicit unknown version and ambiguous WS query', () => {
    for (const version of ['', '1', '3', '2, 3']) {
      expect(() =>
        readClientProtocol(
          new Request('https://play.example/api/join', { headers: { 'X-Game-Protocol': version } }),
        ),
      ).toThrow('새로고침');
      expect(() =>
        readClientProtocol(
          new Request(
            'https://play.example/api/rooms/ABCDEFGH/ws?protocolVersion=' +
              encodeURIComponent(version),
          ),
        ),
      ).toThrow('새로고침');
    }
    expect(() =>
      readClientProtocol(
        new Request(
          'https://play.example/api/rooms/ABCDEFGH/ws?protocolVersion=2&protocolVersion=2',
        ),
      ),
    ).toThrow('새로고침');
    expect(() =>
      readClientProtocol(
        new Request('https://play.example/api/rooms/ABCDEFGH/ws?protocolVersion=3', {
          headers: { 'X-Game-Protocol': '2' },
        }),
      ),
    ).toThrow('새로고침');
  });
});
