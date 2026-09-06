import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { audioResources, expectOnlySharedMusic, observeAudio } from './audio-probe';

type Scene = 'lobby' | 'yacht' | 'tikatuka';
const prefixes: Record<Scene, string> = { lobby: 'lobby', yacht: 'yach', tikatuka: 'tica' };
async function music(page: Page) {
  const records = (await audioResources(page)).filter((record) => record.media.length > 0);
  expect(records).toHaveLength(1);
  expect(records[0].media).toHaveLength(2);
  expect(records[0].state).not.toBe('closed');
  return records[0];
}
async function playing(page: Page, scene: Scene) {
  await expect
    .poll(async () => {
      const records = (await audioResources(page)).filter((record) => record.media.length > 0);
      const active = records.flatMap((record) => record.media).filter((media) => !media.paused);
      return (
        active.length === 1 &&
        new RegExp(`^/music/${prefixes[scene]}[12]\\.mp3$`).test(active[0].src) &&
        active[0].currentTime > 0 &&
        active[0].error === null
      );
    })
    .toBe(true);
  return (await music(page)).media.find((media) => !media.paused)!;
}
async function leave(page: Page) {
  await page.getByRole('button', { name: '방 나가기', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '방 나가기', exact: true }).click();
  await expect(page.getByTestId('nickname-input')).toBeVisible();
  await expectOnlySharedMusic(page);
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.0001;
async function settledGains(page: Page) {
  let previous: number[] = [];
  let stable = 0;
  await expect
    .poll(
      async () => {
        const current = (await music(page)).gains;
        stable =
          current.length === previous.length &&
          current.every((value, index) => near(value, previous[index]))
            ? stable + 1
            : 0;
        previous = current;
        return stable;
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(2);
  return previous;
}
async function expectCrossfade(page: Page, from: Scene, to: Scene) {
  let before: number[] = [];
  await expect
    .poll(
      async () => {
        const record = await music(page);
        const active = record.media.filter((media) => !media.paused);
        const overlap =
          active.length === 2 &&
          [from, to].every((scene) =>
            active.some((media) =>
              new RegExp(`^/music/${prefixes[scene]}[12]\\.mp3$`).test(media.src),
            ),
          );
        if (overlap) before = record.gains;
        return overlap;
      },
      { intervals: [20] },
    )
    .toBe(true);
  // Measure two points in the native AudioParam ramp, while real media continues to play.
  await page.waitForTimeout(200);
  const after = (await music(page)).gains;
  expect(after.some((value, index) => value > before[index] + 0.005)).toBe(true);
  expect(after.some((value, index) => value < before[index] - 0.005)).toBe(true);
}

test('shared MP3 music follows lobby, Yacht, Tikatuka and results without leaking game audio', async ({
  browser,
  baseURL,
}) => {
  // Two ordinary rooms only. This test also runs after deployment without seek or event injection.
  const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  await observeAudio(context);
  const page = await context.newPage();
  const errors: string[] = [];
  const requested: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('.mp3')) requested.push(path);
  });
  try {
    await page.goto('/');
    await expect(page.getByTestId('nickname-input')).toBeVisible();
    expect(await audioResources(page)).toEqual([]);
    expect(requested).toEqual([]);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const firstLobby = await playing(page, 'lobby');
    const sharedId = (await music(page)).id;
    expect(requested.every((path) => /^\/music\/lobby[12]\.mp3$/.test(path))).toBe(true);

    // Volume and mute control native output gains, while source selection/position is retained.
    const audible = await settledGains(page);
    await page.getByRole('slider', { name: '배경 음악 볼륨' }).press('Home');
    let silenced: number[] = [];
    await expect
      .poll(async () => {
        const quiet = (await music(page)).gains;
        silenced = audible.flatMap((value, index) =>
          value > 0.0001 && quiet[index] < 0.00001 ? [index] : [],
        );
        return silenced.length;
      })
      .toBeGreaterThan(0);
    await page.getByRole('slider', { name: '배경 음악 볼륨' }).press('ArrowRight');
    await expect
      .poll(async () => {
        const gains = (await music(page)).gains;
        return silenced.every((index) => gains[index] > 0.0001);
      })
      .toBe(true);
    const restored = await settledGains(page);
    await page.getByRole('slider', { name: '효과음 볼륨' }).press('ArrowRight');
    expect((await settledGains(page)).every((value, index) => near(value, restored[index]))).toBe(
      true,
    );
    const mute = page.getByRole('dialog').locator('input[type="checkbox"]').first();
    await mute.check();
    await expect
      .poll(async () => {
        const gains = (await music(page)).gains;
        return silenced.some((index) => gains[index] < 0.00001);
      })
      .toBe(true);
    await mute.uncheck();
    await expect
      .poll(async () => {
        const gains = (await music(page)).gains;
        return silenced.every((index) => gains[index] > 0.0001);
      })
      .toBe(true);
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByTestId('game-card-tikatuka').click();
    await page.getByRole('button', { name: '게임 방법', exact: true }).first().click();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    const afterModals = await playing(page, 'lobby');
    expect(afterModals.src).toBe(firstLobby.src);
    expect(afterModals.currentTime).toBeGreaterThan(firstLobby.currentTime);
    await page.getByTestId('game-card-yacht').click();
    await page.getByTestId('nickname-input').fill('음악 전환 손님');
    await page.getByTestId('create-room').click();
    await expect(page.getByTestId('start-game')).toBeEnabled();
    expect((await playing(page, 'lobby')).src).toBe(firstLobby.src);
    await page.getByTestId('start-game').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    const firstYacht = await playing(page, 'yacht');
    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('die-0')).toBeEnabled();
    await expect
      .poll(async () =>
        (await audioResources(page)).some(
          (record) => record.media.length === 0 && record.state !== 'closed',
        ),
      )
      .toBe(true);
    await Promise.all([
      expectCrossfade(page, 'yacht', 'lobby'),
      page.getByRole('button', { name: '게임 목록', exact: true }).click(),
    ]);
    const nextLobby = await playing(page, 'lobby');
    expect(nextLobby.src).not.toBe(firstLobby.src);
    await expectOnlySharedMusic(page);
    expect((await music(page)).id).toBe(sharedId);
    await page.getByTestId('resume-game').click();
    expect((await playing(page, 'yacht')).src).not.toBe(firstYacht.src);
    await leave(page);
    await playing(page, 'lobby');

    await page.getByTestId('game-card-tikatuka').click();
    await page.getByTestId('solo-button').click();
    await expect(page.getByTestId('tika-game')).toBeVisible();
    const firstTika = await playing(page, 'tikatuka');
    await expect(page.getByTestId('tika-hold')).toBeEnabled();
    await page.getByTestId('tika-hold').click();
    await page.getByTestId('tika-hold-confirm').click();
    await expect(page.getByTestId('game-state')).toHaveAttribute('data-phase', 'finished', {
      timeout: 60000,
    });
    const resultMusic = await playing(page, 'tikatuka');
    expect(resultMusic.src).toBe(firstTika.src);
    expect(resultMusic.currentTime).toBeGreaterThan(firstTika.currentTime);
    await page.getByTestId('rematch').click();
    await expect(page.getByTestId('start-game')).toBeEnabled();
    await playing(page, 'lobby');
    await expectOnlySharedMusic(page);
    await page.getByTestId('start-game').click();
    expect((await playing(page, 'tikatuka')).src).not.toBe(firstTika.src);
    expect((await music(page)).id).toBe(sharedId);
    await leave(page);
    await playing(page, 'lobby');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('local short MP3 checkpoint retries a blocked gesture and alternates both lobby tracks', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Short media fixtures and autoplay rejection simulation are local-only.',
  );
  const context = await browser.newContext({ baseURL });
  await observeAudio(context);
  await context.route(/\/music\/lobby[12]\.mp3$/, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const fixture = `tests/fixtures/music/${name.replace('.mp3', '-short.mp3')}`;
    await route.fulfill({ contentType: 'audio/mpeg', body: await readFile(fixture) });
  });
  // Simulate one browser policy rejection, then preserve real native playback for every retry.
  await context.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    let first = true;
    HTMLMediaElement.prototype.play = function () {
      if (first) {
        first = false;
        return Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
      }
      return nativePlay.call(this);
    };
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    const first = await playing(page, 'lobby');
    expect(first.duration).toBeGreaterThan(4);
    expect(first.duration).toBeLessThan(6);
    const sources = [first.src];
    for (let repeat = 0; repeat < 2; repeat++) {
      // Native media reaches its real end; no seek, synthetic ended event or game mutation.
      try {
        await expect.poll(async () => (await playing(page, 'lobby')).src).not.toBe(sources.at(-1));
      } catch (error) {
        await info.attach('native-media-checkpoint', {
          body: JSON.stringify({ sources, resources: await audioResources(page) }),
          contentType: 'application/json',
        });
        throw error;
      }
      sources.push((await playing(page, 'lobby')).src);
    }
    expect(sources[2]).toBe(sources[0]);
    await expectOnlySharedMusic(page);
  } finally {
    await context.close();
  }
});
