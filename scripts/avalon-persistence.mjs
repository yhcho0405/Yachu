import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

mkdirSync('work', { recursive: true });
const stateDir = mkdtempSync('work/avalon-restart-');
const origin = 'http://127.0.0.1:8793';
let worker, browser;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start() {
  worker = spawn(process.execPath, ['scripts/ci-server.mjs'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DICE_CI_PORT: '8793',
      DICE_CI_STATE_DIR: stateDir,
      WRANGLER_SEND_METRICS: 'false',
    },
  });
  worker.stdout.on('data', () => {});
  worker.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    if (worker.exitCode !== null) throw Error('Avalon workerd stopped before ready');
    try {
      if ((await fetch(origin + '/api/health')).ok) return;
    } catch {
      /* starting */
    }
    await delay(200);
  }
  throw Error('Avalon workerd not ready');
}
async function stop() {
  if (!worker) return;
  const processToStop = worker;
  worker = undefined;
  const done = new Promise((resolve) => processToStop.once('exit', resolve));
  process.kill(-processToStop.pid, 'SIGTERM');
  await done;
}
async function json(page, path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      const session = body === undefined ? null : await (await fetch('/api/session')).json();
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        cache: 'no-store',
        headers: {
          'X-Game-Protocol': '3',
          ...(body === undefined
            ? {}
            : {
                'Content-Type': 'application/json',
                'X-CSRF-Token': session.csrfToken,
              }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(`Local Avalon request ${response.status} ${result.code ?? ''}`);
      return result;
    },
    { path, body },
  );
}
async function identify(page, index) {
  await page.goto(origin);
  return page.evaluate(async (index) => {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: `원탁 복구 ${index + 1}` }),
    });
    if (!response.ok) throw Error('Local guest creation failed');
    return (await response.json()).playerId;
  }, index);
}
async function connect(page, code) {
  return page.evaluate(async (code) => {
    window.persistenceSocket?.close();
    window.avalonStates = [];
    const socket = new WebSocket(
      location.origin.replace('http', 'ws') + `/api/rooms/${code}/ws?protocolVersion=3`,
    );
    window.persistenceSocket = socket;
    return new Promise((resolve, reject) => {
      socket.onerror = reject;
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.state) {
          window.avalonStates.push(message.state);
          resolve(message.state);
        }
      };
    });
  }, code);
}
const snapshot = async (page, code) => (await json(page, `/api/rooms/${code}`)).state;
function envelope(state, intent) {
  return {
    ...intent,
    gameType: 'avalon',
    protocolVersion: 3,
    requestId: crypto.randomUUID(),
    gameId: state.gameId,
    turnId: state.turnId,
    expectedVersion: state.version,
  };
}
function scoped(state, intent) {
  return envelope(state, {
    ...intent,
    phaseId: state.phaseId,
    proposalId: state.proposal?.id ?? null,
  });
}
async function submit(page, state, command) {
  return json(page, `/api/rooms/${state.code}/command`, command);
}
const stable = (state) => ({
  ...state,
  presenceVersion: 0,
  players: state.players.map(
    ({ connected: _connected, graceDeadline: _deadline, ...player }) => player,
  ),
});
function safeRecipient(state, id) {
  assert.equal(state.gameType, 'avalon');
  assert.equal(state.privateInfo?.playerId, id);
  assert.equal(Object.hasOwn(state, 'secrets'), false);
  assert.equal(Object.hasOwn(state, 'roles'), false);
  assert.equal(Object.hasOwn(state, 'questCards'), false);
  assert.equal(state.revealedRoles.length, 0);
}
async function checkRecipients(pages, ids, code) {
  for (let i = 0; i < pages.length; i++) {
    const state = await snapshot(pages[i], code);
    safeRecipient(state, ids[i]);
    const messages = await pages[i].evaluate(() => window.avalonStates ?? []);
    for (const message of messages.filter((value) => value.phase === 'playing'))
      safeRecipient(message, ids[i]);
  }
}
async function restartAt(pages, ids, actorIndex, command, receipt) {
  const before = await Promise.all(pages.map((page) => snapshot(page, receipt.state.code)));
  await stop();
  await start();
  for (const page of pages) await page.reload();
  const after = await Promise.all(pages.map((page) => snapshot(page, receipt.state.code)));
  for (let i = 0; i < before.length; i++) assert.deepEqual(stable(after[i]), stable(before[i]));
  const repeated = await submit(pages[actorIndex], receipt.state, command);
  assert.deepEqual(repeated, receipt, 'exact private receipt must survive restart');
  for (const page of pages) await connect(page, receipt.state.code);
  await checkRecipients(pages, ids, receipt.state.code);
  return snapshot(pages[0], receipt.state.code);
}
try {
  await start();
  browser = await chromium.launch({ headless: true });
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const ids = await Promise.all(pages.map((page, i) => identify(page, i)));
  let state = (await json(pages[0], '/api/rooms', { gameType: 'avalon', solo: false })).state;
  for (const page of pages.slice(1)) await json(page, '/api/join', { code: state.code });
  for (const page of pages) await connect(page, state.code);
  state = await snapshot(pages[0], state.code);
  for (let i = 1; i < pages.length; i++)
    state = (await submit(pages[i], state, envelope(state, { type: 'ready', ready: true }))).state;
  state = (await submit(pages[0], state, envelope(state, { type: 'start' }))).state;
  await checkRecipients(pages, ids, state.code);
  const roles = await Promise.all(
    pages.map(async (page) => (await snapshot(page, state.code)).privateInfo.role),
  );
  const good = roles
    .map((role, i) => (['merlin', 'percival', 'servant'].includes(role) ? ids[i] : null))
    .filter(Boolean);
  assert.equal(good.length, 3);
  state = (
    await submit(
      pages[ids.indexOf(state.leaderId)],
      state,
      scoped(state, { type: 'av_team', teamIds: good.slice(0, 2) }),
    )
  ).state;
  const votes = pages.map(() => scoped(state, { type: 'av_vote', approve: true }));
  const partial = await Promise.all(
    pages.slice(0, 3).map((page, i) => submit(page, state, votes[i])),
  );
  state = await restartAt(pages, ids, 2, votes[2], partial[2]);
  assert.equal(state.stage, 'vote');
  assert.equal(state.history.proposals.length, 0);
  assert.equal(state.proposal.submittedIds.length, 3);
  const finalVotes = await Promise.all(
    pages.slice(3).map((page, i) => submit(page, state, votes[i + 3])),
  );
  state = await snapshot(pages[0], state.code);
  assert.equal(state.stage, 'quest');
  assert.equal(state.history.proposals.length, 1);
  for (let i = 0; i < 2; i++)
    assert.deepEqual(await submit(pages[i + 3], state, votes[i + 3]), finalVotes[i]);
  console.log(
    'PASS: real workerd restart preserves each private role and vote; concurrent old-version submissions finish exactly one proposal.',
  );

  const team = state.proposal.teamIds,
    firstIndex = ids.indexOf(team[0]),
    lastIndex = ids.indexOf(team[1]);
  const firstCard = scoped(state, { type: 'av_quest', card: 'success' });
  const cardReceipt = await submit(pages[firstIndex], state, firstCard);
  state = await restartAt(pages, ids, firstIndex, firstCard, cardReceipt);
  assert.equal(state.stage, 'quest');
  assert.equal(state.history.quests.length, 0);
  const observer = ids.findIndex((id) => !team.includes(id));
  assert.equal((await snapshot(pages[observer], state.code)).privateInfo.myQuestCard, null);
  const lastCard = scoped(state, { type: 'av_quest', card: 'success' });
  const final = await submit(pages[lastIndex], state, lastCard);
  state = await restartAt(pages, ids, lastIndex, lastCard, final);
  assert.equal(state.history.quests.length, 1);
  assert.deepEqual(
    [state.history.quests[0].successCount, state.history.quests[0].failCount],
    [2, 0],
  );
  assert.equal(state.privateInfo.myQuestCard, null);
  await checkRecipients(pages, ids, state.code);
  console.log(
    'PASS: real workerd restart preserves an unresolved private quest card and its anonymous final tally without author IDs or duplicate outcomes.',
  );
  const leave = await submit(pages[0], state, envelope(state, { type: 'leave' }));
  assert.equal(leave.state.winner, null);
  assert.deepEqual(leave.state.revealedRoles, []);
  console.log(
    'PASS: authenticated HTTP, WebSocket, reconnect and receipt paths each retain their recipient boundary; departure voids without role reveal.',
  );
} finally {
  await browser?.close();
  await stop();
  rmSync(stateDir, { recursive: true, force: true });
}
