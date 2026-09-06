import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  deviceScaleFactor: 1,
});
await context.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frames = [];
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      const start = performance.now();
      callback(time);
      if (document.querySelector('[data-testid="dice-canvas"]')?.dataset.animating === 'true')
        window.__frames.push({ time, cpu: performance.now() - start });
    });
});
const page = await context.newPage();
await page.goto(process.env.GRAPHICS_BASE_URL || 'http://127.0.0.1:8787');
await page.getByTestId('nickname-input').fill('하드웨어 검증');
await page.getByTestId('solo-button').click();
await page.getByTestId('roll-button').waitFor();
await page.getByTestId('roll-button').scrollIntoViewIfNeeded();
const runs = [];
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => (window.__frames = []));
  await page.getByTestId('roll-button').click();
  await page.waitForTimeout(1350);
  runs.push(
    await page.evaluate(() => ({
      frames: window.__frames,
      quality: document.querySelector('[data-testid="dice-canvas"]').dataset.quality,
      values: JSON.parse(document.querySelector('[data-testid="dice-canvas"]').dataset.topValues),
      expected: JSON.parse(
        document.querySelector('[data-testid="game-state"]').dataset.state,
      ).dice.map((d) => d.value),
    })),
  );
}
const gpu = await page.evaluate(() => {
  const gl = document.querySelector('[data-testid="dice-canvas"]').getContext('webgl2');
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    version: gl.getParameter(gl.VERSION),
    renderer: gl.getParameter(e.UNMASKED_RENDERER_WEBGL),
    vendor: gl.getParameter(e.UNMASKED_VENDOR_WEBGL),
  };
});
const percentile = (a, p) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)] ?? null;
const report = {
  date: new Date().toISOString(),
  browser: browser.version(),
  viewport: { width: 1366, height: 900, dpr: 1 },
  headless: false,
  forcedGraphicsFlags: false,
  videoRecording: false,
  otherLoad:
    process.env.GRAPHICS_OTHER_LOAD ||
    'Other host workload was not measured; this script starts one game browser.',
  gpu,
  runs: runs.map((run) => {
    const deltas = run.frames.slice(1).map((f, i) => f.time - run.frames[i].time);
    return {
      frames: run.frames.length,
      medianRafMs: percentile(deltas, 0.5),
      p95RafMs: percentile(deltas, 0.95),
      medianCallbackCpuMs: percentile(
        run.frames.map((f) => f.cpu),
        0.5,
      ),
      p95CallbackCpuMs: percentile(
        run.frames.map((f) => f.cpu),
        0.95,
      ),
      quality: run.quality,
      facesMatch: run.values.join(',') === run.expected.join(','),
    };
  }),
};
await writeFile('docs/media/hardware-profile.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
await context.close();
await browser.close();
