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
export interface Player {
  id: string;
  nickname: string;
  seat: number;
  ready: boolean;
  connected: boolean;
  forfeited: boolean;
  graceDeadline: number | null;
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
export interface RoomState {
  roomId: string;
  code: string;
  gameId: string;
  rulesVersion: string;
  phase: 'lobby' | 'playing' | 'finished';
  version: number;
  presenceVersion: number;
  hostId: string;
  players: Player[];
  turnPlayerId: string | null;
  turnId: string;
  round: number;
  dice: Dice[];
  rolls: number;
  inputAfter: number;
  previews: Record<Category, number>;
  results: { playerId: string; rank: number; total: number; forfeited: boolean }[];
  updatedAt: number;
  expiresAt: number;
}
export interface Session {
  playerId: string;
  nickname: string;
  csrfToken: string;
  expiresAt: number;
}
export type Intent =
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'hold'; held: boolean[] }
  | { type: 'roll' }
  | { type: 'score'; category: Category }
  | { type: 'rematch' }
  | { type: 'leave' };
export type Command = Intent & {
  requestId: string;
  gameId: string;
  expectedVersion: number;
  turnId: string;
};
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
// GET /api/rooms/:code/ws => authenticated WebSocket; messages ServerMessage (full snapshots)
// GET /api/health => {ok:boolean,commit:string}; GET /version.json => {commit:string}
// Invite URL /?room=CODE. Last room code saved locally; identity only cookie.
