import { chromium } from '@playwright/test';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import process from 'node:process';
const url = process.env.GRAPHICS_BASE_URL || 'http://127.0.0.1:8787';
await mkdir('docs/media', { recursive: true });
const software = process.env.GRAPHICS_SOFTWARE === '1';
const recording = process.env.GRAPHICS_RECORD === '1';
const browser = await chromium.launch(
  software
    ? {
        headless: true,
        args: [
          '--enable-webgl',
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
        ],
      }
    : { headless: false },
);
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  deviceScaleFactor: 1,
  hasTouch: true,
  ...(recording
    ? { recordVideo: { dir: 'work/graphics-video', size: { width: 1366, height: 900 } } }
    : {}),
});
await context.addInitScript(() => {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.__graphicsQA = { frames: [], contexts: [], audio: [], gl: [] };
  window.requestAnimationFrame = (callback) =>
    nativeRAF((time) => {
      const start = performance.now();
      callback(time);
      const active =
        document.querySelector('[data-testid="dice-canvas"]')?.dataset.animating === 'true';
      window.__graphicsQA.frames.push({ time, cpu: performance.now() - start, active });
    });
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const result = originalGetContext.apply(this, args);
    if (args[0] === 'webgl2' && result && !window.__graphicsQA.gl.includes(result))
      window.__graphicsQA.gl.push(result);
    return result;
  };
  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    const result = originalConnect.apply(this, args);
    if (args[0] instanceof AudioDestinationNode) {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      originalConnect.call(this, analyser);
      window.__graphicsQA.analyser = analyser;
    }
    return result;
  };
  const OriginalAudioContext = window.AudioContext;
  window.AudioContext = class extends OriginalAudioContext {
    constructor(...args) {
      super(...args);
      window.__graphicsQA.audio.push(this);
    }
  };
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(url);
await page.getByTestId('dice-canvas').waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: 'docs/media/home-desktop.png', fullPage: true });
const preAudio = await page.evaluate(() => window.__graphicsQA.audio.length);
await page.getByTestId('nickname-input').fill('그래픽 검증');
await page.getByTestId('solo-button').click();
await page.getByTestId('roll-button').waitFor();
await page.waitForTimeout(300);
await page.getByTestId('roll-button').scrollIntoViewIfNeeded();
await page.evaluate(() => (window.__graphicsQA.frames = []));
await page.waitForTimeout(1000);
const idleFrames = await page.evaluate(() => window.__graphicsQA.frames.length);
await page.evaluate(() => (window.__graphicsQA.frames = []));
await page.getByTestId('roll-button').click();
await page.waitForTimeout(1500);
const first = await page.evaluate(() => ({
  frames: window.__graphicsQA.frames,
  rendered: JSON.parse(document.querySelector('[data-testid="dice-canvas"]').dataset.topValues),
  state: JSON.parse(document.querySelector('[data-testid="game-state"]').dataset.state),
  quality: document.querySelector('[data-testid="dice-canvas"]').dataset.quality,
}));
await page.screenshot({ path: 'docs/media/game-desktop.png', fullPage: true });
// Direct pointer hit on actual 3D scene, using the rendered die projection supplied as a read-only DOM diagnostic.
const canvas = page.getByTestId('dice-canvas');
const box = await canvas.boundingBox();
// Camera x projection is centered; first lane is x=-3.6 of a visible world width 11.65+.
// Locate die via broad raycast area around middle-row first lane; accessible control confirms action.
const target = await page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="dice-canvas"]');
  return canvas.dataset.diePositions ? JSON.parse(canvas.dataset.diePositions)[0] : null;
});
let directClick = false;
if (target && box) {
  await page.mouse.click(box.x + target.x * box.width, box.y + target.y * box.height);
  await page.waitForTimeout(450);
  directClick = (await page.getByTestId('die-0').getAttribute('data-held')) === 'true';
}
if (!directClick) {
  await page.getByTestId('die-0').click();
  await page.waitForTimeout(450);
}
await page.screenshot({ path: 'docs/media/held-desktop.png', fullPage: true });
await page.getByTestId('roll-button').click();
await page.waitForTimeout(1400);
const second = await page.evaluate(() => ({
  rendered: JSON.parse(document.querySelector('[data-testid="dice-canvas"]').dataset.topValues),
  state: JSON.parse(document.querySelector('[data-testid="game-state"]').dataset.state),
}));
await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(400);
await canvas.scrollIntoViewIfNeeded();
const mobileBox = await canvas.boundingBox();
const mobileTarget = await page.evaluate(
  () => JSON.parse(document.querySelector('[data-testid="dice-canvas"]').dataset.diePositions)[1],
);
await page.touchscreen.tap(
  mobileBox.x + mobileTarget.x * mobileBox.width,
  mobileBox.y + mobileTarget.y * mobileBox.height,
);
await page.waitForTimeout(450);
const mobileDirectHold = (await page.getByTestId('die-1').getAttribute('data-held')) === 'true';
await page.screenshot({ path: 'docs/media/game-mobile-360.png', fullPage: true });
const mobile = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  width: innerWidth,
  canvas: document.querySelector('[data-testid="dice-canvas"]').getBoundingClientRect().toJSON(),
}));
await page.setViewportSize({ width: 900, height: 700 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/media/game-tablet-900.png', fullPage: true });
await page.setViewportSize({ width: 1366, height: 900 });
const signalBeforeMute = await page.evaluate(() => {
  const a = window.__graphicsQA.analyser;
  if (!a) return null;
  const data = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(data);
  return {
    rms: Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length),
    peak: Math.max(...data.map(Math.abs)),
  };
});
const otherTab = await context.newPage();
await otherTab.goto('about:blank');
await otherTab.bringToFront();
await otherTab.waitForTimeout(300);
const hiddenTab = await page.evaluate(() => ({
  hidden: document.hidden,
  audio: window.__graphicsQA.audio.map((a) => a.state),
}));
await page.bringToFront();
await page.waitForTimeout(300);
const returnedTab = await page.evaluate(() => ({
  hidden: document.hidden,
  audio: window.__graphicsQA.audio.map((a) => a.state),
  animating: document.querySelector('[data-testid="dice-canvas"]').dataset.animating,
}));
await otherTab.close();
await page.getByRole('button', { name: '설정', exact: true }).click();
await page.getByRole('checkbox', { name: /효과 줄이기/ }).check();
await page.getByRole('checkbox', { name: /전체 음소거/ }).check();
await page.getByRole('button', { name: '닫기', exact: true }).click();
await page.evaluate(() => (window.__graphicsQA.frames = []));
await page.getByTestId('roll-button').click();
await page.waitForTimeout(1300);
const signalAfterMute = await page.evaluate(() => {
  const a = window.__graphicsQA.analyser;
  if (!a) return null;
  const data = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(data);
  return {
    rms: Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length),
    peak: Math.max(...data.map(Math.abs)),
  };
});
const reduced = await page.evaluate(() => ({
  activeFrames: window.__graphicsQA.frames.filter((f) => f.active).length,
  settings: JSON.parse(localStorage.getItem('atelier.settings')),
  audio: window.__graphicsQA.audio.map((a) => ({ state: a.state, sampleRate: a.sampleRate })),
  rendered: JSON.parse(document.querySelector('[data-testid="dice-canvas"]').dataset.topValues),
  state: JSON.parse(document.querySelector('[data-testid="game-state"]').dataset.state),
}));
await page.reload();
await page.getByTestId('roll-button').waitFor();
await page.waitForTimeout(600);
const reloaded = await page.evaluate(() => ({
  canvases: document.querySelectorAll('canvas[data-testid="dice-canvas"]').length,
  animating: document.querySelector('[data-testid="dice-canvas"]').dataset.animating,
  settings: JSON.parse(localStorage.getItem('atelier.settings')),
  rendered: JSON.parse(document.querySelector('[data-testid="dice-canvas"]').dataset.topValues),
  state: JSON.parse(document.querySelector('[data-testid="game-state"]').dataset.state),
}));
const glDetails = await page.evaluate(() => {
  const gl = window.__graphicsQA.gl.at(-1);
  const extension = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl
    ? {
        version: gl.getParameter(gl.VERSION),
        vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
        renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      }
    : null;
});
const lostSupported = await page.evaluate(() => {
  const extension = window.__graphicsQA.gl.at(-1)?.getExtension('WEBGL_lose_context');
  if (!extension) return false;
  window.__graphicsQA.lossExtension = extension;
  extension.loseContext();
  return true;
});
if (lostSupported) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/media/context-loss-fallback.png', fullPage: true });
  await page.evaluate(() => window.__graphicsQA.lossExtension?.restoreContext());
  await page.waitForTimeout(800);
}
const contextRestored = await page.evaluate(() => ({
  canvas: document.querySelector('[data-testid="dice-canvas"]')?.dataset.topValues,
  error: document.querySelector('.scene-error')?.textContent ?? null,
}));
const check = (entry) =>
  entry.state.dice.map((d) => d.value).join(',') === entry.rendered.join(',');
