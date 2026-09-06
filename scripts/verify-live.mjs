import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.env.PLAYWRIGHT_BASE_URL);
const commit = process.env.EXPECTED_COMMIT;
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('Expected full deployment commit');
if (base.username || base.password) throw new Error('Public origin must not contain credentials');
const report = { origin: base.origin, commit, startedAt: new Date().toISOString(), checks: [] };

async function request(path, method = 'GET') {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}

function checkType(path, response, expected) {
  const type = response.headers.get('content-type') ?? '';
  if (!expected.test(type)) throw new Error(`${path}: unexpected Content-Type ${type}`);
  if (response.headers.get('content-length') === '0') throw new Error(`${path}: empty asset`);
  return { path, status: response.status, contentType: type };
}

try {
  // Allow a short propagation window without creating sessions or games.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const revisions = await Promise.all(
        ['/api/health', '/version.json'].map(async (path) => {
          const response = await request(path);
          const check = checkType(path, response, /^application\/json\b/i);
          const data = await response.json();
          if (data.commit !== commit || (path === '/api/health' && data.ok !== true))
            throw new Error(`${path}: deployment revision is not ready`);
          return { ...check, commit: data.commit };
        }),
      );
      report.checks.push(...revisions);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(2000);
    }
  }

  const entry = await request('/');
  const entryCheck = checkType('/', entry, /^text\/html\b/i);
  const html = await entry.text();
  if (!html.includes('id="root"')) throw new Error('App root is missing');
  const entryAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  if (
    !entryAssets.some((path) => path.endsWith('.js')) ||
    !entryAssets.some((path) => path.endsWith('.css'))
  )
    throw new Error('App script or stylesheet is missing');
  report.checks.push(entryCheck);

  const bundles = readdirSync('dist/assets').filter((file) => /\.(js|css)$/.test(file));
  const assets = new Map([
    ...[...bundles.map((file) => `/assets/${file}`), ...entryAssets].map((path) => [
      path,
      path.endsWith('.css') ? /^text\/css\b/i : /^(?:text|application)\/javascript\b/i,
    ]),
    ...['yacht', 'tikatuka', 'avalon'].map((game) => [`/previews/${game}.webp`, /^image\/webp\b/i]),
    ...['lobby1', 'lobby2', 'yach1', 'yach2', 'tica1', 'tica2', 'aval1'].map((track) => [
      `/music/${track}.mp3`,
      /^audio\/mpeg\b/i,
    ]),
  ]);
  const results = await Promise.allSettled(
    [...assets].map(async ([path, type]) => checkType(path, await request(path, 'HEAD'), type)),
  );
  report.checks.push(
    ...results.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : { path: [...assets.keys()][index], error: result.reason.message },
    ),
  );
  if (results.some((result) => result.status === 'rejected'))
    throw new Error('Published assets failed verification; see live-smoke.json');
  report.ok = true;
  console.log(`Verified ${commit}: ${report.checks.length} public revision/page/asset checks`);
} catch (error) {
  report.ok = false;
  report.error = error.message;
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  mkdirSync('work', { recursive: true });
  writeFileSync('work/live-smoke.json', JSON.stringify(report, null, 2) + '\n');
}
