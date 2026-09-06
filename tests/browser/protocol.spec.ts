import { test, expect, type Page } from '@playwright/test';
import type { RoomState, ServerMessage, Session } from '../../src/shared/protocol';

declare global {
  interface Window {
    protocolSockets?: Record<string, WebSocket>;
    protocolMessages?: Record<string, ServerMessage[]>;
  }
}
type Reply = { status: number; body: ServerMessage & { state?: RoomState } };
async function request(page: Page, path: string, body?: unknown, version?: string): Promise<Reply> {
  return page.evaluate(
    async ({ path, body, version }) => {
      const headers: Record<string, string> =
        version === undefined ? {} : { 'X-Game-Protocol': version };
      if (body !== undefined) {
        const session = (await (await fetch('/api/session')).json()) as Session;
        headers['Content-Type'] = 'application/json';
        headers['X-CSRF-Token'] = session.csrfToken;
      }
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: (await response.json()) as ServerMessage & { state?: RoomState },
      };
    },
    { path, body, version },
  );
}
async function identify(page: Page, name: string) {
  await page.goto('/version.json');
  return page.evaluate(async (nickname) => {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });
    if (!response.ok) throw new Error('Local guest creation failed');
    return ((await response.json()) as Session).playerId;
  }, name);
}
async function snapshot(page: Page, code: string): Promise<RoomState> {
  const response = await request(page, `/api/rooms/${code}`, undefined, '2');
  expect(response.status).toBe(200);
  expect(response.body.state).toBeDefined();
  return response.body.state!;
}
async function connect(page: Page, code: string, label: string, version?: string) {
  return page.evaluate(
    ({ code, label, version }) =>
      new Promise<{ opened: boolean; state?: RoomState }>((resolve, reject) => {
        const url = new URL(`/api/rooms/${code}/ws`, location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        if (version !== undefined) url.searchParams.set('protocolVersion', version);
        window.protocolSockets ??= {};
        window.protocolMessages ??= {};
        const messages: ServerMessage[] = [];
        window.protocolMessages[label] = messages;
        const socket = new WebSocket(url);
        window.protocolSockets[label] = socket;
        let opened = false;
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error('Protocol connection did not settle'));
        }, 10000);
        const done = (state?: RoomState) => {
          clearTimeout(timer);
          resolve({ opened, ...(state ? { state } : {}) });
        };
        socket.onopen = () => {
          opened = true;
        };
        socket.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          messages.push(message);
          if (message.state) done(message.state);
        };
        socket.onerror = () => done();
        socket.onclose = () => done();
      }),
    { code, label, version },
  );
}
function refreshOnly(response: Reply) {
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PROTOCOL_REFRESH');
  expect(response.body.error).toContain('새로고침');
  expect(response.body).not.toHaveProperty('state');
}

test('local protocol negotiation preserves legacy Yacht and protects initial Tika join, snapshots and sockets', async ({
  browser,
  baseURL,
}) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Compatibility rejection checks run only on the local project runtime.',
  );
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const hostId = await identify(host, '프로토콜 호스트');
    const guestId = await identify(guest, '이전 화면 손님');
    // The first room uses precisely the old creation/read/socket protocol, without a version marker.
    const yachtCreated = await request(host, '/api/rooms', {});
    expect(yachtCreated.status).toBe(200);
    const yacht = yachtCreated.body.state!;
    expect(yacht.gameType).toBe('yacht');
    expect((await request(host, `/api/rooms/${yacht.code}`)).status).toBe(200);
    const legacySocket = await connect(host, yacht.code, 'legacy-yacht');
    expect(legacySocket.opened).toBe(true);
    expect(legacySocket.state).toHaveProperty('dice');
    const legacyYachtBefore = await snapshot(host, yacht.code);
    refreshOnly(await request(host, `/api/rooms/${yacht.code}`, undefined, '3'));
    expect(await snapshot(host, yacht.code)).toEqual(legacyYachtBefore);

    // The second room cannot return its Tika shape to a browser that never advertised support.
    const tikaCreated = await request(
      host,
      '/api/rooms',
      { gameType: 'tikatuka', solo: false },
      '2',
    );
    expect(tikaCreated.status).toBe(200);
    const tika = tikaCreated.body.state!;
    expect(tika.gameType).toBe('tikatuka');
    const beforeJoin = await snapshot(host, tika.code);
    refreshOnly(await request(guest, '/api/join', { code: tika.code }));
    refreshOnly(await request(guest, '/api/join', { code: tika.code }, '3'));
    expect(await snapshot(host, tika.code)).toEqual(beforeJoin);
    expect((await snapshot(host, tika.code)).players.map((player) => player.id)).toEqual([hostId]);
    const joined = await request(guest, '/api/join', { code: tika.code }, '2');
    expect(joined.status).toBe(200);
    expect(joined.body.state?.players.map((player) => player.id)).toEqual([hostId, guestId]);
    expect((await connect(host, tika.code, 'modern-host', '2')).opened).toBe(true);
    expect((await connect(guest, tika.code, 'modern-guest', '2')).opened).toBe(true);
    const seated = await snapshot(guest, tika.code);
    const command = {
      type: 'ready',
      ready: true,
      requestId: crypto.randomUUID(),
      gameId: seated.gameId,
      expectedVersion: seated.version,
      turnId: seated.turnId,
    };
    refreshOnly(await request(guest, `/api/rooms/${tika.code}`, undefined));
    refreshOnly(await request(guest, `/api/rooms/${tika.code}`, undefined, '3'));
    refreshOnly(await request(guest, `/api/rooms/${tika.code}/command`, command));
    refreshOnly(
      await request(
        guest,
        `/api/rooms/${tika.code}/command`,
        { ...command, gameType: 'tikatuka', protocolVersion: 2 },
        '3',
      ),
    );
    expect((await connect(guest, tika.code, 'legacy-tika')).opened).toBe(false);
    expect((await connect(guest, tika.code, 'future-tika', '3')).opened).toBe(false);
    expect(await snapshot(guest, tika.code)).toEqual(seated);
    expect(await guest.evaluate(() => window.protocolSockets!['modern-guest']!.readyState)).toBe(1);
    expect(
      await guest.evaluate(() =>
        window.protocolMessages!['modern-guest']!.some((message) => message.type === 'replaced'),
      ),
    ).toBe(false);
    expect(
      await guest.evaluate(() =>
        ['legacy-tika', 'future-tika']
          .flatMap((label) => window.protocolMessages![label]!)
          .some((message) => message.state !== undefined),
      ),
    ).toBe(false);
    const changed = await request(
      guest,
      `/api/rooms/${tika.code}/command`,
      { ...command, gameType: 'tikatuka', protocolVersion: 2 },
      '2',
    );
    expect(changed.status).toBe(200);
    expect(changed.body.state?.players.find((player) => player.id === guestId)?.ready).toBe(true);
    await expect
      .poll(() =>
        host.evaluate(() => window.protocolMessages!['modern-host']!.at(-1)?.state?.version),
      )
      .toBe(changed.body.state!.version);
    expect((await request(guest, '/api/session')).status).toBe(200);
  } finally {
    for (const context of contexts) await context.close();
  }
});
