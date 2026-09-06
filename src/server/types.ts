import type { GameRoom } from './room';
import type { SessionRegistry } from './registry';
export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<GameRoom>;
  REGISTRY: DurableObjectNamespace<SessionRegistry>;
  SESSION_SECRET?: string;
}
export interface AuthSession {
  playerId: string;
  nickname: string;
  expiresAt: number;
}
