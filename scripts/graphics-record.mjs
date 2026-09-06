import { chromium } from '@playwright/test';
import { mkdir, copyFile } from 'node:fs/promises';
const url = process.env.GRAPHICS_BASE_URL || 'http://127.0.0.1:8787';
await mkdir('work/graphics-clean-video', { recursive: true });
await mkdir('docs/media', { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: 'work/graphics-clean-video', size: { width: 1366, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
try {
  await page.goto(url);
  await page.getByTestId('nickname-input').fill('오늘의 플레이');
  await page.getByTestId('solo-button').click();
  await page.getByTestId('roll-button').waitFor();
  await page.getByTestId('roll-button').click();
  await page.waitForTimeout(1450);
  await page.getByTestId('die-0').click();
  await page.getByTestId('die-2').click();
  await page.waitForTimeout(320);
  await page.getByTestId('roll-button').click();
  await page.waitForTimeout(1450);
  await page.getByTestId('score-choice').click();
  await page.waitForTimeout(600);
  await page.getByTestId('confirm-score').click();
  await page.waitForTimeout(300);
  await page.getByTestId('roll-button').click();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'docs/media/gameplay-final-desktop.png', fullPage: true });
  await page.waitForTimeout(900);
} finally {
  const video = page.video();
  await page.close();
  await context.close();
  if (video) await copyFile(await video.path(), 'docs/media/gameplay-local.webm');
  await browser.close();
}
console.log('Saved docs/media/gameplay-final-desktop.png and gameplay-local.webm');
