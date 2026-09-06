import { test, expect } from '@playwright/test';
import { enter, roomState, getCode } from './helpers';

test('360px portrait, landscape, keyboard settings and playable dice', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await enter(page, '모바일 손님');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.getByTestId('solo-button').click();
  const code = await getCode(page);
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await page.getByTestId('roll-button').click();
  await expect.poll(async () => (await roomState(page, code)).rolls).toBe(1);
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('mobile-360.png'), fullPage: true });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.getByTestId('die-0').click();
  await expect.poll(async () => (await roomState(page, code)).dice[0].held).toBe(true);
  await page.getByTestId('score-choice').click();
  await page.getByTestId('confirm-score').click();
  await expect
    .poll(async () => (await roomState(page, code)).players[0].scores.choice)
    .not.toBeNull();
  await page.setViewportSize({ width: 800, height: 360 });
  await expect(page.getByTestId('roll-button')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-landscape.png'), fullPage: true });
});
