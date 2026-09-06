import { spawn, execFileSync } from 'node:child_process';
import { ensureLocalSecret } from './local-env.mjs';
import { startLocalDiagnostics } from './local-diagnostics.mjs';
// Local development credentials are random, never shared with production or committed.
ensureLocalSecret();
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const diagnostic = process.env.CI ? startLocalDiagnostics() : undefined;
const child = spawn('npx', ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    ...(diagnostic ? { WRANGLER_LOG_PATH: diagnostic.rawLog } : {}),
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => {
  diagnostic?.finish(code, signal);
  process.exit(code ?? 1);
});
