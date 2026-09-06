import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { LegacyYachtCommand as Command, YachtIntent as Intent, YachtRoomState as RoomState, ServerMessage, Session } from '../../src/shared/protocol';

type Guest = { context: BrowserContext; session: Session; cookie: string; page?: Page };
declare global {
  interface Window {
    localSocket?: WebSocket;
    localMessages?: ServerMessage[];
  }
}
function cmd(state: RoomState, intent: Intent): Command {
  return {
    ...intent,
    requestId: crypto.randomUUID(),
    gameId: state.gameId,
    turnId: state.turnId,
    expectedVersion: state.version,
  };
}
async function snapshot(guest: Guest, code: string): Promise<RoomState> {
  const response = await guest.context.request.get(`/api/rooms/${code}`, {
    headers: { Cookie: guest.cookie },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { state: RoomState }).state;
}
async function post(guest: Guest, path: string, body: unknown, origin: string) {
  return guest.context.request.post(path, {
    data: body,
    headers: { Origin: origin, Cookie: guest.cookie, 'X-CSRF-Token': guest.session.csrfToken },
  });
}
async function socket(guest: Guest, code: string, origin: string): Promise<Page> {
  const page = await guest.context.newPage();
  guest.page = page;
  await page.goto(`${origin}/version.json`);
  await page.evaluate(
    (code) =>
      new Promise<void>((resolve, reject) => {
        const url = new URL(`/api/rooms/${code}/ws`, location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        window.localMessages = [];
        window.localSocket = new WebSocket(url);
        window.localSocket.onmessage = (event) => {
          window.localMessages!.push(JSON.parse(String(event.data)) as ServerMessage);
        };
        window.localSocket.onopen = () => resolve();
        window.localSocket.onerror = () => reject(new Error('local WebSocket failed'));
      }),
    code,
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.localMessages?.some((message) => message.type === 'state')),
    )
    .toBe(true);
  return page;
}
async function sendSocket(page: Page, command: Command): Promise<ServerMessage> {
  await page.evaluate((command) => {
    window.localSocket!.send(JSON.stringify(command));
  }, command);
  await expect
    .poll(() =>
      page.evaluate(
        (requestId) => window.localMessages?.some((message) => message.requestId === requestId),
        command.requestId,
      ),
    )
    .toBe(true);
  return page.evaluate(
    (requestId) => window.localMessages!.find((message) => message.requestId === requestId)!,
    command.requestId,
  );
}

test('local workerd authority: independent credentials, seat race, WebSocket commands, replay and revocation', async ({
  browser,
  baseURL,
}) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Defense validation is confined to this project’s local Wrangler environment.',
  );
  const origin = new URL(baseURL!).origin;
  const guests: Guest[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({ baseURL: origin });
      const response = await context.request.post('/api/session', {
        data: { nickname: '동일한 이름' },
        headers: { Origin: origin },
      });
      expect(response.status()).toBe(201);
      // APIRequestContext does not send Secure cookies over local HTTP, unlike
      // Chromium's trustworthy localhost handling. Forward this test's own jar.
      const cookie = (await context.cookies())
        .map((value) => `${value.name}=${value.value}`)
        .join('; ');
      guests.push({ context, session: (await response.json()) as Session, cookie });
    }
    expect(new Set(guests.map((guest) => guest.session.playerId)).size).toBe(5);
    const host = guests[0]!;
    const noCsrf = await host.context.request.post('/api/rooms', {
      data: {},
      headers: { Origin: origin, Cookie: host.cookie },
    });
    expect(noCsrf.status()).toBe(403);
    const wrongOrigin = await post(host, '/api/rooms', {}, 'https://unrelated.invalid');
    expect(wrongOrigin.status()).toBe(403);
    const created = await post(host, '/api/rooms', {}, origin);
    expect(created.status()).toBe(200);
    const code = ((await created.json()) as { state: RoomState }).state.code;
    const unauthorized = await guests[4]!.context.request.get(`/api/rooms/${code}`, {
      headers: { Cookie: guests[4]!.cookie },
    });
    expect(unauthorized.status()).toBe(403);
    for (let i = 1; i < 3; i++)
      expect((await post(guests[i]!, '/api/join', { code }, origin)).status()).toBe(200);
    const racingSeats = await Promise.all([
      post(guests[3]!, '/api/join', { code }, origin),
      post(guests[4]!, '/api/join', { code }, origin),
    ]);
    expect(racingSeats.map((response) => response.status()).sort()).toEqual([200, 409]);
    const seated = [
      host,
      guests[1]!,
      guests[2]!,
      guests[3 + racingSeats.findIndex((response) => response.status() === 200)]!,
    ];
    expect((await snapshot(host, code)).players).toHaveLength(4);
    const badUpgrade = await host.context.request.get(`/api/rooms/${code}/ws`, {
      headers: { Origin: 'https://unrelated.invalid', Cookie: host.cookie, Upgrade: 'websocket' },
    });
    expect(badUpgrade.status()).toBe(403);
    for (const guest of seated) await socket(guest, code, origin);
    const unseated = guests.find((guest) => !seated.includes(guest))!;
    const nonmemberSocket = await unseated.context.request.get(`/api/rooms/${code}/ws`, {
      headers: { Origin: origin, Cookie: unseated.cookie, Upgrade: 'websocket' },
    });
    expect(nonmemberSocket.status()).toBe(403);
    // An expected handshake rejection must not reset the object or its healthy sockets.
    for (const guest of seated)
      expect(await guest.page!.evaluate(() => window.localSocket?.readyState)).toBe(1);
    for (const guest of seated.slice(1))
      expect(
        (
          await post(
            guest,
            `/api/rooms/${code}/command`,
            cmd(await snapshot(guest, code), { type: 'ready', ready: true }),
            origin,
          )
        ).status(),
      ).toBe(200);
    const start = cmd(await snapshot(host, code), { type: 'start' });
    expect((await sendSocket(host.page!, start)).type).toBe('result');
    const earlyScore = await post(
      host,
      `/api/rooms/${code}/command`,
      cmd(await snapshot(host, code), { type: 'score', category: 'yacht' }),
      origin,
    );
    expect(earlyScore.status()).toBe(409);
    expect(((await earlyScore.json()) as ServerMessage).code).toBe('ROLL_FIRST');
    const wrongPlayer = await sendSocket(
      seated[1]!.page!,
      cmd(await snapshot(host, code), { type: 'roll' }),
    );
    expect(wrongPlayer.code).toBe('NOT_YOUR_TURN');
    const invalid = await post(
      host,
      `/api/rooms/${code}/command`,
      { ...cmd(await snapshot(host, code), { type: 'roll' }), dice: [6, 6, 6, 6, 6] },
      origin,
    );
    expect(invalid.status()).toBe(400);
    const roll = cmd(await snapshot(host, code), { type: 'roll' });
    const first = await sendSocket(host.page!, roll);
    if (first.state?.gameType !== 'yacht') throw new Error('Expected a Yacht roll');
    expect(first.state.rolls).toBe(1);
    const repeated = await post(host, `/api/rooms/${code}/command`, roll, origin);
    expect(repeated.status()).toBe(200);
    expect(((await repeated.json()) as ServerMessage).state).toEqual(first.state);
    const reused = await post(
      host,
      `/api/rooms/${code}/command`,
      { ...roll, type: 'score', category: 'yacht' },
      origin,
    );
    expect(((await reused.json()) as ServerMessage).code).toBe('REQUEST_ID_REUSED');
    const stale = await post(
      host,
      `/api/rooms/${code}/command`,
      { ...roll, requestId: crypto.randomUUID() },
      origin,
    );
    expect(((await stale.json()) as ServerMessage).code).toBe('STALE_VERSION');
    const oldGame = await post(
      host,
      `/api/rooms/${code}/command`,
      { ...cmd(await snapshot(host, code), { type: 'roll' }), gameId: crypto.randomUUID() },
      origin,
    );
    expect(((await oldGame.json()) as ServerMessage).code).toBe('GAME_CHANGED');
    await host.page!.waitForTimeout(Math.max(0, first.state!.inputAfter - Date.now()) + 20);
    const current = await snapshot(host, code);
    const racingInputs = await Promise.all([
      post(
        host,
        `/api/rooms/${code}/command`,
        cmd(current, { type: 'hold', held: [true, false, false, false, false] }),
        origin,
      ),
      post(host, `/api/rooms/${code}/command`, cmd(current, { type: 'roll' }), origin),
    ]);
    expect(racingInputs.map((response) => response.status()).sort()).toEqual([200, 409]);
    const afterRace = await snapshot(host, code);
    await host.page!.waitForTimeout(Math.max(0, afterRace.inputAfter - Date.now()) + 20);
    const score = cmd(afterRace, { type: 'score', category: 'choice' });
    const duplicateScores = await Promise.all([
      post(host, `/api/rooms/${code}/command`, score, origin),
      post(host, `/api/rooms/${code}/command`, score, origin),
    ]);
    expect(duplicateScores.map((response) => response.status())).toEqual([200, 200]);
    const confirmed = await snapshot(host, code);
    expect(confirmed.players[0]!.scores.choice).not.toBeNull();
    expect(confirmed.turnPlayerId).toBe(seated[1]!.session.playerId);
    // Replacement leaves the new connection authoritative after the old close event.
    const oldPage = host.page!;
    const newPage = await socket(host, code, origin);
    await expect.poll(() => oldPage.evaluate(() => window.localSocket?.readyState)).toBe(3);
    expect((await snapshot(host, code)).players[0]!.connected).toBe(true);
    expect(await newPage.evaluate(() => window.localSocket?.readyState)).toBe(1);
    const revoked = await host.context.request.delete('/api/session', {
      headers: { Origin: origin, Cookie: host.cookie, 'X-CSRF-Token': host.session.csrfToken },
    });
    expect(revoked.status()).toBe(200);
    await expect.poll(() => newPage.evaluate(() => window.localSocket?.readyState)).toBe(3);
    expect((await host.context.request.get(`/api/rooms/${code}`)).status()).toBe(401);
    const remaining = await snapshot(seated[1]!, code);
    expect(remaining.players[0]!.forfeited).toBe(true);
    expect(remaining.hostId).toBe(seated[1]!.session.playerId);
  } finally {
    for (const guest of guests) await guest.context.close();
  }
});
