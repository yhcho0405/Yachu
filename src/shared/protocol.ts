import type { GameType } from './games';
import type { TikatukaIntent, TikatukaRoomState } from './tikatuka';
import type { AvalonIntent, AvalonRoomState } from './avalon';
export type { GameType } from './games';
export type { TikatukaIntent, TikatukaRoomState } from './tikatuka';
export type { AvalonIntent, AvalonRoomState } from './avalon';
export const PROTOCOL_VERSION = 3 as const;
export const SCHEMA_VERSION = 2 as const;

export const CATEGORIES = [
  'aces',
  'deuces',
  'threes',
  'fours',
  'fives',
  'sixes',
  'choice',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
] as const;
export type Category = (typeof CATEGORIES)[number];
export const LABELS: Record<Category, string> = {
  aces: '에이스',
  deuces: '듀스',
  threes: '트레이',
  fours: '포',
  fives: '파이브',
  sixes: '식스',
  choice: '초이스',
  fourKind: '포 다이스',
  fullHouse: '풀 하우스',
  smallStraight: '스몰 스트레이트',
  largeStraight: '라지 스트레이트',
  yacht: '야추',
};
export type Scores = Record<Category, number | null>;
export interface CommonPlayer {
  id: string;
  kind: 'human' | 'computer';
  nickname: string;
  seat: number;
  ready: boolean;
  connected: boolean;
  forfeited: boolean;
  graceDeadline: number | null;
}
export interface Player extends CommonPlayer {
  scores: Scores;
  upper: number;
  bonus: number;
  total: number;
}
export interface Dice {
  id: number;
  value: number;
  held: boolean;
}
export interface RoomBase<G extends GameType, P extends CommonPlayer> {
  schemaVersion: typeof SCHEMA_VERSION;
  protocolVersion: 2 | 3;
  gameType: G;
  roomId: string;
  code: string;
  gameId: string;
  rulesVersion: string;
  phase: 'lobby' | 'playing' | 'finished';
  version: number;
  presenceVersion: number;
  hostId: string;
  players: P[];
  turnPlayerId: string | null;
  turnId: string;
  inputAfter: number;
  results: { playerId: string; rank: number; total: number; forfeited: boolean }[];
  updatedAt: number;
  expiresAt: number;
}
export interface YachtRoomState extends RoomBase<'yacht', Player> {
  round: number;
  dice: Dice[];
  rolls: number;
  previews: Record<Category, number>;
}
/** Only recipient-safe snapshots belong to the client protocol. */
export type RoomState = YachtRoomState | TikatukaRoomState | AvalonRoomState;
export interface Session {
  playerId: string;
  nickname: string;
  csrfToken: string;
  expiresAt: number;
}
export type CommonIntent =
  { type: 'ready'; ready: boolean } | { type: 'start' } | { type: 'rematch' } | { type: 'leave' };
export type YachtIntent =
  | CommonIntent
  | { type: 'hold'; held: boolean[] }
  | { type: 'roll' }
  | { type: 'score'; category: Category };
export type Intent = YachtIntent | TikatukaIntent | AvalonIntent;
export interface CommandEnvelope {
  requestId: string;
  gameId: string;
  expectedVersion: number;
  turnId: string;
}
export type LegacyYachtCommand = CommandEnvelope &
  YachtIntent & { gameType?: never; protocolVersion?: never };
/** The legacy envelope is valid only for the existing Yacht protocol. */
export type Command = CommandEnvelope &
  (
    | (YachtIntent & { gameType: 'yacht'; protocolVersion: 2 | 3 })
    | ((CommonIntent | TikatukaIntent) & { gameType: 'tikatuka'; protocolVersion: 2 | 3 })
    | ((CommonIntent | AvalonIntent) & { gameType: 'avalon'; protocolVersion: 3 })
    | LegacyYachtCommand
  );
export interface ServerMessage {
  type: 'state' | 'result' | 'error' | 'replaced';
  state?: RoomState;
  requestId?: string;
  error?: string;
  code?: string;
}
// Same-origin API, JSON, credentials cookie + X-CSRF-Token for authenticated POST.
// POST /api/session {nickname} => Session; GET /api/session => Session; DELETE /api/session
// POST /api/rooms {} => {state:RoomState}; POST /api/join {code} => {state:RoomState}
// GET /api/rooms/:code => {state:RoomState}; POST /api/rooms/:code/command Command => ServerMessage
// GET /api/rooms/:code/ws => authenticated WebSocket; recipient-authorized snapshots only.
// GET /api/health => {ok:boolean,commit:string}; GET /version.json => {commit:string}
// Invite URL /?room=CODE. Last room code saved locally; identity only cookie.
