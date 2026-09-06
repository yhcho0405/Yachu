import { GameError } from './engine';

const encoder = new TextEncoder();
export const COOKIE_NAME = '__Host-dice_session';
export function requireSecret(secret: string | undefined): asserts secret is string {
  if (!secret || encoder.encode(secret).length < 32)
    throw new GameError(
      'SERVICE_UNAVAILABLE',
      '서버 인증 설정을 준비하고 있습니다. 잠시 후 다시 접속해 주세요.',
      503,
    );
}
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export function cryptoDie(): number {
  // 2^32 is not divisible by six: rejection sampling removes modulo bias.
  const limit = 4_294_967_292;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0]!;
  } while (value >= limit);
  return (value % 6) + 1;
}
export function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exactly 32 symbols, 40 bits.
  return Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (value) => alphabet[value & 31],
  ).join('');
}
export async function keyedHash(secret: string, purpose: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}\0${value}`)),
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function readCookie(request: Request): string | null {
  const parts = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (parts.length !== 1) return null;
  const value = parts[0]!.slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function cookieHeader(token: string, maxAge: number): string {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
