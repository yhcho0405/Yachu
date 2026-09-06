import { createHash } from 'node:crypto';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { Command, CommonIntent, ServerMessage, Session } from '../../src/shared/protocol';
import {
  avalonAlignment,
  isAvalonRoomState,
  type AvalonGameIntent,
  type AvalonRole,
  type AvalonRoomState,
} from '../../src/shared/avalon';

declare global {
  interface Window {
    avalonProtocolSockets?: Record<string, WebSocket>;
    avalonProtocolMessages?: Record<string, ServerMessage[]>;
  }
}
type Reply = { status: number; body: ServerMessage };
type Action = AvalonGameIntent extends infer I
  ? I extends AvalonGameIntent
    ? Omit<I, 'phaseId' | 'proposalId'>
    : never
  : never;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function identify(page: Page): Promise<string> {
  await page.goto('/version.json');
  return page.evaluate(async () => {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '원탁의 참가자' }),
    });
    if (!response.ok) throw new Error('Local Avalon guest creation failed');
    return ((await response.json()) as Session).playerId;
  });
}
async function request(
  page: Page,
  path: string,
  body?: unknown,
  version: string | null = '3',
): Promise<Reply> {
  return page.evaluate(
    async ({ path, body, version }) => {
      const headers: Record<string, string> =
        version === null ? {} : { 'X-Game-Protocol': version };
      if (body !== undefined) {
        const session = (await (await fetch('/api/session')).json()) as Session;
        headers['Content-Type'] = 'application/json';
        headers['X-CSRF-Token'] = session.csrfToken;
      }
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: (await response.json()) as ServerMessage };
    },
    { path, body, version },
  );
}
function stateOf(message: ServerMessage): AvalonRoomState {
  if (message.state?.gameType !== 'avalon') throw new Error('Expected an Avalon recipient state');
  return message.state;
}
async function snapshot(page: Page, code: string): Promise<AvalonRoomState> {
  const response = await request(page, `/api/rooms/${code}`);
  expect(response.status).toBe(200);
  return stateOf(response.body);
}
function command(state: AvalonRoomState, intent: CommonIntent | Action): Command {
  return {
    ...intent,
    gameType: 'avalon',
    protocolVersion: 3,
    requestId: crypto.randomUUID(),
    gameId: state.gameId,
    expectedVersion: state.version,
    turnId: state.turnId,
    ...(intent.type.startsWith('av_')
      ? { phaseId: state.phaseId, proposalId: state.proposal?.id ?? null }
      : {}),
  } as Command;
}
async function connect(page: Page, code: string, label: string, version: string | null = '3') {
  return page.evaluate(
    ({ code, label, version }) =>
      new Promise<{ opened: boolean; state?: AvalonRoomState }>((resolve, reject) => {
        const url = new URL(`/api/rooms/${code}/ws`, location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        if (version !== null) url.searchParams.set('protocolVersion', version);
        window.avalonProtocolSockets ??= {};
        window.avalonProtocolMessages ??= {};
        const messages: ServerMessage[] = [];
        window.avalonProtocolMessages[label] = messages;
        const socket = new WebSocket(url);
        window.avalonProtocolSockets[label] = socket;
        let opened = false;
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error('Avalon protocol connection did not settle'));
        }, 10000);
        const done = (state?: AvalonRoomState) => {
          clearTimeout(timer);
          resolve({ opened, ...(state ? { state } : {}) });
        };
        socket.onopen = () => {
          opened = true;
        };
        socket.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          messages.push(message);
          if (message.state?.gameType === 'avalon') done(message.state);
        };
        socket.onerror = () => done();
        socket.onclose = () => done();
      }),
    { code, label, version },
  );
}
async function sendSocket(page: Page, value: Command): Promise<ServerMessage> {
  const before = await page.evaluate((value) => {
    const index = window.avalonProtocolMessages!.main!.length;
    window.avalonProtocolSockets!.main!.send(JSON.stringify(value));
    return index;
  }, value);
  await expect
    .poll(() =>
      page.evaluate(
        ({ before, requestId }) =>
          window
            .avalonProtocolMessages!.main!.slice(before)
            .some((message) => message.requestId === requestId),
        { before, requestId: value.requestId },
      ),
    )
    .toBe(true);
  return page.evaluate(
    ({ before, requestId }) =>
      window
        .avalonProtocolMessages!.main!.slice(before)
        .find((message) => message.requestId === requestId)!,
    { before, requestId: value.requestId },
  );
}
function refreshOnly(response: Reply): void {
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PROTOCOL_REFRESH');
  expect(response.body.error).toContain('새로고침');
  expect(response.body).not.toHaveProperty('state');
}
function checkRecipient(
  state: AvalonRoomState,
  playerId: string,
  roles?: Map<string, AvalonRole>,
): void {
  // Boolean/hash assertions keep credentials and private role payloads out of failure reports.
  expect(isAvalonRoomState(state), 'strict recipient schema').toBe(true);
  expect(Object.hasOwn(state, 'secrets'), 'no internal-state payload').toBe(false);
  expect(state.revealedRoles.length, 'no premature role reveal').toBe(0);
  if (state.stage === 'lobby') {
    expect(state.privateInfo).toBeNull();
    return;
  }
  expect(state.privateInfo?.playerId === playerId, 'private info belongs to this session').toBe(
    true,
  );
  if (!roles) return;
  const role = roles.get(playerId)!;
  expect(state.privateInfo?.role === role, 'own role is stable').toBe(true);
  const knownEvilIds = state.players
    .filter(
      (p) =>
        p.id !== playerId &&
        avalonAlignment(roles.get(p.id)!) === 'evil' &&
        (role === 'merlin'
          ? roles.get(p.id) !== 'mordred'
          : avalonAlignment(role) === 'evil' && role !== 'oberon' && roles.get(p.id) !== 'oberon'),
    )
    .map((p) => p.id);
  const merlinCandidateIds =
    role === 'percival'
      ? state.players
          .filter((p) => ['merlin', 'morgana'].includes(roles.get(p.id)!))
          .map((p) => p.id)
      : [];
  expect(digest(state.privateInfo!.knownEvilIds), 'permitted alignment knowledge only').toBe(
    digest(knownEvilIds),
  );
  expect(
    digest(state.privateInfo!.merlinCandidateIds),
    'indistinguishable Merlin candidates only',
  ).toBe(digest(merlinCandidateIds));
}
function publicDigest(state: AvalonRoomState): string {
  const { privateInfo: _privateInfo, ...publicState } = state;
  return digest(publicState);
}
async function synchronized(
  pages: Page[],
  ids: string[],
  code: string,
  roles?: Map<string, AvalonRole>,
): Promise<AvalonRoomState[]> {
  const states = await Promise.all(pages.map((page) => snapshot(page, code)));
  const version = states[0]!.version;
  await expect
    .poll(async () =>
      Promise.all(
        pages.map((page) =>
          page.evaluate(() => window.avalonProtocolMessages!.main!.at(-1)?.state?.version),
        ),
      ),
    )
    .toEqual(pages.map(() => version));
  const sockets = await Promise.all(
    pages.map((page) =>
      page.evaluate(() => window.avalonProtocolMessages!.main!.at(-1)!.state as AvalonRoomState),
    ),
  );
  for (let i = 0; i < states.length; i++) {
    checkRecipient(states[i]!, ids[i]!, roles);
    checkRecipient(sockets[i]!, ids[i]!, roles);
    expect(publicDigest(states[i]!), 'HTTP public fields agree').toBe(publicDigest(states[0]!));
    expect(publicDigest(sockets[i]!), 'WebSocket public fields agree').toBe(
      publicDigest(states[0]!),
    );
    expect(digest(sockets[i]!), 'HTTP and WebSocket carry the same recipient view').toBe(
      digest(states[i]!),
    );
  }
  return states;
}

