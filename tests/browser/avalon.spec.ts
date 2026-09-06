import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  getAvalonActions,
  getAvalonQuestSize,
  type AvalonRoomState,
  type AvalonStage,
} from '../../src/shared/avalon';
import { audioResources, expectOnlySharedMusic, observeAudio } from './audio-probe';
import { getCode, expectInViewport } from './helpers';

async function state(page: Page): Promise<AvalonRoomState> {
  await expect(page.getByTestId('game-state')).toHaveAttribute('data-state', /"gameType":"avalon"/);
  const raw = await page.getByTestId('game-state').getAttribute('data-state');
  if (!raw) throw new Error('Missing room snapshot');
  const value = JSON.parse(raw) as AvalonRoomState;
  if (value.gameType !== 'avalon') throw new Error('Expected Avalon room');
  return value;
}
async function snapshot(page: Page, code: string): Promise<AvalonRoomState> {
  return page.evaluate(async (roomCode) => {
    const response = await fetch(`/api/rooms/${roomCode}`, {
      cache: 'no-store',
      headers: { 'X-Game-Protocol': '3' },
    });
    if (!response.ok) throw new Error(`Snapshot failed: ${response.status}`);
    return ((await response.json()) as { state: AvalonRoomState }).state;
  }, code);
}
function publicGame(value: AvalonRoomState) {
  const { privateInfo: _privateInfo, ...publicValue } = value;
  return JSON.stringify(publicValue);
}
async function agree(pages: Page[]) {
  const expected = publicGame(await state(pages[0]));
  await expect
    .poll(async () =>
      (await Promise.all(pages.map(state))).every((value) => publicGame(value) === expected),
    )
    .toBe(true);
  return state(pages[0]);
}
async function stage(page: Page, value: AvalonStage) {
  await expect.poll(async () => (await state(page)).stage).toBe(value);
}
async function inputReady(page: Page) {
  await expect.poll(async () => (await state(page)).inputAfter <= Date.now()).toBe(true);
}
async function selectSeats(page: Page, room: AvalonRoomState, ids: string[]) {
  await inputReady(page);
  const firstSeat = room.players.find((player) => player.id === ids[0])!.seat;
  const boardName = page.getByTestId(`av-board-seat-${firstSeat}`);
  await boardName.click();
  await expect(boardName).toHaveAttribute('aria-pressed', 'true');
  if (ids.length === 1) return;
  const details = page.getByTestId('av-seat-details');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  for (const id of ids.slice(1)) {
    const seat = room.players.find((player) => player.id === id)!.seat;
    const button = page.getByTestId(`av-seat-${seat}`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
}
async function vote(page: Page, approve: boolean) {
  await page.getByTestId(approve ? 'av-vote-approve' : 'av-vote-reject').click();
  await page.getByTestId('av-vote-submit').click();
}
async function card(page: Page, fail: boolean) {
  await page.getByTestId(fail ? 'av-card-fail' : 'av-card-success').click();
  await page.getByTestId('av-card-submit').click();
}
async function musicPlaying(page: Page, prefix: 'lobby' | 'aval') {
  await expect
    .poll(async () => {
      const active = (await audioResources(page))
        .flatMap((record) => record.media)
        .filter((media) => !media.paused);
      return (
        active.length === 1 &&
        active[0].src.startsWith(`/music/${prefix}`) &&
        active[0].currentTime > 0 &&
        active[0].error === null
      );
    })
    .toBe(true);
}
async function captureReadiness(page: Page) {
  return page.evaluate(async () => {
    const element = document.querySelector('[data-testid="av-results"]');
    const bounds = element?.getBoundingClientRect();
    let frames = 0;
    let pending: number;
    const sample = () => {
      frames++;
      pending = requestAnimationFrame(sample);
    };
    pending = requestAnimationFrame(sample);
    await new Promise((resolve) => setTimeout(resolve, 350));
    cancelAnimationFrame(pending);
    return {
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      frames,
      bounds: bounds
        ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        : null,
    };
  });
}
async function crossfadeToLobby(page: Page) {
  let before: number[] = [];
  await expect
    .poll(
      async () => {
        const music = (await audioResources(page)).find((record) => record.media.length === 2);
        const active = music?.media.filter((media) => !media.paused) ?? [];
        const overlapping =
          active.length === 2 &&
          active.some((media) => media.src === '/music/aval1.mp3') &&
          active.some((media) => media.src.startsWith('/music/lobby'));
        if (overlapping) before = music!.gains;
        return overlapping;
      },
      { intervals: [20] },
    )
    .toBe(true);
  await page.waitForTimeout(200);
  const after = (await audioResources(page)).find((record) => record.media.length === 2)!.gains;
  expect(after.some((value, index) => value > before[index] + 0.005)).toBe(true);
  expect(after.some((value, index) => value < before[index] - 0.005)).toBe(true);
}

for (const count of [5, 10]) {
  test(`Avalon ${count} guests complete secret votes, four quests, assassination and rematch through normal UI`, async ({
    browser,
    baseURL,
  }, info) => {
    // One ordinary room per test, including live runs. Each page only reads its own recipient
    // projection. No role/RNG override, hidden server state, malformed command, or clock injection.
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    const errors: string[] = [];
    let checkpoint = '브라우저 준비';
    try {
      for (let index = 0; index < count; index++) {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 1366, height: 900 },
          reducedMotion: 'reduce',
        });
        if (index === 0) await observeAudio(context);
        contexts.push(context);
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.name));
        pages.push(page);
      }
      const host = pages[0];
      checkpoint = '입장 · 방 생성';
      await host.goto('/');
      await host.getByTestId('game-card-avalon').click();
      await expect(host.getByTestId('solo-button')).toHaveCount(0);
      await host.getByTestId('nickname-input').fill(`원탁 ${count}인 1`);
      await host.getByTestId('create-room').click();
      const code = await getCode(host);
      await expect(host.getByTestId('start-game')).toBeDisabled();
      for (let index = 1; index < count; index++) {
        checkpoint = `입장 · 참가자 ${index + 1}`;
        await pages[index].goto(`/?room=${code}`);
        await pages[index].getByTestId('nickname-input').fill(`원탁 ${count}인 ${index + 1}`);
        await pages[index].getByTestId('join-room').click();
        await expect(pages[index].getByTestId('room-code')).toBeVisible();
        await expect(pages[index].getByTestId('game-state')).toHaveAttribute(
          'data-game-type',
          'avalon',
        );
      }
      checkpoint = '설정';
      if (count === 10) {
        for (const role of ['percival', 'morgana', 'mordred', 'oberon'] as const) {
          await host.getByTestId(`av-option-${role}`).click();
          await expect
            .poll(async () => (await state(host)).config.optionalRoles.includes(role))
            .toBe(true);
        }
        await host.getByTestId('av-option-lady').click();
        await expect.poll(async () => (await state(host)).config.ladyOfLake).toBe(true);
      }
      for (let index = 1; index < count; index++) {
        checkpoint = `준비 · 참가자 ${index + 1}`;
        await pages[index].getByTestId('ready-button').click();
        await expect
          .poll(async () => (await state(host)).players.filter((player) => player.ready).length)
          .toBeGreaterThanOrEqual(index);
      }
      checkpoint = '시작 · 상태 수신';
      await host.getByTestId('start-game').click();
      await Promise.all(pages.map((page) => stage(page, 'team')));
      let room = await agree(pages);
      const gameId = room.gameId;
      const projections = await Promise.all(pages.map(state));
      const ids = projections.map((value) => value.privateInfo!.playerId);
      expect(new Set(ids).size).toBe(count);
      const ownRoles = projections.map((value) => value.privateInfo!.role);
      const evilIndex = projections.findIndex((value) => value.privateInfo!.alignment === 'evil');
      const assassinIndex = ownRoles.indexOf('assassin');
      const merlinIndex = ownRoles.indexOf('merlin');
      const byId = (id: string) => pages[ids.indexOf(id)];
      expect(room.revealedRoles).toEqual([]);
      checkpoint = '시작 · 수신자별 HTTP 일치';
      for (let index = 0; index < count; index++) {
        const api = await snapshot(pages[index], code);
        expect(api.privateInfo?.playerId).toBe(ids[index]);
        expect(api.privateInfo?.role).toBe(ownRoles[index]);
        expect(publicGame(api)).toBe(publicGame(room));
      }
      checkpoint = '목록 왕복 · 음악';
      await musicPlaying(host, 'aval');
      const beforeBrowse = publicGame(room);
      await Promise.all([
        crossfadeToLobby(host),
        host.getByRole('button', { name: '게임 목록', exact: true }).click(),
      ]);
      await musicPlaying(host, 'lobby');
      await expectOnlySharedMusic(host);
      expect(publicGame(await state(host))).toBe(beforeBrowse);
      await host.getByTestId('resume-game').click();
      await musicPlaying(host, 'aval');
      expect((await state(host)).gameId).toBe(gameId);
      await expect(host.locator('canvas')).toHaveCount(1);

      // Role opening, note editing and unconfirmed seat selection are local-only actions.
      checkpoint = '개인 패널 · 메모';
      const localVersion = (await state(host)).version;
      await host.getByTestId('av-private-toggle').click();
      await host.getByTestId('av-notes').fill('개인 메모 · 전송하지 않음');
      await expect(host.getByTestId('av-own-role')).toBeVisible();
      expect((await snapshot(host, code)).version).toBe(localVersion);
      await host.getByTestId('av-private-toggle').click();
      await expect(host.getByTestId('av-private-content')).toHaveCount(0);
      for (const width of [360, 800, 1366]) {
        checkpoint = `화면 배치 · 폭 ${width}`;
        await host.setViewportSize({ width, height: 900 });
        await expect
          .poll(() => host.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true);
        await expect(host.locator('.avalon-board-name')).toHaveCount(count);
        if (width < 901) {
          const order = await host.evaluate(() =>
            [
              '.avalon-board-area',
              '#avalon-action',
              '.avalon-private-area',
              '#avalon-discussion',
              '#avalon-history',
            ].map((selector) => document.querySelector(selector)!.getBoundingClientRect().top),
          );
          expect(order.every((value, index) => index === 0 || value > order[index - 1])).toBe(true);
        } else {
          await host.evaluate(() => scrollTo(0, 0));
          await expectInViewport(host, [
            '.avalon-status',
            '.avalon-tracks',
            '.avalon-board',
            '#avalon-action',
            '.avalon-private-area',
            '#avalon-discussion',
          ]);
        }
        checkpoint = `초기 화면 캡처 · 폭 ${width}`;
        await host.screenshot({
          path: info.outputPath(`avalon-${count}-${width}.png`),
          fullPage: true,
        });
      }
      checkpoint = '첫 투표 · 원정대 초안';
      room = await state(host);
      const teamFor = (value: AvalonRoomState) =>
        [ids[evilIndex], ...ids.filter((id) => id !== ids[evilIndex])].slice(
          0,
          getAvalonQuestSize(count, value.questNumber),
        );
      const firstLeader = byId(room.leaderId!);
      const firstTeam = teamFor(room);
      await selectSeats(firstLeader, room, firstTeam);
      expect((await snapshot(host, code)).version).toBe(room.version);
      expect((await state(pages[1])).proposal).toBeNull();
      checkpoint = '첫 투표 · 제안 확정';
      await firstLeader.getByTestId('av-team-confirm').click();
      await Promise.all(pages.map((page) => stage(page, 'vote')));
      await agree(pages);
      // Another participant's submission and a chat update must preserve an unsubmitted draft.
      checkpoint = '첫 투표 · 일부 제출';
      await pages[1].getByTestId('av-vote-approve').click();
      await vote(host, false);
      await expect(host.getByTestId('av-submitted')).toBeVisible();
      await expect(pages[1].getByTestId('av-vote-approve')).toHaveAttribute('aria-pressed', 'true');
      checkpoint = '첫 투표 · 채팅과 반응';
      const message = '\u1112\u1161\u11ab\u1100\u1173\u11af <b>그대로 보이는 의견</b>';
      await pages[2].getByTestId('av-chat-input').fill(message);
      if (count === 5 && !process.env.PLAYWRIGHT_BASE_URL) {
        checkpoint = '로컬 채팅 · 오류 복구';
        // Local client recovery only: reject two chat requests at the browser boundary.
        // No rate-limit requests reach the server; deployed runs keep ordinary UI traffic.
        const chatter = pages[2];
        const endpoint = `**/api/rooms/${code}/command`;
        const repeatedError = '잠시 기다린 뒤 채팅을 다시 보내 주세요.';
        let rejected = 0;
        let completedWithoutHistory = 0;
        await chatter.route(endpoint, async (route) => {
          const request = route.request();
          if (
            request.method() === 'POST' &&
            (request.postDataJSON() as { type?: string }).type === 'av_chat' &&
            rejected < 2
          ) {
            rejected++;
            await route.fulfill({
              status: 429,
              contentType: 'application/json',
              body: JSON.stringify({ code: 'RATE_LIMITED', error: repeatedError }),
            });
          } else if (
            request.method() === 'POST' &&
            (request.postDataJSON() as { type?: string }).type === 'av_chat' &&
            completedWithoutHistory === 0
          ) {
            // The request has completed, but its message is no longer in the latest history.
            // Keep the response at the client boundary; do not manufacture server chat entries.
            completedWithoutHistory++;
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                type: 'result',
                requestId: (request.postDataJSON() as { requestId: string }).requestId,
              }),
            });
          } else await route.continue();
        });
        try {
          for (let attempt = 1; attempt <= 2; attempt++) {
            await chatter.getByTestId('av-chat-send').click();
            await expect.poll(() => rejected).toBe(attempt);
            await expect(chatter.locator('.connection-banner')).toContainText(repeatedError);
            await expect(chatter.getByTestId('av-chat-input')).toHaveValue(message);
            await expect(
              chatter.getByTestId('av-chat-send'),
              `same error retry ${attempt} restores submit`,
            ).toBeEnabled();
            await expect(chatter.getByTestId('av-chat-send')).toHaveText('보내기');
            expect((await state(host)).chat).toHaveLength(0);
          }
          await chatter.getByTestId('av-chat-send').click();
          await expect.poll(() => completedWithoutHistory).toBe(1);
          await expect
            .poll(() =>
              chatter.evaluate(
                () =>
                  (JSON.parse(sessionStorage.getItem('atelier.pending') || '[]') as unknown[])
                    .length,
              ),
            )
            .toBe(0);
          await expect(chatter.getByTestId('av-chat-send')).toBeEnabled();
          await expect(chatter.getByTestId('av-chat-send')).toHaveText('보내기');
          await expect(chatter.getByTestId('av-chat-input')).toHaveValue(message);
          expect((await state(host)).chat).toHaveLength(0);
        } finally {
          await info.attach('local-chat-recovery', {
            contentType: 'application/json',
            body: JSON.stringify({
              rejected,
              completedWithoutHistory,
              button: await chatter.getByTestId('av-chat-send').innerText(),
              disabled: await chatter.getByTestId('av-chat-send').isDisabled(),
              draftPreserved: (await chatter.getByTestId('av-chat-input').inputValue()) === message,
              pendingCount: await chatter.evaluate(
                () =>
                  (JSON.parse(sessionStorage.getItem('atelier.pending') || '[]') as unknown[])
                    .length,
              ),
            }),
          });
          await chatter.unroute(endpoint);
        }
      }
      checkpoint = '첫 투표 · 정상 채팅 전송';
      await pages[2].getByTestId('av-chat-send').click();
      await expect(pages[2].getByTestId('av-chat-input')).toHaveValue('');
      await expect(host.getByTestId('av-chat-message').last()).toContainText(
        message.normalize('NFC'),
      );
      await expect(host.getByTestId('av-chat-message').last().locator('b')).toHaveCount(0);
      await expect(pages[1].getByTestId('av-vote-approve')).toHaveAttribute('aria-pressed', 'true');
      await pages[2].getByTestId('av-discussion-expand').click();
      await pages[2].getByTestId('av-signal-target').selectOption(ids[0]);
      await pages[2].getByTestId('av-signal-trust').click();
      await expect.poll(async () => (await state(host)).signals.length).toBe(1);
      expect((await state(host)).history.proposals).toHaveLength(0);
      for (let index = 1; index < count; index++)
        expect((await state(pages[index])).privateInfo!.myVote).toBeNull();
      checkpoint = '첫 투표 · 새로고침';
      await host.reload();
      await stage(host, 'vote');
      await expect(host.getByTestId('av-submitted')).toBeVisible();
      expect((await state(host)).privateInfo!.role).toBe(ownRoles[0]);
      expect((await state(host)).privateInfo!.myVote).toBe(false);
      await host.getByTestId('av-private-toggle').click();
      await expect(host.getByTestId('av-notes')).toHaveValue('개인 메모 · 전송하지 않음');
      await host.getByTestId('av-private-toggle').click();
      checkpoint = '첫 투표 · 전원 제출과 부결';
      await pages[1].getByTestId('av-vote-submit').click();
      await Promise.all(pages.slice(2).map((page) => vote(page, false)));
      await stage(host, 'team');
      room = await agree(pages);
      expect(room.rejections).toBe(1);
      expect(room.history.proposals[0].votes.filter((value) => value.approve)).toHaveLength(1);
      await host.locator('#avalon-history > summary').click();
      await expect(host.getByTestId('av-vote-table')).toBeVisible();
      await expect(host.getByTestId('av-vote-table')).toContainText('반대');
      await host.locator('#avalon-history > summary').click();

      for (let quest = 1; quest <= 4; quest++) {
        checkpoint = `원정 ${quest} · 구성`;
        await stage(host, 'team');
        room = await agree(pages);
        expect(room.questNumber).toBe(quest);
        const team = teamFor(room);
        const leader = byId(room.leaderId!);
        await selectSeats(leader, room, team);
        await leader.getByTestId('av-team-confirm').click();
        await Promise.all(pages.map((page) => stage(page, 'vote')));
        checkpoint = `원정 ${quest} · 전원 투표`;
        await Promise.all(pages.map((page) => vote(page, true)));
        await Promise.all(pages.map((page) => stage(page, 'quest')));
        room = await agree(pages);
        expect(room.history.proposals.at(-1)!.votes).toHaveLength(count);
        expect(room.history.proposals.at(-1)!.approved).toBe(true);
        const failId = quest === 1 || (count === 10 && quest === 4) ? ids[evilIndex] : null;
        const firstId = team[0];
        for (const id of team) {
          const memberPage = byId(id);
          if (projections[ids.indexOf(id)].privateInfo!.alignment === 'good')
            await expect(memberPage.getByTestId('av-card-fail')).toBeDisabled();
        }
        checkpoint = `원정 ${quest} · 일부 카드 제출`;
        await card(byId(firstId), firstId === failId);
        await expect(byId(firstId).getByTestId('av-submitted')).toBeVisible();
        // A partial quest reveals only submitted membership, never another player's card.
        for (const page of pages.filter((value) => value !== byId(firstId))) {
          const partial = await state(page);
          expect(partial.privateInfo!.myQuestCard).toBeNull();
          expect(partial.history.quests).toHaveLength(quest - 1);
        }
        checkpoint = `원정 ${quest} · 카드 집계`;
        await Promise.all(team.slice(1).map((id) => card(byId(id), id === failId)));
        await expect.poll(async () => (await state(host)).history.quests.length).toBe(quest);
        room = await agree(pages);
        const result = room.history.quests.at(-1)!;
        expect(result.failCount).toBe(failId ? 1 : 0);
        expect(result.failed).toBe(quest === 1);
        expect(room.revealedRoles).toHaveLength(0);
        if (room.stage === 'lady') {
          checkpoint = `원정 ${quest} · Lady`;
          const holderId = room.lady!.holderId;
          const holder = byId(holderId);
          const personal = await state(holder);
          const targetId = getAvalonActions(personal, holderId).ladyTargetIds[0];
          await selectSeats(holder, room, [targetId]);
          await holder.getByTestId('av-lady-confirm').click();
          await stage(host, 'team');
          room = await agree(pages);
          const insight = (await state(holder)).privateInfo!.ladyInsights.at(-1)!;
          expect(insight.targetId).toBe(targetId);
          expect(insight.alignment).toBe(projections[ids.indexOf(targetId)].privateInfo!.alignment);
          expect(room.lady!.holderId).toBe(targetId);
          expect(Object.keys(room.lady!.investigations.at(-1)!)).not.toContain('alignment');
          for (let index = 0; index < count; index++) {
            const personalInsights = (await state(pages[index])).privateInfo!.ladyInsights;
            expect(personalInsights.every((value) => value.actorId === ids[index])).toBe(true);
          }
        }
      }
      checkpoint = '암살';
      await stage(host, 'assassination');
      room = await agree(pages);
      expect(room.winner).toBeNull();
      expect(room.history.quests.filter((value) => !value.failed)).toHaveLength(3);
      const assassin = pages[assassinIndex];
      const targetIndex =
        count === 5
          ? merlinIndex
          : ids.findIndex((_, index) => index !== assassinIndex && index !== merlinIndex);
      expect(
        getAvalonActions(await state(assassin), ids[assassinIndex]).assassinationTargetIds,
      ).toHaveLength(count - 1);
      await selectSeats(assassin, room, [ids[targetIndex]]);
      await assassin.getByTestId('av-assassinate-confirm').click();
      checkpoint = '최종 결과 확인';
      await stage(host, 'finished');
      room = await agree(pages);
      expect(room.winner).toBe(count === 5 ? 'evil' : 'good');
      expect(room.revealedRoles).toHaveLength(count);
      await expect(host.getByTestId('av-results')).toContainText(
        count === 5 ? '악 승리' : '선 승리',
      );
      checkpoint = '결과 캡처';
      await expect(host.getByTestId('av-role-reveal').locator(':scope > div')).toHaveCount(count);
      const beforeActivation = await captureReadiness(host);
      // The final action can belong to another browser page. Activate the observed
      // results page so its animation frames and compositor are available for capture.
      await host.bringToFront();
      await info.attach('avalon-capture-readiness', {
        contentType: 'application/json',
        body: JSON.stringify({ beforeActivation, afterActivation: await captureReadiness(host) }),
      });
      await host.getByTestId('av-results').screenshot({
        path: info.outputPath(`avalon-${count}-result.png`),
      });
      checkpoint = '재경기 · 로비';
      await host.getByTestId('rematch').click();
      await stage(host, 'lobby');
      expect((await state(host)).privateInfo).toBeNull();
      checkpoint = '재경기 · 준비';
      for (let index = 1; index < count; index++) {
        await pages[index].getByTestId('ready-button').click();
        await expect
          .poll(async () => (await state(host)).players.filter((player) => player.ready).length)
          .toBeGreaterThanOrEqual(index);
      }
      checkpoint = '재경기 · 시작';
      await host.getByTestId('start-game').click();
      await stage(host, 'team');
      room = await agree(pages);
      expect(room.gameId).not.toBe(gameId);
      expect(room.players.map((player) => player.id)).toEqual(ids);
      expect(room.revealedRoles).toEqual([]);
      checkpoint = '재경기 · 명시 퇴장 무효';
      // Explicit leave follows the documented all-player void policy and never reveals roles.
      await host.getByRole('button', { name: '방 나가기', exact: true }).click();
      await host
        .getByRole('dialog')
        .getByRole('button', { name: '방 나가기', exact: true })
        .click();
      await stage(pages[1], 'finished');
      expect((await state(pages[1])).winner).toBeNull();
      expect((await state(pages[1])).revealedRoles).toEqual([]);
      expect(errors).toEqual([]);
    } catch (error) {
      try {
        await info.attach('avalon-public-checkpoint', {
          contentType: 'application/json',
          body: JSON.stringify({
            count,
            checkpoint,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }),
        });
      } catch {
        // A diagnostic attachment failure must never replace the original test failure.
      }
      throw error;
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}
