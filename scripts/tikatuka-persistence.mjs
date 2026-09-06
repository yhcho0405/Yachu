import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { getTikatukaTargets } from '../src/shared/tikatuka.ts';

mkdirSync('work', { recursive: true });
const stateDir = mkdtempSync('work/tikatuka-restart-');
const origin = 'http://127.0.0.1:8792';
let worker, browser;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start() {
  worker = spawn(process.execPath, ['scripts/ci-server.mjs'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DICE_CI_PORT: '8792',
      DICE_CI_STATE_DIR: stateDir,
      WRANGLER_SEND_METRICS: 'false',
    },
  });
  worker.stdout.on('data', () => {});
  worker.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    if (worker.exitCode !== null)
      throw new Error('Tikatuka persistence workerd stopped before ready');
    try {
      if ((await fetch(origin + '/api/health')).ok) return;
    } catch {
      /* starting */
    }
    await delay(200);
  }
  throw new Error('Tikatuka persistence workerd did not become ready');
}
async function stop() {
  if (!worker) return;
  const p = worker;
  worker = undefined;
  const done = new Promise((resolve) => p.once('exit', resolve));
  process.kill(-p.pid, 'SIGTERM');
  await done;
}
async function json(page, path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      const session = body === undefined ? null : await (await fetch('/api/session')).json();
      const response = await fetch(
        path,
        body === undefined
          ? { cache: 'no-store', headers: { 'X-Game-Protocol': '2' } }
          : {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': session.csrfToken,
                'X-Game-Protocol': '2',
              },
              body: JSON.stringify(body),
            },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(`Local persistence request ${response.status} ${result.code ?? ''}`);
      return result;
    },
    { path, body },
  );
}
async function identify(page, name) {
  await page.goto(origin);
  return page.evaluate(async (name) => {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: name }),
    });
    if (!response.ok) throw new Error('Could not create local guest');
    const session = await response.json();
    return session.playerId;
  }, name);
}
async function connect(page, code) {
  return page.evaluate(async (code) => {
    window.persistenceSocket?.close();
    const socket = new WebSocket(
      location.origin.replace('http', 'ws') + `/api/rooms/${code}/ws?protocolVersion=2`,
    );
    window.persistenceSocket = socket;
    return new Promise((resolve, reject) => {
      socket.onerror = reject;
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.state) resolve(message.state);
      };
    });
  }, code);
}
async function snapshot(page, code) {
  return (await json(page, `/api/rooms/${code}`)).state;
}
async function send(page, state, intent) {
  await delay(Math.max(0, state.inputAfter - Date.now()) + 25);
  const command = {
    ...intent,
    gameType: 'tikatuka',
    protocolVersion: 2,
    requestId: crypto.randomUUID(),
    gameId: state.gameId,
    turnId: state.turnId,
    expectedVersion: state.version,
  };
  const result = await json(page, `/api/rooms/${state.code}/command`, command);
  return { command, result };
}
const gameplay = (state) => ({
  ...state,
  presenceVersion: 0,
  players: state.players.map(({ connected: _connected, graceDeadline: _deadline, ...p }) => p),
});
async function restartReplay(pages, actorIndex, saved) {
  await stop();
  await start();
  for (const page of pages) await page.reload();
  const restored = await snapshot(pages[actorIndex], saved.result.state.code);
  assert.deepEqual(
    gameplay(restored),
    gameplay(saved.result.state),
    'intermediate state must survive actual process replacement',
  );
  const repeated = await json(
    pages[actorIndex],
    `/api/rooms/${restored.code}/command`,
    saved.command,
  );
  assert.deepEqual(repeated, saved.result, 'retry returns the exact saved intermediate result');
  for (const page of pages) await connect(page, restored.code);
  return snapshot(pages[0], restored.code);
}
try {
  await start();
  browser = await chromium.launch({ headless: true });
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const ids = await Promise.all(pages.map((p, i) => identify(p, `티카 영속성 ${i + 1}`)));
  let state = (await json(pages[0], '/api/rooms', { gameType: 'tikatuka', solo: false })).state;
  await json(pages[1], '/api/join', { code: state.code });
  for (const p of pages) await connect(p, state.code);
  state = await snapshot(pages[0], state.code);
  state = (await send(pages[1], state, { type: 'ready', ready: true })).result.state;
  state = (await send(pages[0], state, { type: 'start' })).result.state;
  let attack;
  // Normal legal play finds an attack; no RNG injection or special runtime endpoint.
  for (let step = 0; step < 140; step++) {
    if (state.phase === 'finished') {
      state = (await send(pages[0], state, { type: 'rematch' })).result.state;
      state = (await send(pages[1], state, { type: 'ready', ready: true })).result.state;
      state = (await send(pages[0], state, { type: 'start' })).result.state;
    }
    const targets = getTikatukaTargets(state);
    const target = targets.find((t) => t.action === 'attack') ?? targets[step % targets.length];
    assert.ok(target, 'each active turn must have a legal target');
    const actorIndex = ids.indexOf(state.turnPlayerId);
    assert.ok(actorIndex >= 0);
    const saved = await send(pages[actorIndex], state, {
      type: 'tika_place',
      ownerId: target.ownerId,
      lane: target.lane,
    });
    state = saved.result.state;
    if (target.action === 'attack') {
      attack = { ...saved, actorIndex };
      break;
    }
  }
  assert.ok(attack, 'normal play must reach the required attack checkpoint');
  assert.equal(state.stage, 'placing');
  assert.equal(state.pendingDie.source, 'bonus');
  const bonus = structuredClone(state.pendingDie);
  const removed = state.latestEvent.removedIds;
  state = await restartReplay(pages, attack.actorIndex, attack);
  assert.deepEqual(state.pendingDie, bonus);
  assert.ok(state.players.every((p) => p.lanes.flat().every((d) => !removed.includes(d.id))));
  console.log(
    'PASS: real workerd restart retains removed dice, exact bonus face, actor, stage and attack receipt.',
  );
  const reroll = await send(pages[attack.actorIndex], state, { type: 'tika_reroll' });
  assert.equal(reroll.result.state.stage, 'choosingReroll');
  const candidates = structuredClone(reroll.result.state.rerollChoices);
  state = await restartReplay(pages, attack.actorIndex, reroll);
  assert.deepEqual(state.rerollChoices, candidates);
  assert.equal(state.players[attack.actorIndex].rerollUsed, true);
  state = (await send(pages[attack.actorIndex], state, { type: 'tika_choose', choice: 'original' }))
    .result.state;
  assert.deepEqual(state.pendingDie, candidates.original);
  assert.equal(state.pendingDie.kind, 'shield');
  console.log(
    'PASS: real workerd restart retains reroll consumption, both exact shield candidates and choice receipt.',
  );
  // Release this match normally before creating a separate computer room.
  await send(pages[0], state, { type: 'leave' });
  state = (await json(pages[0], '/api/rooms', { gameType: 'tikatuka', solo: true })).state;
  await connect(pages[0], state.code);
  state = await snapshot(pages[0], state.code);
  state = (await send(pages[0], state, { type: 'start' })).result.state;
  if (state.turnPlayerId === ids[0]) {
    const target = getTikatukaTargets(state)[0];
    state = (
      await send(pages[0], state, {
        type: 'tika_place',
        ownerId: target.ownerId,
        lane: target.lane,
      })
    ).result.state;
  }
  assert.ok(state.aiDueAt !== null, 'AI deadline is persisted before restart');
  const revision = state.version,
    gameId = state.gameId,
    code = state.code;
  await stop();
  await start();
  await pages[0].reload();
  await connect(pages[0], code);
  for (let i = 0; i < 60; i++) {
    state = await snapshot(pages[0], code);
    if (state.version > revision && state.turnPlayerId === ids[0]) break;
    await delay(250);
  }
  assert.equal(state.gameId, gameId);
  assert.ok(state.version > revision, 'the durable AI alarm resumes after process restart');
  assert.equal(state.turnPlayerId, ids[0]);
  assert.equal(state.aiDueAt, null);
  const settled = gameplay(state);
  await delay(1400);
  assert.deepEqual(
    gameplay(await snapshot(pages[0], code)),
    settled,
    'no extra AI action occurs after control returns to the human',
  );
  console.log(
    'PASS: persisted AI deadline resumes through real workerd restart and stops on the human turn.',
  );
} finally {
  await browser?.close();
  await stop();
  rmSync(stateDir, { recursive: true, force: true });
}
