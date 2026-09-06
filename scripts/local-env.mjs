import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
export function ensureLocalSecret() {
  if (!existsSync('.dev.vars'))
    writeFileSync('.dev.vars', `SESSION_SECRET=${randomBytes(48).toString('hex')}\n`, {
      mode: 0o600,
    });
}
