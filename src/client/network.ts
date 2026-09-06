import type { Command, Intent, RoomState, ServerMessage, Session } from '../shared/protocol';

export type Connection = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'replaced';
interface QueueItem {
  intent: Intent;
  roomCode: string;
  gameId: string;
  turnId: string;
  command?: Command;
}
export interface ClientView {
  session: Session | null;
  room: RoomState | null;
  connection: Connection;
  loading: boolean;
  error: string | null;
  queue: readonly QueueItem[];
}
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Private storage is optional. */
  }
};
export const savedNickname = () => read('atelier.nickname') || '';
export const inviteCode = () =>
  new URL(location.href).searchParams
    .get('room')
    ?.toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, 8) || '';
class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

export class GameClient {
  private view: ClientView = {
    session: null,
    room: null,
    connection: 'connecting',
    loading: true,
    error: null,
    queue: [],
  };
  private listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private commandRetry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private processing = false;
  private destroyed = false;
  private booted = false;
  private queue: QueueItem[] = [];
  private roomGeneration = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private patch(next: Partial<ClientView>) {
    this.view = { ...this.view, ...next, queue: [...this.queue] };
    this.listeners.forEach((fn) => fn());
  }
  clearError = () => this.patch({ error: null });
  private persist() {
    try {
      if (this.queue.length) sessionStorage.setItem('atelier.pending', JSON.stringify(this.queue));
      else sessionStorage.removeItem('atelier.pending');
    } catch {
      /* Optional storage. */
    }
  }
  private async request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(method !== 'GET' && this.view.session
            ? { 'X-CSRF-Token': this.view.session.csrfToken }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const result = (await response.json()) as T & { error?: string; code?: string };
      if (!response.ok)
        throw new RequestError(
          result.error || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
          result.code || 'REQUEST_FAILED',
          response.status,
        );
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }
  private accept(state: RoomState) {
    const old = this.view.room;
    if (
      old &&
      old.roomId === state.roomId &&
      (state.version < old.version ||
        (state.version === old.version && state.presenceVersion < old.presenceVersion))
    )
      return;
    this.patch({ room: state });
  }
  boot = async () => {
    if (this.booted) return;
    this.booted = true;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    try {
      const session = await this.request<Session>('/api/session');
      this.patch({ session });
      const last = read('atelier.room');
      const invited = inviteCode();
      if (last && (!invited || last === invited)) {
        try {
          const result = await this.request<{ state: RoomState }>(`/api/rooms/${last}`);
          this.enter(result.state, true);
        } catch (error) {
          if (error instanceof RequestError) this.report(error);
          else throw error;
        }
      }
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) {
        if (this.view.session || read('atelier.room')) this.expireSession();
      } else
        this.patch({ error: '연결을 확인해 주세요. 다시 연결하면 진행 중인 게임을 복구해요.' });
    } finally {
      this.patch({
        loading: false,
        connection: this.view.room ? 'connecting' : navigator.onLine ? 'online' : 'offline',
      });
    }
  };
  private onOnline = () => {
    if (this.view.room) this.connect();
    else this.patch({ connection: 'online' });
  };
  private onOffline = () => this.patch({ connection: 'offline' });
  private onVisible = () => {
    if (document.hidden) return;
    if (this.view.room && this.view.connection !== 'replaced') {
      void this.refresh();
      if (!this.socket || this.socket.readyState > 1) this.connect();
    }
  };
  private async identify(nickname: string) {
    if (this.view.session) return;
    const session = await this.request<Session>('/api/session', 'POST', {
      nickname: nickname.trim(),
    });
    save('atelier.nickname', session.nickname);
    this.patch({ session });
  }
  create = async (nickname: string, solo: boolean) => {
    this.patch({ loading: true, error: null });
    try {
      await this.identify(nickname);
      const { state } = await this.request<{ state: RoomState }>('/api/rooms', 'POST', {});
      this.enter(state);
      if (solo) this.enqueue({ type: 'start' });
    } catch (error) {
      this.report(error);
    } finally {
      this.patch({ loading: false });
    }
  };
  join = async (nickname: string, code: string) => {
    this.patch({ loading: true, error: null });
    try {
      await this.identify(nickname);
      const { state } = await this.request<{ state: RoomState }>('/api/join', 'POST', {
        code: code.toUpperCase().replace(/\s/g, ''),
      });
      this.enter(state);
    } catch (error) {
      this.report(error);
    } finally {
      this.patch({ loading: false });
    }
  };
  private enter(state: RoomState, restore = false) {
    this.roomGeneration++;
    this.socket?.close();
    this.socket = null;
    this.queue = [];
    if (restore) {
      try {
        const saved = JSON.parse(sessionStorage.getItem('atelier.pending') || '[]') as QueueItem[];
        if (Array.isArray(saved))
          this.queue = saved
            .filter(
              (q) => q.roomCode === state.code && q.intent && typeof q.intent.type === 'string',
            )
            .slice(0, 20);
      } catch {
        /* Ignore damaged local cache. */
      }
    }
    save('atelier.room', state.code);
    this.persist();
    history.replaceState(null, '', `/?room=${state.code}`);
    this.patch({ room: state, error: null });
    this.connect();
    void this.drain();
  }
  private connect() {
    if (this.destroyed || !this.view.room || this.view.connection === 'replaced') return;
    if (this.retry) clearTimeout(this.retry);
    const old = this.socket;
    this.socket = null;
    old?.close();
    if (!navigator.onLine) {
      this.patch({ connection: 'offline' });
      return;
    }
    const generation = this.roomGeneration;
    const url = new URL(`/api/rooms/${this.view.room.code}/ws`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.patch({ connection: this.attempts ? 'reconnecting' : 'connecting' });
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.attempts = 0;
      this.patch({ connection: 'online' });
      void this.refresh().then(() => this.drain());
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket || generation !== this.roomGeneration) return;
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === 'replaced') {
          this.socket = null;
          socket.close();
          this.patch({ connection: 'replaced' });
          return;
        }
        if (message.state) this.accept(message.state);
        if (message.type === 'error')
          this.report(
            new RequestError(
              message.error || '요청을 처리하지 못했어요.',
              message.code || 'COMMAND_FAILED',
              message.code === 'UNAUTHORIZED' ? 401 : message.code === 'ROOM_NOT_FOUND' ? 404 : 403,
            ),
          );
      } catch {
        this.patch({ error: '상태를 다시 확인하고 있어요.' });
        void this.refresh();
      }
    };
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.socket = null;
      if (this.destroyed || !this.view.room) return;
      this.patch({ connection: navigator.onLine ? 'reconnecting' : 'offline' });
      const delay =
        Math.min(12_000, 650 * 2 ** Math.min(this.attempts++, 5)) * (0.8 + Math.random() * 0.4);
      this.retry = setTimeout(() => this.connect(), delay);
      if (navigator.onLine) void this.refresh();
    };
    socket.onerror = () => socket.close();
  }
  reconnect = () => {
    this.patch({ connection: 'connecting', error: null });
    if (this.view.room) this.connect();
    else {
      this.booted = false;
      void this.boot();
    }
  };
  async refresh() {
    const code = this.view.room?.code;
    const generation = this.roomGeneration;
    if (!code) return;
    try {
      const { state } = await this.request<{ state: RoomState }>(`/api/rooms/${code}`);
      if (generation === this.roomGeneration && this.view.room?.code === code) this.accept(state);
    } catch (error) {
      if (
        generation === this.roomGeneration &&
        this.view.room?.code === code &&
        error instanceof RequestError
      )
        this.report(error);
    }
  }
  enqueue(intent: Intent) {
    const state = this.view.room;
    if (!state) return;
    if (intent.type !== 'hold' && this.queue.some((q) => q.intent.type === intent.type)) return;
    if (this.queue.length >= 20) {
      this.patch({ error: '선택을 저장하고 있어요. 잠시만 기다려 주세요.' });
      return;
    }
    this.queue.push({ intent, roomCode: state.code, gameId: state.gameId, turnId: state.turnId });
    this.persist();
    this.patch({ error: null });
    void this.drain();
  }
  private async drain() {
    if (
      this.processing ||
      this.destroyed ||
      !navigator.onLine ||
      this.view.connection === 'replaced' ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    if (this.commandRetry) {
      clearTimeout(this.commandRetry);
      this.commandRetry = null;
    }
    this.processing = true;
    try {
      while (
        this.queue.length &&
        this.view.room &&
        navigator.onLine &&
        this.socket?.readyState === WebSocket.OPEN
      ) {
        const entry = this.queue[0];
        const state = this.view.room;
        if (entry.roomCode !== state.code) {
          this.queue.shift();
          this.persist();
          this.patch({});
          continue;
        }
        // An unsent intent cannot cross a turn or a rematch. An already sent request must be resolved with its original ID.
        if (
          !entry.command &&
          (['roll', 'hold', 'score'] as string[]).includes(entry.intent.type) &&
          (entry.gameId !== state.gameId || entry.turnId !== state.turnId)
        ) {
          this.queue.shift();
          this.persist();
          this.patch({});
          continue;
        }
        if (!entry.command) {
          entry.command = {
            ...entry.intent,
            requestId: crypto.randomUUID(),
            gameId: state.gameId,
            turnId: state.turnId,
            expectedVersion: state.version,
          };
          this.persist();
        }
        try {
          const message = await this.request<ServerMessage>(
            `/api/rooms/${entry.roomCode}/command`,
            'POST',
            entry.command,
          );
          if (this.queue[0] !== entry) continue;
          if (message.state) this.accept(message.state);
          if (message.type === 'error')
            throw new RequestError(
              message.error || '요청을 처리하지 못했어요.',
              message.code || 'COMMAND_FAILED',
              400,
            );
          this.queue.shift();
          this.persist();
          this.patch({
            error: null,
            ...(navigator.onLine && this.socket?.readyState === WebSocket.OPEN
              ? { connection: 'online' as const }
              : {}),
          });
          if (entry.intent.type === 'leave') {
            this.finishLeave();
            break;
          }
        } catch (error) {
          if (this.queue[0] !== entry) continue;
          if (error instanceof RequestError && error.status < 500) {
            this.queue = [];
            this.persist();
            this.report(error);
            await this.refresh();
            break;
          }
          // The server may already have committed. Keep the exact envelope and retry, including after reload.
          this.patch({
            connection: navigator.onLine ? 'reconnecting' : 'offline',
            error: '응답을 기다리고 있어요. 연결이 돌아오면 같은 요청의 결과를 확인해요.',
          });
          this.commandRetry = setTimeout(() => {
            this.commandRetry = null;
            void this.drain();
          }, 1800);
          break;
        }
      }
    } finally {
      this.processing = false;
    }
  }
  private report(error: unknown) {
    if (error instanceof RequestError) {
      if (error.status === 401) {
        this.expireSession();
        return;
      }
      if (
        (error.status === 403 &&
          ['NOT_MEMBER', 'GRACE_EXPIRED', 'FORFEITED'].includes(error.code)) ||
        (error.status === 404 && error.code === 'ROOM_NOT_FOUND')
      ) {
        const message =
          error.code === 'ROOM_NOT_FOUND'
            ? '방이 종료되었거나 만료되었어요. 새 방을 만들거나 다른 초대 코드로 참가해 주세요.'
            : error.code === 'GRACE_EXPIRED'
              ? '재접속 대기 시간이 끝나 이번 테이블의 참여가 종료되었어요. 같은 이름으로 새 게임을 시작할 수 있어요.'
              : error.code === 'FORFEITED'
                ? '이번 경기는 기권 처리되었어요. 같은 이름으로 새 게임을 시작할 수 있어요.'
                : '이 테이블의 참여가 종료되었어요. 같은 이름으로 새 방을 만들거나 초대 코드로 참가해 주세요.';
        this.finishLeave();
        this.patch({ loading: false, error: message });
        return;
      }
    }
    this.patch({
      error: error instanceof Error ? error.message : '연결을 확인한 뒤 다시 시도해 주세요.',
    });
  }
  private expireSession() {
    this.finishLeave();
    this.patch({
      session: null,
      loading: false,
      error: '게스트 세션이 만료되었어요. 이름을 확인하고 새로 시작해 주세요.',
    });
  }
  private finishLeave() {
    this.roomGeneration++;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    if (this.commandRetry) {
      clearTimeout(this.commandRetry);
      this.commandRetry = null;
    }
    this.attempts = 0;
    this.queue = [];
    this.persist();
    save('atelier.room', null);
    history.replaceState(null, '', '/');
    this.patch({ room: null, error: null, connection: navigator.onLine ? 'online' : 'offline' });
  }
  dispose() {
    this.destroyed = true;
    this.socket?.close();
    if (this.retry) clearTimeout(this.retry);
    if (this.commandRetry) clearTimeout(this.commandRetry);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
  }
}
