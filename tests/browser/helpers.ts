import { expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import type { RoomState } from '../../src/shared/protocol';
export async function roomState(page: Page, code: string): Promise<RoomState> {
  return page.evaluate(async (code) => {
    const r = await fetch(`/api/rooms/${code}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    return ((await r.json()) as { state: RoomState }).state;
  }, code);
}
export async function getCode(page: Page) {
  return (await page.getByTestId('room-code').innerText()).replace(/[^A-Z0-9]/g, '');
}
export async function enter(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('nickname-input').fill(name);
}
export async function createPlayers(browser: Browser, count: number, baseURL: string) {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1366, height: 900 },
      reducedMotion: 'reduce',
    });
    contexts.push(context);
    pages.push(await context.newPage());
  }
  await enter(pages[0], '아틀리에 1');
  await pages[0].getByTestId(count === 1 ? 'solo-button' : 'create-room').click();
  const code = await getCode(pages[0]);
  for (let i = 1; i < count; i++) {
    await pages[i].goto(`/?room=${code}`);
    await pages[i].getByTestId('nickname-input').fill(`아틀리에 ${i + 1}`);
    await pages[i].getByTestId('join-room').click();
    await expect(pages[i].getByTestId('room-code')).toBeVisible();
  }
  if (count > 1) {
    for (let i = 1; i < count; i++) {
      await pages[i].getByTestId('ready-button').click();
      await expect
        .poll(async () => (await roomState(pages[0], code)).players.filter((p) => p.ready).length)
        .toBeGreaterThanOrEqual(i);
    }
    await pages[0].getByTestId('start-game').click();
  }
  await expect(pages[0].getByTestId('roll-button')).toBeVisible();
  const state = await roomState(pages[0], code);
  const ids = await Promise.all(
    pages.map((p) =>
      p.evaluate(async () => {
        const r = await fetch('/api/session');
        return ((await r.json()) as { playerId: string }).playerId;
      }),
    ),
  );
  expect(new Set(ids).size).toBe(count);
  expect(state.players).toHaveLength(count);
  return { contexts, pages, code, ids };
}
export async function agree(pages: Page[], code: string) {
  const state = await roomState(pages[0], code);
  const stable = (s: RoomState) =>
    JSON.stringify({
      gameId: s.gameId,
      version: s.version,
      turnId: s.turnId,
      turnPlayerId: s.turnPlayerId,
      dice: s.dice,
      rolls: s.rolls,
      scores: s.players.map((p) => p.scores),
      phase: s.phase,
    });
  const expected = stable(state);
  await expect
    .poll(async () => {
      const values = await Promise.all(
        pages.map((p) => p.getByTestId('game-state').getAttribute('data-state')),
      );
      return values.every(
        (value) => value !== null && stable(JSON.parse(value) as RoomState) === expected,
      );
    })
    .toBe(true);
  return state;
}
