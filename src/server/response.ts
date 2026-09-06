import { GameError } from './engine';
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
export function json(
  value: unknown,
  status = 200,
  additional: Record<string, string> = {},
): Response {
  return Response.json(value, {
    status,
    headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...additional },
  });
}
export function failure(error: unknown): Response {
  return error instanceof GameError
    ? json(
        { type: 'error', code: error.code, error: error.message },
        error.status,
        error.status === 429 ? { 'Retry-After': '10' } : {},
      )
    : json(
        {
          type: 'error',
          code: 'SERVER_ERROR',
          error: '요청을 완료하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
        },
        503,
      );
}
