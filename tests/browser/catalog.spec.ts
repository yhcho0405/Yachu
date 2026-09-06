import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { RoomState, Session, YachtRoomState } from '../../src/shared/protocol';
import type { TikatukaRoomState } from '../../src/shared/tikatuka';
import { getCode } from './helpers';

type AudioProbeWindow = Window & { __catalogAudioContexts?: AudioContext[] };
async function publicState(page: Page): Promise<RoomState> {
  const raw = await page.getByTestId('game-state').getAttribute('data-state');
  if (!raw) throw new Error('Missing public room snapshot');
  return JSON.parse(raw) as RoomState;
}
async function yachtState(page: Page): Promise<YachtRoomState> {
  const state = await publicState(page);
  if (state.gameType !== 'yacht') throw new Error('Expected Yacht');
  return state;
}
async function tikaState(page: Page): Promise<TikatukaRoomState> {
  const state = await publicState(page);
  if (state.gameType !== 'tikatuka') throw new Error('Expected Tikatuka');
  return state;
}
async function sessionId(page: Page): Promise<string> {
  return page.evaluate(
    async () => ((await (await fetch('/api/session')).json()) as Session).playerId,
  );
}
async function settings(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('atelier.settings') ?? '{}') as Record<string, unknown>,
  );
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}
async function audioStates(page: Page) {
  return page.evaluate(() =>
    ((window as AudioProbeWindow).__catalogAudioContexts ?? []).map((context) => context.state),
  );
}
async function observeAudio(context: BrowserContext) {
  // Observe browser resource lifetime only; the game's audio implementation is unchanged.
  await context.addInitScript(() => {
    const observed = window as AudioProbeWindow;
    observed.__catalogAudioContexts = [];
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        observed.__catalogAudioContexts!.push(this);
      }
    };
  });
}
async function waitForTikaDecision(page: Page) {
  await expect(page.locator('[data-testid^="tika-target-"]:enabled').first()).toBeVisible();
}
async function leave(page: Page) {
  await page.getByRole('button', { name: '방 나가기', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '방 나가기', exact: true }).click();
  await expect(page.getByTestId('nickname-input')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect
    .poll(async () => (await audioStates(page)).every((state) => state === 'closed'))
    .toBe(true);
}
const stableTika = (state: TikatukaRoomState) => ({
  gameType: state.gameType,
  gameId: state.gameId,
  version: state.version,
  phase: state.phase,
  stage: state.stage,
  turnId: state.turnId,
  turnPlayerId: state.turnPlayerId,
  pendingDie: state.pendingDie,
  rerollChoices: state.rerollChoices,
  players: state.players.map((player) => ({
    id: player.id,
    kind: player.kind,
    lanes: player.lanes,
    held: player.held,
    rerollUsed: player.rerollUsed,
    laneScores: player.laneScores,
    laneWins: player.laneWins,
    total: player.total,
    forfeited: player.forfeited,
  })),
});

test('catalog preserves shared input/settings, releases game resources and isolates Yacht/Tikatuka rooms', async ({
  browser,
  baseURL,
}, info) => {
  // Four rooms total: Yacht→Tikatuka→Yacht for one guest, one independent Tikatuka opponent room.
  // Every server interaction is an ordinary browser action, including against PLAYWRIGHT_BASE_URL.
  const contexts: BrowserContext[] = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1366, height: 900 },
      reducedMotion: 'reduce',
    });
    await observeAudio(context);
    contexts.push(context);
  }
  const page = await contexts[0].newPage();
  const independent = await contexts[1].newPage();
  const errors: string[] = [];
  for (const current of [page, independent])
    current.on('pageerror', (error) => errors.push(error.name));
  const initialScripts: string[] = [];
  const observeScript = (request: import('@playwright/test').Request) => {
    if (request.resourceType() === 'script') initialScripts.push(new URL(request.url()).pathname);
  };
  page.on('request', observeScript);
  try {
    await page.goto('/');
    await page.getByTestId('nickname-input').fill('게임 전환 손님');
    await page.getByTestId('join-code').fill('ABCDEFGH');
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('dialog').locator('input[type="checkbox"]').first().check();
    await page.getByRole('slider', { name: '효과음 볼륨' }).press('ArrowRight');
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    const savedSettings = await settings(page);
    await page.getByTestId('game-card-tikatuka').click();
    await expect(page.getByTestId('game-card-tikatuka')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('nickname-input')).toHaveValue('게임 전환 손님');
    await expect(page.getByTestId('join-code')).toHaveValue('ABCDEFGH');
    expect(await settings(page)).toEqual(savedSettings);
    await page.getByRole('button', { name: '게임 방법', exact: true }).first().click();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: '진행과 주사위' }),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).not.toContainText('야추');
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.screenshot({
      path: info.outputPath('catalog-tikatuka-desktop.png'),
      fullPage: true,
    });
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 800, height: 360 },
      { width: 1366, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await noOverflow(page);
      await expect(page.getByTestId('game-card-yacht')).toBeVisible();
      await expect(page.getByTestId('game-card-tikatuka')).toBeVisible();
    }
    expect(
      initialScripts.filter((path) =>
        /YachtGame|TikatukaGame|(?:\/|-)(?:scene|audio|three|orientations|materials|motion)(?:[.-]|\/)/i.test(
          path,
        ),
      ),
    ).toEqual([]);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await audioStates(page)).toEqual([]);
    page.off('request', observeScript);

    // First Yacht room, retaining the same nickname/settings across the whole sequence.
    await page.getByTestId('game-card-yacht').click();
    await page.getByTestId('solo-button').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    const firstYacht = await yachtState(page);
    const playerId = await sessionId(page);
    await expect(page.locator('canvas')).toHaveCount(1);

    // An independent Tika room waits at a human decision while the Yacht room changes.
    await independent.goto('/');
    await independent.getByTestId('nickname-input').fill('독립 경기 손님');
    await independent.getByTestId('game-card-tikatuka').click();
    await independent.getByTestId('solo-button').click();
    await waitForTikaDecision(independent);
    const independentId = await sessionId(independent);
    expect(independentId).not.toBe(playerId);
    const independentBefore = await tikaState(independent);
    expect(independentBefore.turnPlayerId).toBe(independentId);
    expect(independentBefore.aiDueAt).toBeNull();
    expect(independentBefore.gameId).not.toBe(firstYacht.gameId);
    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('die-0')).toBeEnabled();
    await expect.poll(async () => (await yachtState(page)).rolls).toBe(1);
    await page.getByTestId('roll-button').press('1');
    await expect.poll(async () => (await yachtState(page)).dice[0].held).toBe(true);
    await page.getByTestId('score-choice').click();
    await page.getByTestId('confirm-score').click();
    await expect.poll(async () => (await yachtState(page)).players[0].scores.choice).not.toBeNull();
    expect(stableTika(await tikaState(independent))).toEqual(stableTika(independentBefore));
    const independentCode = await getCode(independent);
    const independentServer = await independent.evaluate(
      async (code) =>
        (await (
          await fetch(`/api/rooms/${code}`, { headers: { 'X-Game-Protocol': '2' } })
        ).json()) as { state: TikatukaRoomState },
      independentCode,
    );
    expect(stableTika(independentServer.state)).toEqual(stableTika(independentBefore));

    const beforeBrowse = await yachtState(page);
    await expect.poll(async () => (await audioStates(page)).length).toBeGreaterThan(0);
    await page.getByRole('button', { name: '게임 목록', exact: true }).click();
    await page.getByTestId('game-card-tikatuka').click();
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect
      .poll(async () => (await audioStates(page)).every((state) => state === 'closed'))
      .toBe(true);
    expect((await yachtState(page)).gameId).toBe(beforeBrowse.gameId);
    expect((await yachtState(page)).players[0].forfeited).toBe(false);
    expect((await yachtState(page)).players[0].connected).toBe(true);
    await expect(page.getByTestId('nickname-input')).toHaveValue('게임 전환 손님');
    expect(await settings(page)).toEqual(savedSettings);
    await page.getByTestId('resume-game').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    expect((await yachtState(page)).gameId).toBe(firstYacht.gameId);
    expect((await yachtState(page)).players[0].scores).toEqual(beforeBrowse.players[0].scores);
    await expect(page.locator('canvas')).toHaveCount(1);
    await leave(page);

    // Third room: the original guest chooses Tika and plays an ordinary AI turn.
    await page.getByTestId('game-card-tikatuka').click();
    await page.getByTestId('solo-button').click();
    await waitForTikaDecision(page);
    expect(await sessionId(page)).toBe(playerId);
    const firstTika = await tikaState(page);
    expect(firstTika.gameId).not.toBe(firstYacht.gameId);
    await page.locator('[data-testid^="tika-target-"]:enabled').first().click();
    await expect(page.getByTestId('tika-confirm')).toBeEnabled();
    await page.getByTestId('tika-confirm').click();
    await expect
      .poll(async () => (await tikaState(page)).version)
      .toBeGreaterThan(firstTika.version);
    await waitForTikaDecision(page);
    const tikaBeforeBrowse = await tikaState(page);
    await page.getByRole('button', { name: '게임 목록', exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect
      .poll(async () => (await audioStates(page)).every((state) => state === 'closed'))
      .toBe(true);
    await page.getByTestId('game-card-yacht').click();
    await page.getByTestId('resume-game').click();
    await waitForTikaDecision(page);
    expect(stableTika(await tikaState(page))).toEqual(stableTika(tikaBeforeBrowse));
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 800, height: 360 },
      { width: 1366, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await noOverflow(page);
      await expect(page.getByRole('button', { name: '방 나가기', exact: true })).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`catalog-tikatuka-game-${viewport.width}.png`),
        fullPage: true,
      });
    }
    await leave(page);

    // Fourth room: returning to Yacht creates fresh game data without replacing the guest/settings.
    await page.getByTestId('game-card-yacht').click();
    await page.getByTestId('solo-button').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    const finalYacht = await yachtState(page);
    expect(finalYacht.gameId).not.toBe(firstYacht.gameId);
    expect(finalYacht.gameId).not.toBe(firstTika.gameId);
    expect(finalYacht.players[0].id).toBe(playerId);
    expect(finalYacht.players[0].scores.choice).toBeNull();
    expect(await settings(page)).toEqual(savedSettings);
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 800, height: 360 },
      { width: 1366, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await noOverflow(page);
    }
    await leave(page);
    await leave(independent);
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});
