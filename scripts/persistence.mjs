import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { ensureLocalSecret } from './local-env.mjs';
import { DatabaseSync } from 'node:sqlite';
ensureLocalSecret();
const stateDir = mkdtempSync(join(tmpdir(), 'dice-sqlite-'));
const origin = 'http://127.0.0.1:8791';
let worker, browser;
async function start() {
  worker = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      '8791',
      '--persist-to',
      stateDir,
    ],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );
  worker.stdout.on('data', () => {});
  worker.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    if (worker.exitCode !== null) throw new Error('Local Wrangler stopped before ready');
    try {
      if ((await fetch(origin + '/api/health')).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Local Wrangler did not become ready');
}
async function stop() {
  if (!worker) return;
  const p = worker;
  worker = undefined;
  process.kill(-p.pid, 'SIGTERM');
  await new Promise((r) => p.once('exit', r));
}
function sqliteFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sqliteFiles(join(directory, entry.name))
      : entry.name.endsWith('.sqlite')
        ? [join(directory, entry.name)]
        : [],
  );
}
try {
  await start();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  const persisted = await page.evaluate(async () => {
    const session = await (
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: '영속성 검사' }),
      })
    ).json();
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken };
    let { state } = await (
      await fetch('/api/rooms', { method: 'POST', headers, body: '{}' })
    ).json();
    const socket = new WebSocket(
      location.origin.replace('http', 'ws') + `/api/rooms/${state.code}/ws`,
    );
    await new Promise((resolve, reject) => {
      socket.onmessage = resolve;
      socket.onerror = reject;
    });
    const send = async (type) => {
      state = (await (await fetch(`/api/rooms/${state.code}`)).json()).state;
      const command = {
        type,
        requestId: crypto.randomUUID(),
        gameId: state.gameId,
        turnId: state.turnId,
        expectedVersion: state.version,
      };
      const r = await fetch(`/api/rooms/${state.code}/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify(command),
      });
      if (!r.ok) throw new Error(`command ${r.status}`);
      const result = await r.json();
      state = result.state;
      return { command, result };
    };
    await send('start');
    const { command, result } = await send('roll');
    return { code: state.code, command, result };
  });
  await stop();
  await start();
  await page.reload();
  const restored = await page.evaluate(async (persisted) => {
    const session = await (await fetch('/api/session')).json();
    const state = (await (await fetch(`/api/rooms/${persisted.code}`)).json()).state;
    const result = await (
      await fetch(`/api/rooms/${persisted.code}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify(persisted.command),
      })
    ).json();
    return { state, result };
  }, persisted);
  assert.deepEqual(
    restored.result,
    persisted.result,
    'replayed request must return the exact saved response after process restart',
  );
  for (const key of ['dice', 'version', 'gameId', 'turnId', 'turnPlayerId', 'rolls'])
    assert.deepEqual(restored.state[key], persisted.result.state[key], `persistent ${key}`);
  console.log(
    'PASS: real Wrangler/workerd process restart preserved session, seats, dice, turn, version and exact request receipt.',
  );
  // This fixture is a newly created OS-temporary, isolated local namespace. Mutate
  // only its database while workerd is stopped; no runtime test endpoint exists.
  await stop();
  let expired = 0;
  for (const file of sqliteFiles(stateDir)) {
    const database = new DatabaseSync(file);
    try {
      if (
        database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'").get()
      )
        expired += Number(
          database.prepare('UPDATE sessions SET expires_at=0 WHERE revoked=0').run().changes,
        );
    } finally {
      database.close();
    }
  }
  assert.equal(expired, 1, 'the isolated fixture must contain exactly its own test session');
  await start();
  await page.reload();
  const denied = await page.evaluate(async (code) => {
    const sessionResponse = await fetch('/api/session');
    const roomResponse = await fetch(`/api/rooms/${code}`);
    const roomBody = await roomResponse.json();
    return {
      sessionStatus: sessionResponse.status,
      roomStatus: roomResponse.status,
      hasState: Object.hasOwn(roomBody, 'state'),
    };
  }, persisted.code);
  assert.equal(denied.sessionStatus, 401, 'expired credentials must be rejected after restart');
  assert.equal(denied.roomStatus, 401, 'expired credentials cannot read their previous room');
  assert.equal(denied.hasState, false, 'authentication errors do not disclose a room snapshot');
  console.log(
    'PASS: persisted session expiry rejected normal authentication and room reads after a real process restart, without exposing state.',
  );
} finally {
  await browser?.close();
  await stop();
  rmSync(stateDir, { recursive: true, force: true });
}