test('local Avalon protocol gates are inert and HTTP, WebSocket, errors and replay stay recipient-specific', async ({
  browser,
  baseURL,
}) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Protocol rejection and privacy validation are confined to this project’s local runtime.',
  );
  const contexts: BrowserContext[] = [];
  try {
    for (let i = 0; i < 5; i++) contexts.push(await browser.newContext({ baseURL }));
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const ids = await Promise.all(pages.map(identify));
    expect(new Set(ids).size).toBe(5); // Equal nicknames are not identities.
    const host = pages[0]!;
    const created = await request(host, '/api/rooms', { gameType: 'avalon', solo: false });
    expect(created.status).toBe(200);
    const room = stateOf(created.body),
      code = room.code,
      path = `/api/rooms/${code}/command`;
    checkRecipient(room, ids[0]!);
    const beforeJoin = await snapshot(host, code);
    for (const version of [null, '2'])
      refreshOnly(await request(pages[1]!, '/api/join', { code }, version));
    expect(
      digest(await snapshot(host, code)),
      'rejected join leaves roster and revision intact',
    ).toBe(digest(beforeJoin));
    for (let i = 1; i < pages.length; i++) {
      const joined = await request(pages[i]!, '/api/join', { code });
      expect(joined.status).toBe(200);
      checkRecipient(stateOf(joined.body), ids[i]!);
    }
    for (let i = 0; i < pages.length; i++) {
      const connection = await connect(pages[i]!, code, 'main');
      expect(connection.opened).toBe(true);
      checkRecipient(connection.state!, ids[i]!);
    }
    const seated = (await synchronized(pages, ids, code))[1]!;
    expect(seated.players.map((p) => p.id)).toEqual(ids);
    for (const [index, version] of [null, '2'].entries()) {
      refreshOnly(await request(pages[1]!, `/api/rooms/${code}`, undefined, version));
      expect((await connect(pages[1]!, code, `rejected-${index}`, version)).opened).toBe(false);
    }
    expect(
      digest(await snapshot(pages[1]!, code)),
      'rejected reads/upgrades leave revision and presence intact',
    ).toBe(digest(seated));
    for (const page of pages) {
      expect(await page.evaluate(() => window.avalonProtocolSockets!.main!.readyState)).toBe(1);
      expect(
        await page.evaluate(() =>
          window.avalonProtocolMessages!.main!.some((m) => m.type === 'replaced'),
        ),
      ).toBe(false);
    }
    expect(
      await pages[1]!.evaluate(() =>
        ['rejected-0', 'rejected-1']
          .flatMap((label) => window.avalonProtocolMessages![label]!)
          .some((m) => m.state !== undefined),
      ),
    ).toBe(false);

    const config = await request(
      host,
      path,
      command(await snapshot(host, code), {
        type: 'av_config',
        config: { optionalRoles: ['percival', 'morgana'], ladyOfLake: false },
      }),
    );
    expect(config.status).toBe(200);
    const readyState = stateOf(config.body);
    const ready = await Promise.all(
      pages
        .slice(1)
        .map((page) => request(page, path, command(readyState, { type: 'ready', ready: true }))),
    );
    expect(ready.map((reply) => reply.status)).toEqual([200, 200, 200, 200]);
    const startCommand = command(await snapshot(host, code), { type: 'start' });
    const started = await request(host, path, startCommand);
    expect(started.status).toBe(200);
    expect(stateOf(started.body).stage).toBe('team');
    const initial = await synchronized(pages, ids, code);
    const roles = new Map(ids.map((id, i) => [id, initial[i]!.privateInfo!.role]));
    for (let i = 0; i < initial.length; i++) checkRecipient(initial[i]!, ids[i]!, roles);
    const startedRetry = await request(host, path, startCommand);
    expect(startedRetry.status).toBe(200);
    expect(digest(startedRetry.body), 'start receipt replays exact own role assignment').toBe(
      digest(started.body),
    );

    const evilId = ids.find((id) => avalonAlignment(roles.get(id)!) === 'evil')!;
    const goodId = ids.find((id) => avalonAlignment(roles.get(id)!) === 'good')!;
    const teamIds = [evilId, goodId];
    const leader = ids.indexOf(initial[0]!.leaderId!);
    const nonleader = (leader + 1) % pages.length;
    const denied = await request(
      pages[nonleader]!,
      path,
      command(initial[nonleader]!, { type: 'av_team', teamIds }),
    );
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('NOT_LEADER');
    checkRecipient(stateOf(denied.body), ids[nonleader]!, roles);
    expect(publicDigest(stateOf(denied.body))).toBe(publicDigest(initial[0]!));
    expect(stateOf(denied.body).version).toBe(initial[0]!.version);
    const proposed = await sendSocket(
      pages[leader]!,
      command(initial[leader]!, { type: 'av_team', teamIds }),
    );
    expect(proposed.type).toBe('result');
    checkRecipient(stateOf(proposed), ids[leader]!, roles);
    const voting = await synchronized(pages, ids, code, roles);
    const votes = voting.map((state, i) => command(state, { type: 'av_vote', approve: i !== 0 }));
    const firstVote = await request(host, path, votes[0]);
    expect(firstVote.status).toBe(200);
    checkRecipient(stateOf(firstVote.body), ids[0]!, roles);
    expect(stateOf(firstVote.body).privateInfo!.myVote).toBe(false);
    const partial = await synchronized(pages, ids, code, roles);
    expect(partial.every((state) => state.history.proposals.length === 0)).toBe(true);
    expect(
      partial.every((state, i) => state.privateInfo!.myVote === (i === 0 ? false : null)),
    ).toBe(true);
    expect(
      partial.every((state) => digest(state.proposal!.submittedIds) === digest([ids[0]])),
    ).toBe(true);
    const secondVote = await sendSocket(pages[1]!, votes[1]!);
    expect(secondVote.type).toBe('result');
    checkRecipient(stateOf(secondVote), ids[1]!, roles);
    const lastVotes = await Promise.all(
      pages.slice(2).map((page, i) => request(page, path, votes[i + 2])),
    );
    expect(lastVotes.map((reply) => reply.status)).toEqual([200, 200, 200]);
    lastVotes.forEach((reply, i) => checkRecipient(stateOf(reply.body), ids[i + 2]!, roles));
    const questStates = await synchronized(pages, ids, code, roles);
    expect(questStates[0]!.stage).toBe('quest');
    expect(questStates[0]!.history.proposals).toHaveLength(1);
    expect(questStates[0]!.history.proposals[0]!.votes.filter((v) => v.approve)).toHaveLength(4);
    expect(questStates.every((state) => state.privateInfo!.myVote === null)).toBe(true);
    const oldReceipt = await request(host, path, votes[0]);
    expect(oldReceipt.status).toBe(200);
    expect(
      digest(oldReceipt.body),
      'old receipt remains the same recipient-specific snapshot',
    ).toBe(digest(firstVote.body));
    checkRecipient(stateOf(oldReceipt.body), ids[0]!, roles);
    expect(
      digest(await snapshot(host, code)),
      'receipt replay does not revert or mutate the game',
    ).toBe(digest(questStates[0]));

    const observer = ids.findIndex((id) => !teamIds.includes(id));
    const deniedCard = await sendSocket(
      pages[observer]!,
      command(questStates[observer]!, { type: 'av_quest', card: 'success' }),
    );
    expect(deniedCard.type).toBe('error');
    expect(deniedCard.code).toBe('NOT_ON_QUEST');
    checkRecipient(stateOf(deniedCard), ids[observer]!, roles);
    expect(publicDigest(stateOf(deniedCard))).toBe(publicDigest(questStates[0]!));
    const evilIndex = ids.indexOf(evilId),
      goodIndex = ids.indexOf(goodId);
    const cardReceipt = await request(
      pages[evilIndex]!,
      path,
      command(questStates[evilIndex]!, { type: 'av_quest', card: 'fail' }),
    );
    expect(cardReceipt.status).toBe(200);
    checkRecipient(stateOf(cardReceipt.body), evilId, roles);
    const pendingQuest = await synchronized(pages, ids, code, roles);
    expect(pendingQuest.every((state) => state.history.quests.length === 0)).toBe(true);
    expect(
      pendingQuest.every(
        (state, i) => state.privateInfo!.myQuestCard === (i === evilIndex ? 'fail' : null),
      ),
    ).toBe(true);
    const resolved = await sendSocket(
      pages[goodIndex]!,
      command(questStates[goodIndex]!, { type: 'av_quest', card: 'success' }),
    );
    expect(resolved.type).toBe('result');
    const afterQuest = await synchronized(pages, ids, code, roles);
    expect(afterQuest[0]!.history.quests).toHaveLength(1);
    expect(afterQuest[0]!.history.quests[0]).toMatchObject({
      successCount: 1,
      failCount: 1,
      failed: true,
    });
    expect(Object.keys(afterQuest[0]!.history.quests[0]!).sort()).toEqual([
      'at',
      'failCount',
      'failed',
      'proposalId',
      'questNumber',
      'successCount',
      'teamIds',
    ]);
    expect(afterQuest[0]!.latestEvent!.actorId).toBeNull();
    expect(afterQuest.every((state) => state.privateInfo!.myQuestCard === null)).toBe(true);
    for (let i = 0; i < pages.length; i++) {
      const messages = await pages[i]!.evaluate(() => window.avalonProtocolMessages!.main!);
      for (const message of messages)
        if (message.state) checkRecipient(stateOf(message), ids[i]!, roles);
      expect(messages.some((message) => message.type === 'replaced')).toBe(false);
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});
