import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
const source = ts.transpileModule(fs.readFileSync('src/client/network.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { GameClient } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const local = new Map(),
  pending = new Map();
const storage = (map) => ({
  getItem: (key) => map.get(key) ?? null,
  setItem: (key, value) => map.set(key, value),
  removeItem: (key) => map.delete(key),
});
const install = () => {
  local.clear();
  pending.clear();
  globalThis.localStorage = storage(local);
  globalThis.sessionStorage = storage(pending);
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.hidden = false;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  globalThis.location = { href: 'http://localhost/' };
  globalThis.history = {
    replaceState: (_a, _b, path) => {
      location.href = `http://localhost${path}`;
    },
  };
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID }, configurable: true });
  FakeSocket.all = [];
  globalThis.WebSocket = FakeSocket;
};
class FakeSocket {
  static OPEN = 1;
  static all = [];
  readyState = 0;
  constructor() {
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  close(code = 1000) {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code }));
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 8; i++) await tick();
};
const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const fixture = () => ({
  roomId: 'room-id',
  code: 'ABCDEFGH',
  gameId: 'game-id',
  turnId: 'turn-id',
  version: 1,
  presenceVersion: 1,
  phase: 'playing',
  rolls: 1,
});
const session = { playerId: 'player-id', nickname: 'tester', csrfToken: 'token' };
function mockServer(state, commandHandler) {
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/session') return reply(session);
    if (url === '/api/rooms') return reply({ state });
    if (url.endsWith('/command')) return commandHandler(JSON.parse(options.body));
    return reply({ state });
  };
}
async function started(state, handler) {
  mockServer(state, handler);
  const client = new GameClient();
  await client.create('tester', false);
  FakeSocket.all.at(-1).open();
  await settle();
  return client;
}

install();
{
  let state = fixture();
  state.phase = 'lobby';
  const commands = [];
  mockServer(state, (command) => {
    commands.push(command);
    state = { ...state, phase: 'playing', version: 2 };
    return reply({ type: 'result', state });
  });
  const client = new GameClient();
  await client.create('tester', true);
  await settle();
  assert.equal(commands.length, 0, 'solo start must wait for socket OPEN');
  FakeSocket.all.at(-1).open();
  await settle();
  assert.equal(commands.length, 1);
  assert.equal(client.getSnapshot().room.phase, 'playing');
  client.dispose();
}
install();
{
  let state = fixture();
  let release;
  const commands = [];
  const client = await started(state, async (command) => {
    commands.push(command);
    if (command.type === 'hold') await new Promise((resolve) => (release = resolve));
    state = { ...state, version: state.version + 1 };
    return reply({ type: 'result', state });
  });
  client.enqueue({ type: 'hold', held: [true, false, false, false, false] });
  client.enqueue({ type: 'roll' });
  await tick();
  assert.equal(commands.length, 1, 'roll must wait for hold response');
  release();
  await settle();
  assert.equal(commands.length, 2);
  assert.equal(commands[1].expectedVersion, 2);
  assert.equal(client.getSnapshot().queue.length, 0);
  client.dispose();
}
install();
{
  let state = fixture();
  const commands = [];
  let failed = false;
  const handler = (command) => {
    commands.push(command);
    if (!failed) {
      failed = true;
      state = { ...state, version: 2, rolls: 2 };
      return reply({ error: 'server unavailable' }, 503);
    }
    return reply({ type: 'result', state });
  };
  const client = await started(state, handler);
  client.enqueue({ type: 'roll' });
  await settle();
  assert.equal(client.getSnapshot().queue.length, 1);
  const original = commands[0];
  assert.deepEqual(JSON.parse(pending.get('atelier.pending'))[0].command, original);
  client.dispose();
  mockServer(state, handler);
  const restored = new GameClient();
  await restored.boot();
  FakeSocket.all.at(-1).open();
  await settle();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], original, '503/reload must retry original complete envelope');
  assert.equal(restored.getSnapshot().queue.length, 0);
  assert.equal(restored.getSnapshot().room.rolls, 2);
  restored.dispose();
}
install();
{
  const state = fixture();
  let release;
  const commands = [];
  const client = await started(state, async (command) => {
    commands.push(command);
    await new Promise((resolve) => (release = resolve));
    return reply({ error: '다시 선택해 주세요.', code: 'STALE_VERSION' }, 409);
  });
  client.enqueue({ type: 'hold', held: [true, false, false, false, false] });
  client.enqueue({ type: 'roll' });
  await tick();
  release();
  await settle();
  assert.equal(commands.length, 1);
  assert.equal(client.getSnapshot().queue.length, 0);
  assert.equal(pending.has('atelier.pending'), false);
  assert.match(client.getSnapshot().error, /다시 선택/);
  client.dispose();
}
install();
{
  const state = fixture();
  const client = await started(state, () => reply({ error: 'expired', code: 'UNAUTHORIZED' }, 401));
  client.enqueue({ type: 'roll' });
  await settle();
  assert.equal(client.getSnapshot().room, null);
  assert.equal(client.getSnapshot().session, null);
  assert.match(client.getSnapshot().error, /만료/);
  assert.equal(pending.has('atelier.pending'), false);
  assert.equal(local.has('atelier.room'), false);
  client.dispose();
}
install();
{
  local.set('atelier.room', 'ABCDEFGH');
  pending.set('atelier.pending', '[{"old":true}]');
  globalThis.fetch = async () => reply({ error: 'expired', code: 'UNAUTHORIZED' }, 401);
  const client = new GameClient();
  await client.boot();
  assert.equal(client.getSnapshot().session, null);
  assert.equal(local.has('atelier.room'), false);
  assert.equal(pending.has('atelier.pending'), false);
  assert.match(client.getSnapshot().error, /만료/);
  client.dispose();
}
// Initial queue and session checks are followed by terminal-room regressions.
console.log(
  'PASS: socket gate; hold/roll serialization; 503 exact envelope across reload; stale 409 clears queued choices; command and boot 401 reset session.',
);

