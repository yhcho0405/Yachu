import { spawn, execFileSync } from 'node:child_process';
import { ensureLocalSecret } from './local-env.mjs';
// Local development credentials are random, never shared with production or committed.
ensureLocalSecret();
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const child = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', '8787'], {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
