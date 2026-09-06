import { test, expect } from '@playwright/test';
import type { YachtRoomState as RoomState } from '../../src/shared/protocol';
import { createPlayers, roomState } from './helpers';

test('response loss then reload resolves the original roll once', async ({ browser, baseURL }) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Fault injection runs only on the local project runtime.',
  );
  const { contexts, pages, code } = await createPlayers(browser, 1, baseURL!);
  const page = pages[0];
  let receipt: RoomState | undefined;
  let dropped = false;
  try {
    await page.route('**/command', async (route) => {
      const body = route.request().postDataJSON() as { type: string };
      if (body.type === 'roll' && !dropped) {
        dropped = true;
        const response = await route.fetch();
        receipt = ((await response.json()) as { state: RoomState }).state;
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByTestId('roll-button').click();
    await expect.poll(() => Boolean(receipt)).toBe(true);
    await page.reload();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('atelier.pending')))
      .toBeNull();
    const state = await roomState(page, code);
    expect(state.rolls).toBe(1);
    expect(state.dice).toEqual(receipt!.dice);
    expect(state.version).toBe(receipt!.version);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('new tab takes connection ownership; the old close cannot mark the new tab offline', async ({
  browser,
  baseURL,
}) => {
  const { contexts, pages, code, ids } = await createPlayers(browser, 1, baseURL!);
  try {
    const replacement = await contexts[0].newPage();
    await replacement.goto(`/?room=${code}`);
    await expect(replacement.getByTestId('roll-button')).toBeEnabled();
    await expect(pages[0].getByText(/다른 탭에서/).first()).toBeVisible();
    await pages[0].close();
    await replacement.getByTestId('roll-button').click();
    await expect.poll(async () => (await roomState(replacement, code)).rolls).toBe(1);
    const state = await roomState(replacement, code);
    expect(state.players[0].id).toBe(ids[0]);
    expect(state.players[0].connected).toBe(true);
    expect(state.players[0].graceDeadline).toBeNull();
  } finally {
    for (const context of contexts) await context.close();
  }
});
