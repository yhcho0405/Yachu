import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getTikatukaTargets, type TikatukaRoomState } from '../../src/shared/tikatuka';
import type { RoomState } from '../../src/shared/protocol';
import { getCode, expectInViewport } from './helpers';

async function state(page: Page): Promise<TikatukaRoomState> {
  const raw = await page.getByTestId('game-state').getAttribute('data-state');
  if (!raw) throw new Error('Missing public state');
  const value = JSON.parse(raw) as RoomState;
  if (value.gameType !== 'tikatuka') throw new Error('Expected Tikatuka');
  return value;
}
const stable = (s: TikatukaRoomState) =>
  JSON.stringify({
    gameType: s.gameType,
    gameId: s.gameId,
    version: s.version,
    turnId: s.turnId,
    turnPlayerId: s.turnPlayerId,
    phase: s.phase,
    stage: s.stage,
    pendingDie: s.pendingDie,
    rerollChoices: s.rerollChoices,
    players: s.players.map((p) => ({
      id: p.id,
      lanes: p.lanes,
      held: p.held,
      rerollUsed: p.rerollUsed,
      laneScores: p.laneScores,
      laneWins: p.laneWins,
      total: p.total,
    })),
    results: s.results,
  });
async function agree(pages: Page[]) {
  if (pages.length === 1) return state(pages[0]);
  const expected = stable(await state(pages[0]));
  await expect
    .poll(async () => Promise.all(pages.map(async (p) => stable(await state(p)) === expected)))
    .toEqual(pages.map(() => true));
  return state(pages[0]);
}
async function setup(browser: Browser, baseURL: string, solo: boolean) {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < (solo ? 1 : 2); i++) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1366, height: 900 },
      reducedMotion: 'reduce',
    });
    contexts.push(context);
    pages.push(await context.newPage());
  }
  await pages[0].goto('/');
  await pages[0].getByTestId('game-card-tikatuka').click();
  await pages[0].getByTestId('nickname-input').fill('티카투카 1');
  await pages[0].getByTestId(solo ? 'solo-button' : 'create-room').click();
  const code = await getCode(pages[0]);
  if (!solo) {
    await pages[1].goto(`/?room=${code}`);
    await pages[1].getByTestId('nickname-input').fill('티카투카 2');
    await pages[1].getByTestId('join-room').click();
    await expect(pages[1].getByTestId('ready-button')).toBeVisible();
    await pages[1].getByTestId('ready-button').click();
    await expect(pages[0].getByTestId('start-game')).toBeEnabled();
    await pages[0].getByTestId('start-game').click();
  }
  await expect(pages[0].getByTestId('tika-game')).toBeVisible();
  const ids = await Promise.all(
    pages.map((p) =>
      p.evaluate(
        async () => ((await (await fetch('/api/session')).json()) as { playerId: string }).playerId,
      ),
    ),
  );
  expect(new Set(ids).size).toBe(ids.length);
  const initial = await agree(pages);
  expect(initial.players).toHaveLength(2);
  expect(initial.players.filter((p) => p.kind === 'computer')).toHaveLength(solo ? 1 : 0);
  return { contexts, pages, ids, code };
}
async function move(page: Page, before: TikatukaRoomState, choiceIndex = 0) {
  if (before.stage === 'choosingReroll') {
    await expect(page.getByTestId('tika-choose-rerolled')).toBeEnabled();
    await page.getByTestId('tika-choose-rerolled').click();
  } else {
    const targets = getTikatukaTargets(before);
    expect(targets.length).toBeGreaterThan(0);
    const target =
      targets.find((t) => t.action === 'attack') ?? targets[choiceIndex % targets.length];
    const seat = before.players.find((p) => p.id === target.ownerId)!.seat;
    const button = page.getByTestId(`tika-target-${seat}-${target.lane}`);
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByTestId('tika-confirm')).toBeEnabled();
    // Selection is a local preview; the board and authoritative revision stay unchanged.
    expect(stable(await state(page))).toBe(stable(before));
    await page.getByTestId('tika-confirm').click();
  }
  await expect.poll(async () => (await state(page)).version).toBeGreaterThan(before.version);
}
for (const solo of [false, true])
  test(`Tikatuka ${solo ? 'computer opponent' : 'two independent guests'}: complete game, sync, invite and rematch`, async ({
    browser,
    baseURL,
  }, info) => {
    const game = await setup(browser, baseURL!, solo);
    let steps = 0;
    const rerolled = new Set<string>();
    let attack = false;
    let shield = false;
    try {
      let current = await agree(game.pages);
      if (current.turnPlayerId === game.ids[0] && current.stage === 'placing') {
        const target = getTikatukaTargets(current)[0];
        const seat = current.players.find((player) => player.id === target.ownerId)!.seat;
        await game.pages[0].getByTestId(`tika-target-${seat}-${target.lane}`).click();
        await expect(game.pages[0].getByTestId('tika-confirm')).toBeEnabled();
        await expectInViewport(game.pages[0], [
          '.tikatuka-board-viewport',
          '.tika-status',
          '.tika-panel',
          '[data-testid="tika-confirm"]',
          '.tika-scoreboard',
        ]);
      }
      await game.pages[0].screenshot({
        path: info.outputPath(`tikatuka-${solo ? 'computer' : 'online'}-start.png`),
        fullPage: true,
      });
      while (current.phase === 'playing') {
        if (++steps > 180) throw new Error('Tikatuka did not finish within the finite board bound');
        const actorIndex = game.ids.indexOf(current.turnPlayerId!);
        if (actorIndex < 0) {
          const v = current.version;
          await expect
            .poll(async () => (await state(game.pages[0])).version, { timeout: 20000 })
            .toBeGreaterThan(v);
        } else {
          const page = game.pages[actorIndex];
          if (!rerolled.has(current.turnPlayerId!) && current.stage === 'placing') {
            await expect(page.getByTestId('tika-reroll')).toBeEnabled();
            await page.getByTestId('tika-reroll').click();
            await expect.poll(async () => (await state(page)).stage).toBe('choosingReroll');
            current = await agree(game.pages);
            rerolled.add(current.turnPlayerId!);
            await page.screenshot({
              path: info.outputPath(`reroll-${actorIndex}.png`),
              fullPage: true,
            });
            const candidates = current.rerollChoices;
            await page.reload();
            await expect(page.getByTestId('tika-game')).toBeVisible();
            current = await agree(game.pages);
            expect(current.rerollChoices).toEqual(candidates);
          }
          await move(page, current, steps);
        }
        current = await agree(game.pages);
        if (current.latestEvent?.type === 'attack' && !attack) {
          attack = true;
          expect(current.stage).toBe('placing');
          expect(current.pendingDie?.source).toBe('bonus');
          await game.pages[0].screenshot({
            path: info.outputPath('attack-bonus.png'),
            fullPage: true,
          });
        }
        if (current.latestEvent?.type === 'place' && current.latestEvent.die?.kind === 'shield')
          shield = true;
      }
      expect(current.results).toHaveLength(2);
      expect(shield).toBe(true);
      expect(current.players.every((p) => p.held || p.lanes.every((l) => l.length === 3))).toBe(
        true,
      );
      await game.pages[0].screenshot({
        path: info.outputPath('tikatuka-result.png'),
        fullPage: true,
      });
      await expect(game.pages[0].getByTestId('rematch')).toBeVisible();
      const gameId = current.gameId;
      await game.pages[0].getByTestId('rematch').click();
      await expect(game.pages[0].getByTestId('start-game')).toBeVisible();
      current = await agree(game.pages);
      expect(current.gameId).not.toBe(gameId);
      expect(current.gameType).toBe('tikatuka');
      expect(
        current.players.every(
          (p) => p.lanes.every((l) => l.length === 0) && !p.held && !p.rerollUsed,
        ),
      ).toBe(true);
      if (!solo) {
        await game.pages[1].getByTestId('ready-button').click();
        await expect(game.pages[0].getByTestId('start-game')).toBeEnabled();
      }
      await game.pages[0].getByTestId('start-game').click();
      await expect(game.pages[0].getByTestId('tika-game')).toBeVisible();
      expect((await agree(game.pages)).phase).toBe('playing');
      await info.attach('tikatuka-summary', {
        body: JSON.stringify({
          solo,
          steps,
          observedAttack: attack,
          observedShield: shield,
          rerolledPlayers: rerolled.size,
        }),
        contentType: 'application/json',
      });
    } finally {
      for (const c of game.contexts) await c.close();
    }
  });
