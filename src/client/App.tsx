import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { GAME_CATALOG, gameMetadata, type GameType } from '../shared/games';
import { GameClient, inviteCode, savedNickname } from './network';
import { DieIcon, Icon, Modal } from './components';
import { GameCatalog, SelectedGameSummary } from './catalog';
import { useSettings } from './settings';
import SettingsPanel from './SettingsPanel';
import Lobby, { ConnectionPolicy } from './Lobby';

const client = new GameClient();
const YachtGame = lazy(() => import('./games/yacht/YachtGame'));
const YachtHelp = lazy(() => import('./games/yacht/Help'));
const TikatukaGame = lazy(() => import('./games/tikatuka/TikatukaGame'));
const TikatukaHelp = lazy(() => import('./games/tikatuka/Help'));
type Entry = { kind: 'create'; gameType: GameType; solo: boolean } | { kind: 'join'; code: string };
class GameBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="game-load-error" role="alert">
        <h2>{this.props.name} 화면을 불러오지 못했습니다.</h2>
        <p>새로고침하면 현재 경기로 돌아올 수 있습니다.</p>
        <button className="button primary" onClick={() => location.reload()}>
          새로고침
        </button>
      </section>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const view = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const { room, session } = view;
  const [nickname, setNickname] = useState(savedNickname);
  const [code, setCode] = useState(inviteCode);
  const [selectedGame, setSelectedGame] = useState<GameType>('yacht');
  const [browsing, setBrowsing] = useState(false);
  const [settings, setSettings] = useSettings();
  const [modal, setModal] = useState<'settings' | 'help' | 'leave' | 'switch' | null>(null);
  const [nextEntry, setNextEntry] = useState<Entry | null>(null);
  const [waitingToLeave, setWaitingToLeave] = useState(false);
  const [copied, setCopied] = useState(false);
  const previousRoom = useRef<string | null>(null);
  useEffect(() => {
    void client.boot();
    return () => client.dispose();
  }, []);
  useEffect(() => {
    if (room && room.roomId !== previousRoom.current) {
      setSelectedGame(room.gameType);
      setBrowsing(false);
    }
    previousRoom.current = room?.roomId ?? null;
  }, [room?.roomId]);
  useEffect(() => {
    if (!session) setModal(null);
  }, [session]);
  const runEntry = (entry: Entry) => {
    if (entry.kind === 'create')
      void client.create(session?.nickname ?? nickname, entry.solo, entry.gameType);
    else void client.join(session?.nickname ?? nickname, entry.code);
  };
  useEffect(() => {
    if (waitingToLeave && !room && nextEntry) {
      setWaitingToLeave(false);
      setNextEntry(null);
      runEntry(nextEntry);
    }
  }, [room, waitingToLeave, nextEntry]);
  useEffect(() => {
    if (view.error && waitingToLeave) {
      setWaitingToLeave(false);
      setNextEntry(null);
    }
  }, [view.error, waitingToLeave]);
  const requestEntry = (entry: Entry) => {
    if (room && entry.kind === 'join' && entry.code === room.code) {
      setBrowsing(false);
      return;
    }
    if (room) {
      setNextEntry(entry);
      setModal('switch');
    } else runEntry(entry);
  };
  const connected = view.connection === 'online' && !view.reloadRequired;
  const pending = view.queue.length > 0;
  const busy = view.loading || waitingToLeave || view.reloadRequired;
  const showCatalog = !room || browsing;
  const visibleGame = showCatalog ? selectedGame : room.gameType;
  const game = gameMetadata(visibleGame);
  const validNickname = !!session || nickname.trim().length > 0;
  const own = room?.players.find((player) => player.id === session?.playerId);
  const actingId =
    room?.gameType === 'tikatuka' && room.stage === 'responding'
      ? room.declaration?.responderId
      : room?.turnPlayerId;
  const myTurn = actingId === session?.playerId && !own?.forfeited;
  const current = room?.players.find((player) => player.id === actingId);
  const copyInvite = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${room.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCode(room.code);
      setCopied(false);
    }
  };
  const leave = () => {
    if (!room) return;
    client.enqueue({ type: 'leave' });
    setModal(null);
  };
  return (
    <div
      className={`app-shell ${showCatalog ? 'catalog-shell' : ''}`}
      data-testid="game-state"
      data-game-type={room?.gameType ?? selectedGame}
      data-phase={room?.phase ?? 'home'}
      data-version={room?.version}
      data-game-id={room?.gameId}
      data-turn-id={room?.turnId}
      data-state={room ? JSON.stringify(room) : undefined}
    >
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            setBrowsing(true);
          }}
        >
          <span className="brand-mark">
            <DieIcon />
          </span>
          <span>
            <b>아틀리에</b>
            <small>온라인 보드게임</small>
          </span>
        </a>
        <div className="topbar-actions">
          {room && (
            <>
              <button className="catalog-nav" onClick={() => setBrowsing((value) => !value)}>
                {showCatalog ? '경기로 돌아가기' : '게임 목록'}
              </button>
              <span className="room-pill">
                <span className={`connection-dot ${connected ? 'connected' : ''}`} />
                <span>방</span>
                <strong data-testid="room-code">{room.code}</strong>
              </span>
            </>
          )}
          <button
            className="icon-button"
            onClick={() => setSettings((value) => ({ ...value, muted: !value.muted }))}
            aria-label={settings.muted ? '음소거 해제' : '음소거'}
            aria-pressed={settings.muted}
          >
            <Icon name={settings.muted ? 'mute' : 'sound'} />
          </button>
          <button className="icon-button" aria-label="설정" onClick={() => setModal('settings')}>
            <Icon name="settings" />
          </button>
          <button className="icon-button" aria-label="게임 방법" onClick={() => setModal('help')}>
            <Icon name="help" />
          </button>
          {room && (
            <button
              className="icon-button leave-button"
              aria-label="방 나가기"
              onClick={() => setModal('leave')}
            >
              <Icon name="exit" />
            </button>
          )}
        </div>
      </header>
      {(view.error || (room && !connected)) && (
        <div className="connection-banner" role="status">
          <span>
            {view.reloadRequired
              ? view.error
              : view.connection === 'replaced'
                ? '다른 탭에서 연결했습니다. 이 탭에서 계속하려면 다시 연결하세요.'
                : view.connection === 'offline'
                  ? '인터넷 연결이 끊겼습니다. 연결이 복구되면 경기를 이어갑니다.'
                  : room && !connected
                    ? '경기에 다시 연결하고 있습니다.'
                    : view.error}
          </span>
          <button
            onClick={
              view.reloadRequired
                ? () => location.reload()
                : view.connection === 'replaced' || !connected
                  ? client.reconnect
                  : client.clearError
            }
          >
            {view.reloadRequired ? '새로고침' : !connected ? '다시 연결' : '닫기'}
          </button>
        </div>
      )}
      {showCatalog ? (
        <main className="catalog-page">
          <div className="catalog-page-heading">
            <div>
              <span className="section-number">아틀리에</span>
              <h1>게임을 선택하세요</h1>
              <p>닉네임을 입력하고 시작하거나, 초대받은 방에 참가하세요.</p>
            </div>
            <span className="catalog-count">{GAME_CATALOG.length}개의 게임</span>
          </div>
          {room && (
            <div className="resume-game" role="status">
              <div>
                <strong>{gameMetadata(room.gameType).name} 경기 참가 중</strong>
                <p>게임 목록을 둘러보는 동안에도 현재 방에 연결되어 있습니다.</p>
              </div>
              <button
                className="button primary"
                data-testid="resume-game"
                onClick={() => setBrowsing(false)}
              >
                경기로 돌아가기 <Icon name="arrow" />
              </button>
            </div>
          )}
          <div className="catalog-layout">
            <GameCatalog selected={selectedGame} onSelect={setSelectedGame} />
            <section className="catalog-entry">
              <SelectedGameSummary gameType={selectedGame} />
              <div className="entry-card">
                <label htmlFor="nickname">닉네임</label>
                <input
                  id="nickname"
                  data-testid="nickname-input"
                  autoComplete="nickname"
                  maxLength={16}
                  placeholder="닉네임을 입력하세요"
                  value={session?.nickname ?? nickname}
                  readOnly={!!session}
                  onChange={(event) => setNickname(event.target.value)}
                  aria-describedby="nickname-hint"
                />
                <p id="nickname-hint">
                  {session ? '기존 게스트 이름으로 참가합니다.' : '가입 없이 사용할 수 있습니다.'}
                </p>
                <button
                  data-testid="solo-button"
                  className="button primary"
                  disabled={!validNickname || busy}
                  onClick={() =>
                    requestEntry({ kind: 'create', gameType: selectedGame, solo: true })
                  }
                >
                  <span>혼자 시작</span>
                  <span>
                    {gameMetadata(selectedGame).soloMode === 'computer' ? (
                      '컴퓨터 대전'
                    ) : (
                      <Icon name="arrow" />
                    )}
                  </span>
                </button>
                <button
                  data-testid="create-room"
                  className="button secondary"
                  disabled={!validNickname || busy}
                  onClick={() =>
                    requestEntry({ kind: 'create', gameType: selectedGame, solo: false })
                  }
                >
                  방 만들기{' '}
                  <span>
                    {gameMetadata(selectedGame).maxPlayers === 2
                      ? '1대1'
                      : `2–${gameMetadata(selectedGame).maxPlayers}명`}
                  </span>
                </button>
                <div className="join-divider">
                  <span>초대받은 방 참가</span>
                </div>
                <form
                  className="join-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (validNickname && code.length === 8 && !busy)
                      requestEntry({ kind: 'join', code });
                  }}
                >
                  <input
                    data-testid="join-code"
                    aria-label="방 코드"
                    placeholder="8자리 방 코드"
                    maxLength={8}
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))
                    }
                  />
                  <button
                    data-testid="join-room"
                    className="button small"
                    disabled={!validNickname || code.length !== 8 || busy}
                  >
                    참가
                  </button>
                </form>
                <p className="invite-game-note">방의 게임 종류는 참가할 때 자동으로 확인합니다.</p>
              </div>
              <button className="text-button catalog-help" onClick={() => setModal('help')}>
                {gameMetadata(selectedGame).name} 게임 방법 <Icon name="arrow" />
              </button>
            </section>
          </div>
        </main>
      ) : (
        <main className={`room-layout room-${room.gameType}`}>
          <div className="room-title">
            <div>
              <span className="eyebrow">{game.name}</span>
              <h1 data-testid="phase">
                {room.phase === 'lobby'
                  ? '대기실'
                  : room.phase === 'finished'
                    ? '경기 종료'
                    : myTurn
                      ? '내 차례'
                      : `${current?.nickname ?? '상대'} 차례`}
              </h1>
            </div>
            <button className="invite-button" onClick={() => void copyInvite()}>
              <Icon name="copy" />
              {copied ? '복사 완료' : '초대 링크 복사'}
            </button>
          </div>
          {session && room.phase === 'lobby' ? (
            <Lobby
              room={room}
              session={session}
              connected={connected}
              pending={pending}
              onIntent={client.enqueue.bind(client)}
              onHelp={() => setModal('help')}
            />
          ) : (
            session && (
              <GameBoundary key={room.gameType} name={game.name}>
                <Suspense
                  fallback={
                    <div className="game-loading" role="status">
                      {game.name} 화면 불러오는 중…
                    </div>
                  }
                >
                  {room.gameType === 'yacht' ? (
                    <YachtGame
                      room={room}
                      session={session}
                      connection={view.reloadRequired ? 'connecting' : view.connection}
                      queue={view.queue}
                      error={view.error}
                      settings={settings}
                      onIntent={client.enqueue.bind(client)}
                    />
                  ) : (
                    <TikatukaGame
                      room={room}
                      session={session}
                      connection={view.reloadRequired ? 'connecting' : view.connection}
                      queue={view.queue}
                      error={view.error}
                      settings={settings}
                      onIntent={client.enqueue.bind(client)}
                    />
                  )}
                </Suspense>
              </GameBoundary>
            )
          )}
        </main>
      )}
      <footer className="site-footer">
        <span>아틀리에 · 온라인 보드게임</span>
        <button className="text-button" onClick={() => setModal('help')}>
          게임 방법
        </button>
      </footer>
      {modal === 'settings' && (
        <Modal title="설정" onClose={() => setModal(null)}>
          <SettingsPanel settings={settings} setSettings={setSettings} />
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title={`${game.name} 게임 방법`} wide onClose={() => setModal(null)}>
          <Suspense fallback={<p role="status">게임 방법을 불러오고 있습니다.</p>}>
            {visibleGame === 'yacht' ? <YachtHelp /> : <TikatukaHelp />}
          </Suspense>
          <ConnectionPolicy />
        </Modal>
      )}
      {(modal === 'leave' || modal === 'switch') && (
        <Modal
          title={modal === 'switch' ? '현재 방을 나가고 계속할까요?' : '방을 나갈까요?'}
          onClose={() => {
            setModal(null);
            setNextEntry(null);
          }}
        >
          <p className="help-text">
            {room?.phase === 'playing'
              ? '현재 경기를 나가면 기권 처리됩니다. 게임 목록만 둘러보려면 취소를 누르세요.'
              : '현재 방에서 나갑니다. 닉네임과 설정은 유지됩니다.'}
          </p>
          <div className="modal-buttons">
            <button
              className="button secondary"
              onClick={() => {
                setModal(null);
                setNextEntry(null);
              }}
            >
              취소
            </button>
            <button
              className="button danger"
              disabled={!connected || pending}
              onClick={() => {
                if (modal === 'switch') setWaitingToLeave(true);
                leave();
              }}
            >
              {modal === 'switch' ? '방을 나가고 계속' : '방 나가기'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