const timings = first.frames.filter((frame) => frame.active);
const deltas = timings.slice(1).map((frame, index) => frame.time - timings[index].time);
const sort = (a) => [...a].sort((x, y) => x - y);
const percentile = (a, p) => sort(a)[Math.floor((a.length - 1) * p)] ?? null;
const report = {
  date: new Date().toISOString(),
  url,
  software,
  recording,
  browser: browser.version(),
  platform: process.platform,
  architecture: process.arch,
  viewport: { width: 1366, height: 900, dpr: 1 },
  gpu: glDetails,
  preGestureAudioContexts: preAudio,
  signalBeforeMute,
  signalAfterMute,
  hiddenTab,
  returnedTab,
  idleFramesPerSecond: idleFrames,
  activeFrameCount: timings.length,
  medianRafDeltaMs: percentile(deltas, 0.5),
  p95RafDeltaMs: percentile(deltas, 0.95),
  medianCpuCallbackMs: percentile(
    timings.map((f) => f.cpu),
    0.5,
  ),
  p95CpuCallbackMs: percentile(
    timings.map((f) => f.cpu),
    0.95,
  ),
  sceneQuality: first.quality,
  directRaycastHold: directClick,
  mobileDirectHold,
  faceMatches: [check(first), check(second), check(reduced), check(reloaded)],
  mobile,
  reduced: { activeFrames: reduced.activeFrames, settings: reduced.settings, audio: reduced.audio },
  reloaded: {
    canvases: reloaded.canvases,
    animating: reloaded.animating,
    settings: reloaded.settings,
  },
  contextLossSupported: lostSupported,
  contextRestored,
  errors,
};
await writeFile('docs/media/graphics-report.json', JSON.stringify(report, null, 2) + '\n');
const video = page.video();
await page.close();
await context.close();
if (video) await copyFile(await video.path(), 'docs/media/gameplay-local.webm');
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (
  report.errors.length ||
  report.faceMatches.some((value) => !value) ||
  !report.directRaycastHold ||
  !report.mobileDirectHold ||
  report.reduced.activeFrames !== 0 ||
  report.preGestureAudioContexts !== 0 ||
  report.contextRestored.error ||
  report.signalAfterMute?.peak !== 0 ||
  (report.hiddenTab.hidden && report.hiddenTab.audio.some((state) => state !== 'suspended')) ||
  report.returnedTab.audio.some((state) => state !== 'running')
)
  throw new Error('Graphics QA failed; see docs/media/graphics-report.json');
