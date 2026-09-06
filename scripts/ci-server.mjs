import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_getMiniflareWorkerOptions, unstable_readConfig } from 'wrangler';
import { ensureLocalSecret } from './local-env.mjs';
import { safeStack } from './local-diagnostics.mjs';

// Use exactly the Miniflare/workerd version required by the locked Wrangler.
// Node only starts that runtime; all assets, HTTP, WebSocket and SQLite game
// handling run inside workerd using the root Wrangler configuration.
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = createRequire(
  require.resolve('wrangler'),
)('miniflare');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
let runtime;
let stopping;
let exitCode = 0;

function report(error) {
  const detail = safeStack(error instanceof Error ? (error.stack ?? error.name) : String(error));
  console.error(`[ci-server] Runtime failure${detail ? `\n${detail}` : '.'}`);
}
async function stop(code = 0) {
  exitCode = Math.max(exitCode, code);
  process.exitCode = exitCode;
  if (stopping) return stopping;
  stopping = (async () => {
    const timeout = setTimeout(() => {
      console.error('[ci-server] Runtime disposal timed out.');
      process.exit(1);
    }, 10_000);
    timeout.unref();
    try {
      await runtime?.dispose();
    } catch (error) {
      report(error);
      exitCode = 1;
    } finally {
      clearTimeout(timeout);
      process.exitCode = exitCode;
    }
  })();
  return stopping;
}
function fail(error) {
  report(error);
  void stop(1);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop());
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

class SafeRuntimeLog extends Log {
  // Miniflare reports a failed crash restart through Log.error, rather than
  // rejecting ready (which already resolved). Such failures must fail CI too.
  error(error) {
    fail(error);
  }
  log(message) {
    const detail = safeStack(message);
    if (detail) console.error(`[ci-server]\n${detail}`);
  }
}

try {
  const port = Number(process.env.DICE_CI_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new RangeError('Invalid CI server port');
  if (!existsSync('dist/index.html') || !existsSync('dist-worker/index.js')) {
    console.error('[ci-server] Run npm run build and npm run build:worker before dev:ci.');
    throw new Error('Missing prebuilt client or Worker');
  }
  ensureLocalSecret();
  const config = unstable_readConfig({ config: resolve('wrangler.jsonc') });
  const { workerOptions, externalWorkers } = unstable_getMiniflareWorkerOptions(config);
  // Wrangler has already bundled every project import. MF5 cannot convert the
  // obsolete module-discovery rules; the prebuilt ESM bundle needs none.
  if (config.rules.length) throw new Error('Review CI module handling for custom Wrangler rules');
  const { modulesRules: _modulesRules, ...derivedOptions } = workerOptions;
  void _modulesRules;
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port,
      cf: false,
      logRequests: false,
      telemetry: { enabled: false },
      log: new SafeRuntimeLog(LogLevel.ERROR),
      handleUncaughtError: fail,
      handleStructuredLogs: ({ message, level }) => {
        const detail = safeStack(message);
        if (level === 'error') console.error('[ci-server] workerd reported an error.');
        if (detail) console.error(`[ci-server] workerd\n${detail}`);
      },
      unsafeHandleRuntimeRestart: () => {
        console.error('[ci-server] Unexpected workerd restart; failing verification.');
        fail(new Error('Unexpected workerd restart'));
      },
      // MF5 normalizes this to isolated SQLite persistence when shared storage
      // is disabled. Keep CI separate from an ordinary wrangler dev session.
      resourcePersistencePath: resolve(process.env.DICE_CI_STATE_DIR ?? '.wrangler/ci-state'),
      workers: [
        {
          ...derivedOptions,
          name: config.name,
          modules: true,
          scriptPath: resolve('dist-worker/index.js'),
        },
        ...externalWorkers,
      ],
    }),
  );
  const url = await runtime.ready;
  if (!stopping) console.log(`[ci-server] Actual workerd ready at ${url.origin}`);
} catch (error) {
  fail(error);
}