for (const [status, code] of [
  [403, 'NOT_MEMBER'],
  [403, 'GRACE_EXPIRED'],
  [403, 'FORFEITED'],
  [404, 'ROOM_NOT_FOUND'],
]) {
  install();
  const state = fixture();
  const client = await started(state, () => reply({ error: 'unavailable', code }, status));
  client.enqueue({ type: 'roll' });
  await settle();
  assert.equal(client.getSnapshot().room, null, code);
  assert.deepEqual(client.getSnapshot().session, session, `${code} preserves guest session`);
  assert.equal(client.getSnapshot().queue.length, 0);
  assert.equal(local.has('atelier.room'), false);
  assert.equal(pending.has('atelier.pending'), false);
  assert.match(client.getSnapshot().error, /새 게임|새 방|초대 코드/);
  client.dispose();
}
install();
{
  const state = fixture();
  const client = await started(state, () => reply({ type: 'result', state }));
  globalThis.fetch = async () => reply({ error: 'unavailable', code: 'NOT_MEMBER' }, 403);
  const socket = FakeSocket.all.at(-1);
  socket.close(1006);
  await settle();
  assert.equal(
    client.getSnapshot().room,
    null,
    'failed handshake refresh resolves inaccessible room',
  );
  assert.deepEqual(client.getSnapshot().session, session);
  assert.equal(client.retry, null, 'terminal room cancels reconnect timer');
  client.dispose();
}
install();
{
  local.set('atelier.room', 'ABCDEFGH');
  pending.set('atelier.pending', '[{"old":true}]');
  globalThis.fetch = async (url) =>
    url === '/api/session'
      ? reply(session)
      : reply({ error: 'expired room', code: 'ROOM_NOT_FOUND' }, 404);
  const client = new GameClient();
  await client.boot();
  assert.equal(client.getSnapshot().room, null);
  assert.deepEqual(client.getSnapshot().session, session);
  assert.equal(local.has('atelier.room'), false);
  assert.equal(pending.has('atelier.pending'), false);
  assert.match(client.getSnapshot().error, /방이 종료되었거나 만료/);
  client.dispose();
}
install();
{
  const state = fixture();
  const client = await started(state, () => reply({ type: 'result', state }));
  let release;
  const next = { ...state, roomId: 'new-room', code: 'BCDEFGHJ' };
  globalThis.fetch = async (url) =>
    url === '/api/rooms'
      ? reply({ state: next })
      : new Promise(
          (resolve) =>
            (release = () =>
              resolve(reply({ error: 'old room expired', code: 'NOT_MEMBER' }, 403))),
        );
  const oldRefresh = client.refresh();
  await tick();
  await client.create('tester', false);
  release();
  await oldRefresh;
  await settle();
  assert.equal(
    client.getSnapshot().room.code,
    next.code,
    'old refresh cannot evict newly entered room',
  );
  assert.deepEqual(client.getSnapshot().session, session);
  client.dispose();
}
console.log(
  'PASS: 403 terminal room codes and 404 ROOM_NOT_FOUND preserve valid session, clear room/queue, and cancel reconnect; close 1006 refreshes auth; boot cleanup and stale refresh guard.',
);
