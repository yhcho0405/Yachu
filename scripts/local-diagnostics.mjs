import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { freemem, totalmem } from 'node:os';
import { stripVTControlCharacters } from 'node:util';

const errorClasses = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
]);

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
      const value = stripVTControlCharacters(line)
        .trim()
        .replace(/^\[[A-Za-z0-9_: -]{1,48}\]\s*/, '');
      if (value.startsWith('at ')) {
        // Never trust arbitrary function names or paths as diagnostics: an
        // exception can contain user input. Retain only known runtime source
        // basenames and numeric locations, with no caller or directory text.
        const frame = value.match(
          /\b((?:cli|index|worker|entry|core|runtime|proxy-worker|ci-server|dev|local-diagnostics)\.(?:[cm]?js|ts)):(\d+):(\d+)\)?$/,
        );
        if (frame) return [`at ${frame[1]}:${frame[2]}:${frame[3]}`];
        const internal = value.match(/\bnode:internal\/[^\s()]+:(\d+):(\d+)\)?$/);
        return internal ? [`at node-internal:${internal[1]}:${internal[2]}`] : [];
      }
      const error = value.match(/^([A-Za-z]*Error)(?::|\s|$)/)?.[1];
      const codes =
        value.match(
          /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOMEM|ENOSPC|EADDRINUSE|SIGKILL|SIGSEGV|SIGABRT|ERR_[A-Z_]+)\b/g,
        ) ?? [];
      return [
        ...(error ? [errorClasses.has(error) ? error : 'Error'] : []),
        ...codes.map((code) => (code.startsWith('ERR_') ? 'ERR_REDACTED' : code)),
      ];
    })
    .slice(-100)
    .join('\n');
}
export function startLocalDiagnostics() {
  mkdirSync('work', { recursive: true });
  const output = 'work/local-diagnostics.jsonl';
  const pending = { stdout: '', stderr: '' };
  let frames = [];
  writeFileSync(output, '');
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
    consume(channel, chunk) {
      pending[channel] += chunk.toString();
      const lines = pending[channel].split('\n');
      pending[channel] = lines.pop().slice(-8192);
      const safe = safeStack(lines.join('\n'));
      if (safe) frames = [...frames, ...safe.split('\n')].slice(-100);
    },
    finish(code, signal) {
      clearInterval(timer);
      sample('wrangler-exit', { code, signal });
      const tail = safeStack(Object.values(pending).join('\n'));
      const stack = [...frames, ...(tail ? tail.split('\n') : [])].slice(-100).join('\n');
      writeFileSync('work/local-runtime-stack.txt', stack + '\n');
      if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT')
        console.error(
          `Local Wrangler exited (code=${code}, signal=${signal ?? 'none'}). Sanitized stack:\n${stack}`,
        );
    },
  };
}
