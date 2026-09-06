import { spawn, execFileSync } from 'node:child_process';
import { ensureLocalSecret } from './local-env.mjs';
import { startLocalDiagnostics } from './local-diagnostics.mjs';
// Local development credentials are random, never shared with production or committed.
ensureLocalSecret();
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const diagnostic = process.env.CI ? startLocalDiagnostics() : undefined;
const child = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '8787',
    ...(diagnostic ? ['--log-level', 'debug'] : []),
  ],
  {
    stdio: diagnostic ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      ...(diagnostic ? { WRANGLER_WRITE_LOGS: 'false' } : {}),
    },
  },
);
let shutdownSignal;
if (diagnostic) {
  child.stdout.on('data', (chunk) => diagnostic.consume('stdout', chunk));
  child.stderr.on('data', (chunk) => diagnostic.consume('stderr', chunk));
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    shutdownSignal = signal;
    child.kill(signal);
  });
child.on('close', (code, signal) => {
  diagnostic?.finish(code, signal ?? shutdownSignal);
  process.exit(code ?? 1);
});
