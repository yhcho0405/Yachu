import { mkdtempSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const { SESSION_SECRET, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
if (
  !SESSION_SECRET ||
  SESSION_SECRET.length < 32 ||
  !CLOUDFLARE_API_TOKEN ||
  !CLOUDFLARE_ACCOUNT_ID
)
  throw new Error(
    'Required deployment secrets missing or session secret shorter than 32 characters',
  );
const temp = mkdtempSync(join(tmpdir(), 'dice-deploy-'));
try {
  const path = join(temp, 'secrets.json');
  writeFileSync(path, JSON.stringify({ SESSION_SECRET }), { mode: 0o600 });
  const result = spawnSync('npx', ['wrangler', 'deploy', '--secrets-file', path], {
    encoding: 'utf8',
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_WRITE_LOGS: 'false',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  let output = (result.stdout ?? '') + (result.stderr ?? '');
  for (const secret of [SESSION_SECRET, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID])
    output = output.split(secret).join('[redacted]');
  console.log(output);
  if (result.error || result.status !== 0)
    throw new Error(`Wrangler deployment failed (${result.status})`);
  const url = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/)?.[0];
  if (!url) throw new Error('Wrangler did not report a workers.dev deployment URL');
  if (process.env.GITHUB_ENV)
    appendFileSync(
      process.env.GITHUB_ENV,
      `PLAYWRIGHT_BASE_URL=${url}\nEXPECTED_COMMIT=${process.env.GITHUB_SHA}\n`,
    );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### 배포\n- 플레이 URL: ${url}\n- 커밋: ${process.env.GITHUB_SHA}\n- 실제 브라우저 검증: 다음 단계 결과를 확인하세요.\n`,
    );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
