import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { freemem, totalmem } from 'node:os';

function optionalRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
export function safeStack(raw) {
  // Emit only stack frames, error class names and known OS codes. Never log
  // request headers, bodies, configuration, environment values or raw messages.
  return raw
    .split('\n')
    .flatMap((line) => {
      const value = line.trim();
      if (/^at [A-Za-z0-9_.<>[\] /\\():-]+$/.test(value))
        return [value.replace(/[A-Za-z0-9_-]{32,}/g, '[opaque]')];
      const error = value.match(/^([A-Za-z]*Error)(?::|\s|$)/)?.[1];
      const codes =
        value.match(
          /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOMEM|ENOSPC|EADDRINUSE|SIGKILL|SIGSEGV|SIGABRT|ERR_[A-Z_]+)\b/g,
        ) ?? [];
      return [...(error ? [error] : []), ...codes];
    })
    .slice(-100)
    .join('\n');
}
export function startLocalDiagnostics() {
  mkdirSync('work', { recursive: true });
  const output = 'work/local-diagnostics.jsonl';
  const rawLog = 'work/local-wrangler-raw.log';
  writeFileSync(output, '');
  writeFileSync(rawLog, '', { mode: 0o600 });
  const sample = (event = 'sample', detail = {}) => {
    let processes = [];
    try {
      processes = execFileSync('ps', ['-eo', 'comm=,rss='], { encoding: 'utf8', timeout: 3000 })
        .trim()
        .split('\n')
        .map((line) => {
          const match = line.trim().match(/^(.*)\s+(\d+)$/);
          return match ? { name: basename(match[1].trim()), rssKiB: Number(match[2]) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.rssKiB - a.rssKiB)
        .slice(0, 12);
    } catch {
      /* Resource diagnostics must not control the game runtime. */
    }
    const record = {
      time: new Date().toISOString(),
      event,
      ...detail,
      freeMiB: Math.round(freemem() / 1048576),
      totalMiB: Math.round(totalmem() / 1048576),
      processes,
      cgroupMemoryEvents: optionalRead('/sys/fs/cgroup/memory.events'),
      memoryAvailable:
        optionalRead('/proc/meminfo')?.match(/^MemAvailable:\s+(\d+ kB)/m)?.[1] ?? null,
    };
    appendFileSync(output, JSON.stringify(record) + '\n');
  };
  sample('start');
  const timer = setInterval(sample, 30000);
  timer.unref();
  return {
    rawLog,
    finish(code, signal) {
      clearInterval(timer);
      sample('wrangler-exit', { code, signal });
      if (existsSync(rawLog)) {
        const stack = safeStack(readFileSync(rawLog, 'utf8'));
        writeFileSync('work/local-runtime-stack.txt', stack + '\n');
        if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT')
          console.error(
            `Local Wrangler exited (code=${code}, signal=${signal ?? 'none'}). Sanitized stack:\n${stack}`,
          );
      }
    },
  };
}
