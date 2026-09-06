import { test, expect } from '@playwright/test';
import { CATEGORIES } from '../../src/shared/protocol';
import { createPlayers, agree, roomState } from './helpers';

for (const count of [1, 2, 3, 4])
  test(`${count} independent guests: complete twelve rounds, synchronized state and rematch`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    const { contexts, pages, code, ids } = await createPlayers(browser, count, baseURL!);
    try {
      const gameId = (await agree(pages, code)).gameId;
      for (let round = 0; round < 12; round++)
        for (let seat = 0; seat < count; seat++) {
          const page = pages[seat];
          let state = await agree(pages, code);
          expect(state.turnPlayerId).toBe(ids[seat]);
          await expect(page.getByTestId('roll-button')).toBeEnabled();
          await page.getByTestId('roll-button').click();
          await expect.poll(async () => (await roomState(page, code)).rolls).toBe(1);
          await expect(page.getByTestId('roll-button')).toBeEnabled();
          state = await agree(pages, code);
          if (round === 0 && seat === 0) {
            const heldValue = state.dice[0].value;
            await page.getByTestId('die-0').click();
            await page.getByTestId('die-1').click();
            await page.getByTestId('roll-button').click();
            await expect.poll(async () => (await roomState(page, code)).rolls).toBe(2);
            await expect(page.getByTestId('roll-button')).toBeEnabled();
            state = await agree(pages, code);
            expect(state.dice[0].held).toBe(true);
            expect(state.dice[1].held).toBe(true);
            expect(state.dice[0].value).toBe(heldValue);
            await page.reload();
            await expect(page.getByTestId('roll-button')).toBeVisible();
            expect((await roomState(page, code)).turnPlayerId).toBe(ids[seat]);
            expect((await roomState(page, code)).dice).toEqual(state.dice);
            await contexts[seat].setOffline(true);
            await expect(
              page.getByText(/다시 연결|연결을 복구|연결이 끊|오프라인/).first(),
            ).toBeVisible();
            await contexts[seat].setOffline(false);
            await expect(page.getByTestId('roll-button')).toBeEnabled();
            await agree(pages, code);
            await page.screenshot({
              path: testInfo.outputPath(`table-${count}p.png`),
              fullPage: true,
            });
          }
          await page.getByTestId(`score-${CATEGORIES[round]}`).click();
          const zero = page.getByTestId('confirm-zero');
          if (await zero.isVisible()) {
            if ((await zero.getAttribute('type')) === 'checkbox') await zero.check();
            else await zero.click();
          }
          await page.getByTestId('confirm-score').click();
          await expect
            .poll(async () => (await roomState(page, code)).players[seat].scores[CATEGORIES[round]])
            .not.toBeNull();
          await agree(pages, code);
        }
      const finished = await agree(pages, code);
      expect(finished.phase).toBe('finished');
      expect(finished.results).toHaveLength(count);
      for (const p of finished.players) {
        expect(Object.values(p.scores).every((v) => v !== null)).toBe(true);
        expect(p.total).toBeLessThanOrEqual(325);
      }
      await pages[0].screenshot({
        path: testInfo.outputPath(`results-${count}p.png`),
        fullPage: true,
      });
      await pages[0].getByTestId('rematch-button').click();
      await expect.poll(async () => (await roomState(pages[0], code)).phase).toBe('lobby');
      const rematch = await agree(pages, code);
      expect(rematch.gameId).not.toBe(gameId);
      for (const p of rematch.players)
        expect(Object.values(p.scores).every((v) => v === null)).toBe(true);
      // Re-enter the new match through the same normal lobby controls.
      for (let i = 1; i < count; i++) {
        await pages[i].getByTestId('ready-button').click();
        await expect
          .poll(async () => (await roomState(pages[0], code)).players.filter((p) => p.ready).length)
          .toBeGreaterThanOrEqual(i);
      }
      await pages[0].getByTestId('start-game').click();
      await expect(pages[0].getByTestId('roll-button')).toBeEnabled();
      await pages[0].getByTestId('roll-button').click();
      await expect.poll(async () => (await roomState(pages[0], code)).rolls).toBe(1);
      await agree(pages, code);
    } finally {
      for (const context of contexts) await context.close();
    }
  });

test('live revision, static security headers and same-origin API routing', async ({
  page,
  request,
}) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  const h = await health.json();
  expect(h.ok).toBe(true);
  const version = await request.get('/version.json');
  const v = await version.json();
  expect(v.commit).toBe(h.commit);
  if (process.env.EXPECTED_COMMIT) expect(v.commit).toBe(process.env.EXPECTED_COMMIT);
  for (const path of ['/', '/version.json', '/invite/deep-link']) {
    const r = await request.get(path);
    expect(r.ok()).toBe(true);
    expect(r.headers()['x-content-type-options']).toBe('nosniff');
    expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
  const missing = await request.get('/api/not-a-route');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('nickname-input')).toBeVisible();
  expect(errors).toEqual([]);
});
