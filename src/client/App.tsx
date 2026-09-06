import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  CATEGORIES,
  LABELS,
  type Category,
  type Dice,
  type Player,
  type RoomState,
} from '../shared/protocol';
import { GameClient, inviteCode, savedNickname } from './network';
import { createDiceScene } from './scene';
import { createAudio } from './audio';

const client = new GameClient();
const audio = createAudio();
const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const RULES: Record<Category, string> = {
  aces: '1이 나온 주사위의 합',
  deuces: '2가 나온 주사위의 합',
  threes: '3이 나온 주사위의 합',
  fours: '4가 나온 주사위의 합',
  fives: '5가 나온 주사위의 합',
  sixes: '6이 나온 주사위의 합',
  choice: '주사위 다섯 개의 합',
  fourKind: '같은 눈 4개 이상 · 다섯 개의 합',
  fullHouse: '같은 눈 3개 + 2개 (5개도 인정) · 합계',
  smallStraight: '서로 다른 눈 4개 이상 연속 · 15점',
  largeStraight: '서로 다른 눈 5개 연속 · 30점',
  yacht: '다섯 개가 모두 같은 눈 · 50점',
};
const DECORATIVE: Dice[] = [3, 5, 1, 6, 4].map((value, id) => ({ id, value, held: false }));
interface Settings {
  muted: boolean;
  sfx: number;
  music: number;
  reducedMotion: boolean;
}
function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('atelier.settings') || '{}') as Partial<Settings>;
    return {
      muted: saved.muted ?? false,
      sfx: saved.sfx ?? 0.55,
      music: saved.music ?? 0.12,
      reducedMotion: saved.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  } catch {
    return {
      muted: false,
      sfx: 0.55,
      music: 0.12,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }
}
function DieIcon({ value = 5 }: { value?: number }) {
  return (
    <span className="die-icon" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i
          key={i}
          className={
            (
              [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]][
                value - 1
              ] ?? []
            ).includes(i)
              ? 'pip on'
              : 'pip'
          }
        />
      ))}
    </span>
  );
}
function Icon({
  name,
}: {
  name: 'sound' | 'mute' | 'help' | 'settings' | 'copy' | 'arrow' | 'close' | 'exit';
}) {
  const paths = {
    sound: (
      <>
        <path d="M11 4 6 8H3v8h3l5 4z" />
        <path d="M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" />
      </>
    ),
    mute: (
      <>
        <path d="M11 4 6 8H3v8h3l5 4z" />
        <path d="m16 9 5 6m0-6-5 6" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2m0 3h.01" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    exit: (
      <>
        <path d="M10 4H4v16h6m-1-8h12m-5-5 5 5-5 5" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function Board({
  dice = DECORATIVE,
  room,
  interactive = false,
  pending = false,
  reducedMotion,
  onDieClick,
  onAnimationChange,
  online = true,
}: {
  dice?: Dice[];
  room?: RoomState;
  interactive?: boolean;
  pending?: boolean;
  reducedMotion: boolean;
  onDieClick: (id: number) => void;
  onAnimationChange: (active: boolean) => void;
  online?: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createDiceScene> | null>(null);
  const click = useRef(onDieClick);
  const animate = useRef(onAnimationChange);
  const previous = useRef<{ key: string; online: boolean } | null>(null);
  const [error, setError] = useState('');
  click.current = onDieClick;
  animate.current = onAnimationChange;
  useEffect(() => {
    if (!mount.current) return;
    try {
      scene.current = createDiceScene(mount.current, {
        onDieClick: (id) => click.current(id),
        onError: setError,
        onAnimationChange: (active) => animate.current(active),
        onImpact: (intensity) => audio.play('impact', intensity),
        onCollision: (intensity) => audio.play('collision', intensity),
      });
    } catch {
      setError('3D 화면을 불러오지 못했어요. 아래 주사위 버튼으로 계속 플레이할 수 있어요.');
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    const key = room ? `${room.gameId}/${room.turnId}/${room.rolls}` : 'decorative';
    const shouldAnimate = !!(
      previous.current &&
      previous.current.online &&
      online &&
      previous.current.key !== key &&
      room &&
      room.rolls > 0
    );
    scene.current?.update(dice, {
      rollKey: key,
      animate: shouldAnimate,
      interactive,
      pending,
      reducedMotion,
    });
    previous.current = { key, online };
  }, [dice, room?.gameId, room?.turnId, room?.rolls, interactive, pending, reducedMotion, online]);
  return (
    <div className="board-viewport">
      <div className="canvas-mount" ref={mount} />
      {error && (
        <p className="scene-error" role="status">
          {error}
        </p>
      )}
      <div className="board-watermark" aria-hidden="true">
        DICE ATELIER <span>EST. 2026</span>
      </div>
    </div>
  );
}
function Scorecard({
  room,
  me,
  selected,
  onSelect,
  canScore,
}: {
  room: RoomState;
  me: string;
  selected: Category | null;
  onSelect: (category: Category) => void;
  canScore: boolean;
}) {
  const own = room.players.find((p) => p.id === me);
  const upper = own?.upper ?? 0;
  return (
    <section className="scorecard" aria-label="점수판">
      <header className="scorecard-heading">
        <div>
          <span className="eyebrow">THE SCORECARD</span>
          <h2>오늘의 기록</h2>
        </div>
        <span className="round-chip">
          {room.phase === 'lobby' ? '12개의 기회' : `${Math.min(12, room.round)} / 12 라운드`}
        </span>
      </header>
      <div
        className="score-scroll"
        tabIndex={room.players.length > 2 ? 0 : undefined}
        aria-label="플레이어별 점수표"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">점수 항목</th>
              {room.players.map((player) => (
                <th
                  scope="col"
                  key={player.id}
                  className={room.turnPlayerId === player.id ? 'active-player-column' : ''}
                >
                  <span className={`seat-dot seat-${player.seat}`} />
                  <span title={player.nickname}>{player.nickname}</span>
                  {player.id === me && <small>나</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((category, index) => (
              <tr
                key={category}
                className={`${index === 6 ? 'lower-section' : ''} ${selected === category ? 'selected-row' : ''}`}
              >
                <th scope="row">
                  <span
                    className={`category-symbol ${index === 11 ? 'yacht-symbol' : ''}`}
                    aria-hidden="true"
                  >
                    {index < 6 ? PIPS[index + 1] : ['Σ', '4×', '⌂', '⌁', '↗', '★'][index - 6]}
                  </span>
                  <span>{LABELS[category]}</span>
                </th>
                {room.players.map((player) => {
                  const value = player.scores[category];
                  const selectable = player.id === me && value === null;
                  const preview =
                    value === null &&
                    room.phase === 'playing' &&
                    room.turnPlayerId === player.id &&
                    room.rolls > 0;
                  return (
                    <td
                      key={player.id}
                      className={`${room.turnPlayerId === player.id ? 'active-player-column' : ''} ${value === 0 ? 'zero-score' : ''}`}
                    >
                      {selectable ? (
                        <button
                          data-testid={`score-${category}`}
                          className={`score-value ${preview ? 'preview' : ''} ${selected === category ? 'selected' : ''}`}
                          disabled={!canScore}
                          onClick={() => onSelect(category)}
                          aria-label={`${LABELS[category]}${preview ? ` 예상 ${room.previews[category]}점` : ' 미사용'}`}
                          aria-pressed={selected === category}
                        >
                          {preview ? room.previews[category] : <span className="unused">—</span>}
                        </button>
                      ) : (
                        <span
                          className={preview ? 'score-preview' : 'recorded-score'}
                          aria-label={value === null ? '미사용' : `${value}점 확정`}
                        >
                          {value === null ? (preview ? room.previews[category] : '—') : value}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>상단 소계</th>
              {room.players.map((p) => (
                <td key={p.id}>
                  {p.upper}
                  <small> / 63</small>
                </td>
              ))}
            </tr>
            <tr>
              <th>
                보너스 <small>+35</small>
              </th>
              {room.players.map((p) => (
                <td key={p.id} className={p.bonus ? 'bonus-earned' : ''}>
                  {p.bonus ? '+35' : '—'}
                </td>
              ))}
            </tr>
            <tr className="total-row">
              <th>총점</th>
              {room.players.map((p) => (
                <td key={p.id}>{p.total}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="bonus-progress">
        <div>
          <span>{upper >= 63 ? '상단 보너스 달성!' : '나의 상단 보너스'}</span>
          <strong>{upper >= 63 ? '+35점' : `${63 - upper}점 더 모으면 +35`}</strong>
        </div>
        <div className="progress-track">
          <i style={{ width: `${Math.min(100, (upper / 63) * 100)}%` }} />
        </div>
      </div>
      <p className="score-hint">
        {room.phase === 'playing'
          ? '연한 숫자는 예상 점수 · 항목 선택 후 확정해요'
          : '— 미사용 항목 · 0은 확정한 점수'}
      </p>
    </section>
  );
}
function PlayerCard({
  player,
  me,
  current,
  host,
}: {
  player: Player;
  me: boolean;
  current: boolean;
  host: boolean;
}) {
  return (
    <div
      className={`player-card ${current ? 'current' : ''} ${player.forfeited ? 'forfeited' : ''}`}
    >
      <span className={`player-avatar seat-${player.seat}`}>{player.seat + 1}</span>
      <div className="player-info">
        <strong>
          {player.nickname}
          {me && <small>나</small>}
          {host && (
            <span className="host-crown" title="방장">
              ♔
            </span>
          )}
        </strong>
        <span>
          {player.forfeited
            ? '기권'
            : !player.connected
              ? '재접속 대기 중'
              : current
                ? '주사위를 굴릴 차례'
                : '테이블에 함께 있어요'}
        </span>
      </div>
      <b className="player-total">
        {player.total}
        <small>점</small>
      </b>
    </div>
  );
}
export default function App() {
  const view = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const { room, session } = view;
  const [nickname, setNickname] = useState(savedNickname);
  const [code, setCode] = useState(inviteCode);
  const [modal, setModal] = useState<'help' | 'settings' | 'leave' | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const [selected, setSelected] = useState<Category | null>(null);
  const [zeroConsent, setZeroConsent] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [time, setTime] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const lastSound = useRef<RoomState | null>(null);
  useEffect(() => {
    void client.boot();
    const unlock = () => {
      void audio.unlock();
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      client.dispose();
      audio.dispose();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);
  useEffect(() => {
    audio.setSettings(settings);
    try {
      localStorage.setItem('atelier.settings', JSON.stringify(settings));
    } catch {
      /* Settings still work without persistence. */
    }
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
  }, [settings]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = (event: MediaQueryListEvent) => {
      if (event.matches) setSettings((s) => ({ ...s, reducedMotion: true }));
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    setTime(Date.now());
    if (!room || room.inputAfter <= Date.now()) return;
    const timer = setInterval(() => {
      setTime(Date.now());
      if (Date.now() >= room.inputAfter) clearInterval(timer);
    }, 80);
    return () => clearInterval(timer);
  }, [room?.inputAfter]);
  useEffect(() => {
    setSelected(null);
    setZeroConsent(false);
  }, [room?.turnId, room?.gameId, room?.rolls]);
  useEffect(() => {
    if (view.error) {
      setSelected(null);
      setZeroConsent(false);
    }
  }, [view.error]);
  useEffect(() => {
    if (!session) setModal(null);
  }, [session]);
  useEffect(() => {
    const old = lastSound.current;
    lastSound.current = room;
    if (!room || !old || document.hidden || view.connection !== 'online') return;
    if (room.gameId !== old.gameId) return;
    if (room.phase === 'finished' && old.phase !== 'finished') audio.play('finish');
    else if (room.turnId !== old.turnId) audio.play('turn');
    else if (room.rolls > old.rolls) {
      audio.play('roll');
      if (room.previews.yacht === 50) audio.play('yacht');
    }
  }, [room, view.connection]);
  const own = room?.players.find((p) => p.id === session?.playerId);
  const current = room?.players.find((p) => p.id === room.turnPlayerId);
  const myTurn =
    room?.phase === 'playing' && room.turnPlayerId === session?.playerId && !own?.forfeited;
  const host = room?.hostId === session?.playerId;
  const pendingAction = view.queue.some((q) => q.intent.type !== 'hold');
  const pendingHold = [...view.queue].reverse().find((q) => q.intent.type === 'hold');
  const optimisticDice = room?.dice.map((die, index) => ({
    ...die,
    held: pendingHold?.intent.type === 'hold' ? pendingHold.intent.held[index] : die.held,
  }));
  const connected = view.connection === 'online';
  const inputReady = !!room && time >= room.inputAfter && !animating;
  const canHold =
    !!myTurn &&
    connected &&
    inputReady &&
    !pendingAction &&
    (room?.rolls ?? 0) > 0 &&
    (room?.rolls ?? 0) < 3;
  const canScore = !!myTurn && connected && inputReady && !pendingAction && (room?.rolls ?? 0) > 0;
  const allHeld = optimisticDice?.every((d) => d.held) ?? false;
  const canRoll =
    !!myTurn &&
    connected &&
    inputReady &&
    !pendingAction &&
    (room?.rolls ?? 0) < 3 &&
    (!room?.rolls || !allHeld);
  const holdDie = (id: number) => {
    if (!canHold || !optimisticDice) return;
    const die = optimisticDice.find((d) => d.id === id);
    if (!die) return;
    audio.play(die.held ? 'release' : 'hold');
    client.enqueue({
      type: 'hold',
      held: optimisticDice.map((d) => (d.id === id ? !d.held : d.held)),
    });
  };
  const roll = () => {
    if (canRoll) {
      setSelected(null);
      setZeroConsent(false);
      client.enqueue({ type: 'roll' });
    }
  };
  const choose = (category: Category) => {
    if (!canScore) return;
    setSelected(category);
    setZeroConsent(false);
    audio.play('select');
  };
  const confirm = () => {
    if (!selected || !canScore || !room || (room.previews[selected] === 0 && !zeroConsent)) return;
    audio.play('confirm');
    client.enqueue({ type: 'score', category: selected });
    setSelected(null);
    setZeroConsent(false);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.isComposing ||
        modal ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        target.closest('input,textarea,select,[contenteditable="true"],dialog')
      )
        return;
      if (event.code === 'Space') {
        if (target.closest('button,a[href],[role="button"]')) return;
        event.preventDefault();
        roll();
      } else if (/^[1-5]$/.test(event.key)) {
        event.preventDefault();
        const die = optimisticDice?.[Number(event.key) - 1];
        if (die) holdDie(die.id);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  const copyInvite = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${room.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      client.clearError();
      setCode(room.code);
    }
  };
  const validNickname = !!session || nickname.trim().length >= 1;
  const busy = view.loading;
  const shortName = session?.nickname || nickname;
  return (
    <div
      className="app-shell"
      data-testid="game-state"
      data-phase={room?.phase || 'home'}
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
            if (room) {
              event.preventDefault();
              setModal('leave');
            }
          }}
        >
          <span className="brand-mark">
            <DieIcon />
          </span>
          <span>
            <b>다이스 아틀리에</b>
            <small>DICE ATELIER</small>
          </span>
        </a>
        <div className="topbar-actions">
          {room && (
            <span className="room-pill">
              <span className={`connection-dot ${connected ? 'connected' : ''}`} />
              <span>ROOM</span>
              <strong data-testid="room-code">{room.code}</strong>
            </span>
          )}
          <button
            className="icon-button"
            onClick={() => setSettings((s) => ({ ...s, muted: !s.muted }))}
            aria-label={settings.muted ? '음소거 해제' : '음소거'}
            aria-pressed={settings.muted}
          >
            <Icon name={settings.muted ? 'mute' : 'sound'} />
          </button>
          <button className="icon-button" onClick={() => setModal('settings')} aria-label="설정">
            <Icon name="settings" />
          </button>
          <button className="icon-button" onClick={() => setModal('help')} aria-label="게임 방법">
            <Icon name="help" />
          </button>
          {room && (
            <button
              className="icon-button leave-button"
              onClick={() => setModal('leave')}
              aria-label="방 나가기"
            >
              <Icon name="exit" />
            </button>
          )}
        </div>
      </header>
      {(view.error || (room && !connected)) && (
        <div className="connection-banner" role="status">
          <span>
            {view.connection === 'replaced'
              ? '다른 탭에서 이 자리에 접속했어요. 이 탭에서 이어 하려면 다시 연결해 주세요.'
              : view.connection === 'offline'
                ? '인터넷 연결이 끊겼어요. 연결이 돌아오면 내 자리로 돌아와요.'
                : room && !connected
                  ? '테이블에 다시 연결하고 있어요. 확정된 기록은 안전하게 보관돼요.'
                  : view.error}
          </span>
          <button
            onClick={
              view.connection === 'replaced' || !connected ? client.reconnect : client.clearError
            }
          >
            {!connected ? '다시 연결' : '닫기'}
          </button>
        </div>
      )}
      {!room ? (
        <main className="home-layout">
          <section className="welcome">
            <span className="eyebrow">
              <i /> GOOD TIMES, GOOD DICE
            </span>
            <h1>
              주사위 다섯 개,
              <br />
              우리의 작은
              <br />
              <em>즐거운 순간.</em>
            </h1>
            <p className="welcome-description">
              운에 조금, 선택에 조금.
              <br />
              친구와 마주 앉듯 가볍게 즐기는 야추.
            </p>
            <div className="entry-card">
              <label htmlFor="nickname">테이블에서 사용할 이름</label>
              <input
                id="nickname"
                data-testid="nickname-input"
                autoComplete="nickname"
                maxLength={16}
                placeholder="닉네임을 입력해 주세요"
                value={session?.nickname ?? nickname}
                readOnly={!!session}
                onChange={(event) => setNickname(event.target.value)}
                aria-describedby="nickname-hint"
              />
              <p id="nickname-hint">
                {session
                  ? '기존 게스트 이름으로 이어서 플레이해요.'
                  : '가입 없이, 이름만 있으면 준비 끝.'}
              </p>
              <button
                data-testid="solo-button"
                className="button primary"
                disabled={!validNickname || busy}
                onClick={() => void client.create(shortName, true)}
              >
                <span>혼자 가볍게 시작</span>
                <Icon name="arrow" />
              </button>
              <button
                data-testid="create-room"
                className="button secondary"
                disabled={!validNickname || busy}
                onClick={() => void client.create(shortName, false)}
              >
                친구와 함께 · 방 만들기 <span>2–4명</span>
              </button>
              <div className="join-divider">
                <span>초대를 받으셨나요?</span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (validNickname && code.length === 8 && !busy)
                    void client.join(shortName, code);
                }}
                className="join-form"
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
            </div>
            <button className="text-button help-link" onClick={() => setModal('help')}>
              처음이라면? 게임 방법 알아보기 <span>↗</span>
            </button>
          </section>
          <section className="home-table">
            <div className="table-caption">
              <span className="tiny-flower">✳</span>
              <span>
                A LITTLE LUCK.
                <br />A LOVELY TIME.
              </span>
            </div>
            <Board
              reducedMotion={settings.reducedMotion}
              onDieClick={() => {}}
              onAnimationChange={() => {}}
            />
            <div className="home-table-note">
              <span className="note-number">05</span>
              <div>
                <strong>굴리고, 남기고, 기록하세요.</strong>
                <span>다섯 개의 주사위로 만드는 열두 번의 선택</span>
              </div>
              <span className="note-star">✦</span>
            </div>
            <div className="feature-row">
              <span>✧ 실시간 함께 플레이</span>
              <span>↺ 언제든 이어하기</span>
              <span>♪ 작은 소리까지 즐겁게</span>
            </div>
          </section>
        </main>
      ) : (
        <main className="room-layout">
          <div className="room-title">
            <div>
              <span className="eyebrow">
                {room.phase === 'lobby'
                  ? 'MAKE YOURSELF AT HOME'
                  : room.phase === 'finished'
                    ? 'A GAME WELL PLAYED'
                    : 'LET THE GOOD TIMES ROLL'}
              </span>
              <h1 data-testid="phase">
                {room.phase === 'lobby'
                  ? '우리만의 테이블'
                  : room.phase === 'finished'
                    ? '좋은 한 판이었어요.'
                    : myTurn
                      ? '나의 차례예요.'
                      : `${current?.nickname ?? '친구'} 님의 차례`}
              </h1>
            </div>
            <button className="invite-button" onClick={() => void copyInvite()}>
              <Icon name="copy" />
              {copied ? '링크를 복사했어요' : '초대 링크 복사'}
            </button>
          </div>
          {room.phase === 'lobby' ? (
            <div className="lobby-layout">
              <section className="lobby-panel">
                <div className="lobby-intro">
                  <span className="section-number">01 — THE COMPANY</span>
                  <h2>함께할 친구를 기다려요.</h2>
                  <p>
                    초대 링크나 방 코드를 보내주세요.
                    <br />
                    최대 네 명이 같은 테이블에서 만나요.
                  </p>
                </div>
                <div className="lobby-seats">
                  {Array.from({ length: 4 }, (_, seat) => {
                    const player = room.players.find((p) => p.seat === seat);
                    return player ? (
                      <div key={seat} className="lobby-seat occupied">
                        <span className={`player-avatar seat-${seat}`}>{seat + 1}</span>
                        <div>
                          <strong>
                            {player.nickname} {player.id === session?.playerId && <small>나</small>}
                          </strong>
                          <span>
                            {player.id === room.hostId
                              ? '방장'
                              : !player.connected
                                ? '재접속 대기'
                                : '참가자'}
                          </span>
                        </div>
                        <span className={`ready-status ${player.ready ? 'ready' : ''}`}>
                          {player.ready
                            ? '✓ 준비 완료'
                            : player.connected
                              ? '준비 중'
                              : '연결 대기'}
                        </span>
                      </div>
                    ) : (
                      <div key={seat} className="lobby-seat empty">
                        <span className="empty-avatar">+</span>
                        <div>
                          <strong>비어 있는 자리</strong>
                          <span>친구를 초대해 주세요</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="lobby-controls">
                  <button
                    data-testid="ready-button"
                    className={`button ${own?.ready ? 'secondary' : 'primary'}`}
                    disabled={!connected || pendingAction}
                    onClick={() => client.enqueue({ type: 'ready', ready: !own?.ready })}
                  >
                    {own?.ready ? '준비 취소' : '준비 완료'}
                  </button>
                  {host && (
                    <button
                      data-testid="start-game"
                      className="button primary"
                      disabled={
                        !connected ||
                        pendingAction ||
                        room.players.some((p) => p.id !== room.hostId && !p.ready) ||
                        room.players.some((p) => !p.connected)
                      }
                      onClick={() => client.enqueue({ type: 'start' })}
                    >
                      게임 시작 <Icon name="arrow" />
                    </button>
                  )}
                </div>
                <p className="lobby-wait">
                  {host
                    ? '친구들이 모두 준비하면 시작할 수 있어요.'
                    : '준비를 마치면 방장이 게임을 시작해요.'}
                </p>
                <div className="policy-note">
                  <strong>서로의 시간을 편안하게.</strong>
                  <p>
                    턴 시간 제한은 없어요. 연결이 끊기면 경기당 누적 2분 동안 기다린 뒤 기권
                    처리해요. 재접속해도 사용한 유예 시간은 돌아오지 않아요.{' '}
                    <button onClick={() => setModal('help')}>자세히 보기</button>
                  </p>
                </div>
              </section>
              <section className="lobby-table">
                <Board
                  reducedMotion={settings.reducedMotion}
                  onDieClick={() => {}}
                  onAnimationChange={() => {}}
                />
                <span className="lobby-board-label">YOUR TABLE IS READY.</span>
                <div className="lobby-code-card">
                  <span>INVITATION CODE</span>
                  <strong>{room.code}</strong>
                  <p>이 여덟 글자가 우리 테이블의 문이에요.</p>
                </div>
              </section>
            </div>
          ) : (
            <>
              <div className="players-strip">
                {room.players.map((player) => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    me={player.id === session?.playerId}
                    current={player.id === room.turnPlayerId && room.phase === 'playing'}
                    host={player.id === room.hostId}
                  />
                ))}
              </div>
              <div className="play-layout">
                <section className="play-table">
                  <div className="play-table-top">
                    <span>
                      <i className={`turn-dot ${myTurn ? 'mine' : ''}`} />
                      {room.phase === 'finished'
                        ? '완성된 오늘의 기록'
                        : myTurn
                          ? 'YOUR TURN'
                          : 'AT THE TABLE'}
                    </span>
                    <span
                      className="roll-pips"
                      aria-label={`${Math.max(0, 3 - room.rolls)}번 더 굴릴 수 있어요`}
                    >
                      {[0, 1, 2].map((i) => (
                        <i key={i} className={i < room.rolls ? 'used' : ''} />
                      ))}
                      <b>{room.rolls} / 3</b>
                    </span>
                  </div>
                  <Board
                    dice={optimisticDice}
                    room={room}
                    interactive={canHold}
                    pending={view.queue.some((q) => q.intent.type === 'roll')}
                    reducedMotion={settings.reducedMotion}
                    onDieClick={holdDie}
                    onAnimationChange={setAnimating}
                    online={connected}
                  />
                  {room.phase === 'playing' ? (
                    <>
                      <div className="dice-controls" aria-label="주사위 보관 선택">
                        {optimisticDice?.map((die, index) => (
                          <button
                            key={die.id}
                            data-testid={`die-${die.id}`}
                            data-value={die.value}
                            data-held={die.held}
                            className={`die-control ${die.held ? 'held' : ''}`}
                            disabled={!canHold}
                            aria-label={`${index + 1}번 주사위 ${room.rolls ? die.value : '미굴림'}${die.held ? ' 보관 해제' : ' 보관'}`}
                            aria-pressed={die.held}
                            onClick={() => holdDie(die.id)}
                          >
                            <DieIcon value={die.value || index + 1} />
                            <span>{die.held ? '보관 중' : '선택'}</span>
                            <kbd>{index + 1}</kbd>
                          </button>
                        ))}
                      </div>
                      <div className="table-action">
                        <p className="dice-instruction">
                          {room.rolls === 0
                            ? '첫 번째 굴림으로 오늘의 운을 만나보세요.'
                            : room.rolls === 3
                              ? '세 번 모두 굴렸어요. 점수표에 기록해 주세요.'
                              : allHeld
                                ? '모두 보관했어요. 점수를 기록하거나 보관을 해제해 주세요.'
                                : '남길 주사위를 눌러 보관하고, 나머지는 한 번 더.'}
                        </p>
                        <button
                          data-testid="roll-button"
                          className="roll-button"
                          disabled={!canRoll}
                          onClick={roll}
                        >
                          <DieIcon value={3} />
                          <span>
                            {pendingAction
                              ? '기록하는 중…'
                              : animating
                                ? '주사위가 멈추는 중…'
                                : !myTurn
                                  ? '친구의 차례를 기다려요'
                                  : room.rolls === 0
                                    ? '주사위 굴리기'
                                    : room.rolls < 3
                                      ? `다시 굴리기 · ${3 - room.rolls}번 남음`
                                      : '점수를 선택해 주세요'}
                          </span>
                          <span className="shortcut">SPACE</span>
                        </button>
                        <span className="table-footnote">
                          {view.queue.some((q) => q.intent.type === 'hold')
                            ? '보관 선택을 저장하고 있어요…'
                            : !connected
                              ? '연결 후 계속할 수 있어요'
                              : myTurn
                                ? '주사위 1–5 · 굴리기 Space'
                                : '현재 주사위와 기록은 모두에게 함께 보여요'}
                        </span>
                      </div>
                      <div
                        className={`score-selection ${selected ? 'has-selection' : ''}`}
                        aria-live="polite"
                      >
                        {selected ? (
                          <>
                            <div>
                              <span className="eyebrow">YOUR CHOICE</span>
                              <h3>
                                {LABELS[selected]}{' '}
                                <strong>
                                  {room.previews[selected]}
                                  <small>점</small>
                                </strong>
                              </h3>
                              <p>{RULES[selected]}</p>
                              {room.previews[selected] === 0 && (
                                <label className="zero-consent">
                                  <input
                                    data-testid="confirm-zero"
                                    type="checkbox"
                                    checked={zeroConsent}
                                    onChange={(event) => setZeroConsent(event.target.checked)}
                                  />
                                  <span>
                                    이 항목을 0점으로 사용하고 되돌릴 수 없음을 확인했어요.
                                  </span>
                                </label>
                              )}
                            </div>
                            <button
                              data-testid="confirm-score"
                              className="button primary"
                              disabled={
                                !canScore || (room.previews[selected] === 0 && !zeroConsent)
                              }
                              onClick={confirm}
                            >
                              {room.previews[selected] === 0 ? '0점으로 기록' : '이 점수로 기록'}{' '}
                              <Icon name="arrow" />
                            </button>
                          </>
                        ) : (
                          <p>
                            <span>✎</span>
                            {myTurn
                              ? '점수표에서 원하는 항목을 선택해 주세요.'
                              : '친구가 어떤 선택을 할지 함께 지켜봐요.'}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <section className="results" aria-label="최종 순위">
                      <span className="eyebrow">THE FINAL SCORES</span>
                      <h2>
                        {room.players.length === 1
                          ? `${own?.total ?? 0}점, 멋진 기록이에요.`
                          : room.results
                              .filter((r) => r.rank === 1 && !r.forfeited)
                              .map((r) => room.players.find((p) => p.id === r.playerId)?.nickname)
                              .join(', ') + ' 님이 1위예요!'}
                      </h2>
                      <div className="rank-list">
                        {room.results.map((result) => {
                          const player = room.players.find((p) => p.id === result.playerId);
                          return (
                            <div
                              key={result.playerId}
                              className={result.rank === 1 && !result.forfeited ? 'winner' : ''}
                            >
                              <span>{result.forfeited ? '—' : `${result.rank}위`}</span>
                              <strong>
                                {player?.nickname}
                                {result.playerId === session?.playerId && <small>나</small>}
                              </strong>
                              <b>
                                {result.total}
                                <small>점{result.forfeited ? ' · 기권' : ''}</small>
                              </b>
                            </div>
                          );
                        })}
                      </div>
                      {host ? (
                        <button
                          data-testid="rematch-button"
                          className="button primary"
                          disabled={!connected || pendingAction}
                          onClick={() => client.enqueue({ type: 'rematch' })}
                        >
                          같은 친구들과 한 판 더 <Icon name="arrow" />
                        </button>
                      ) : (
                        <p>방장이 재경기를 시작하면 로비로 함께 이동해요.</p>
                      )}
                    </section>
                  )}
                </section>
                <Scorecard
                  room={room}
                  me={session?.playerId ?? ''}
                  selected={selected}
                  onSelect={choose}
                  canScore={canScore}
                />
              </div>
            </>
          )}
        </main>
      )}
      <footer className="site-footer">
        <span>작은 우연을 모아, 좋은 시간을 만들어요.</span>
        <span>
          DICE ATELIER <i>✳</i> 2026
        </span>
      </footer>
      {modal === 'settings' && (
        <Modal title="편안한 플레이를 위해" onClose={() => setModal(null)}>
          <div className="settings-list">
            <label>
              <span>
                <strong>전체 음소거</strong>
                <small>모든 소리를 잠시 쉬게 해요</small>
              </span>
              <input
                type="checkbox"
                checked={settings.muted}
                onChange={(event) => setSettings((s) => ({ ...s, muted: event.target.checked }))}
              />
            </label>
            <label>
              <span>
                <strong>효과음</strong>
                <small>주사위와 버튼의 작은 소리</small>
              </span>
              <input
                aria-label="효과음 볼륨"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.sfx}
                onChange={(event) =>
                  setSettings((s) => ({ ...s, sfx: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <span>
                <strong>배경 음악</strong>
                <small>테이블 곁의 차분한 멜로디</small>
              </span>
              <input
                aria-label="배경 음악 볼륨"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.music}
                onChange={(event) =>
                  setSettings((s) => ({ ...s, music: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <span>
                <strong>효과 줄이기</strong>
                <small>카메라와 주사위의 움직임을 줄여요</small>
              </span>
              <input
                type="checkbox"
                checked={settings.reducedMotion}
                onChange={(event) =>
                  setSettings((s) => ({ ...s, reducedMotion: event.target.checked }))
                }
              />
            </label>
          </div>
          <p className="modal-note">
            설정은 이 브라우저에 저장돼요. 기기의 ‘동작 줄이기’ 설정도 존중해요.
          </p>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="다섯 개로 만드는 열두 번의 선택" onClose={() => setModal(null)} wide>
          <div className="help-steps">
            <p>
              <b>01</b>
              <span>
                <strong>최대 세 번 굴려요.</strong> 첫 굴림은 다섯 개 모두. 원하는 주사위를 눌러
                보관하면 나머지만 다시 굴려요.
              </span>
            </p>
            <p>
              <b>02</b>
              <span>
                <strong>점수 항목 하나를 골라요.</strong> 첫 번째나 두 번째 굴림 뒤에도 기록할 수
                있어요. 조건이 맞지 않아도 0점으로 쓸 수 있지만, 기록한 항목은 바꿀 수 없어요.
              </span>
            </p>
            <p>
              <b>03</b>
              <span>
                <strong>12개 항목을 채우면 끝!</strong> 합계가 가장 높은 플레이어가 이겨요. 점수가
                같으면 공동 순위예요.
              </span>
            </p>
          </div>
          <div className="rules-grid">
            {CATEGORIES.map((category) => (
              <div key={category}>
                <strong>{LABELS[category]}</strong>
                <span>{RULES[category]}</span>
              </div>
            ))}
          </div>
          <div className="help-callout">
            <strong>상단 합계 63점부터 보너스 +35점</strong>
            <p>
              에이스부터 식스까지 합계예요. 최고점은 325점. 같은 눈 다섯 개는 풀 하우스로도
              인정하며, 추가 야추 보너스나 조커 규칙은 없어요.
            </p>
          </div>
          <h3>온라인 테이블의 약속</h3>
          <p className="help-text">
            1–4명이 순서대로 플레이해요. 게임 중에는 새 참가자가 들어올 수 없어요. 새로고침이나
            잠깐의 단절 후에는 같은 브라우저에서 원래 자리로 돌아와요. 방 코드와 이름만으로 다른
            사람의 자리를 가져갈 수는 없어요.
          </p>
          <p className="help-text">
            턴 시간 제한은 없어요. 연결이 끊기면 경기당 <strong>누적 2분</strong>까지 기다리며,
            유예가 끝나면 기권 처리해요. 재접속해도 이미 사용한 시간은 돌아오지 않아요. 명시적으로
            방을 나가면 즉시 기권해요. 로비에서 연결이 끊긴 자리는 2분 뒤 정리되며, 방장이 떠나면
            다음 참가자에게 방장을 넘겨요. 비활성 방은 24시간 뒤 정리돼요.
          </p>
          <p className="help-text">
            키보드는 <kbd>1</kbd>–<kbd>5</kbd>로 보관, <kbd>Space</kbd>로 굴리기. 점수와 메뉴는{' '}
            <kbd>Tab</kbd>과 <kbd>Enter</kbd>로 선택해요. 입력칸과 대화상자 안에서는 게임 단축키가
            쉬어요.
          </p>
        </Modal>
      )}
      {modal === 'leave' && (
        <Modal
          title={room?.phase === 'playing' ? '이번 테이블을 떠날까요?' : '테이블을 나갈까요?'}
          onClose={() => setModal(null)}
        >
          <p className="help-text">
            {room?.phase === 'playing'
              ? '지금 나가면 이번 경기는 기권으로 기록돼요. 잠시 쉬어야 한다면 창을 유지해 주세요.'
              : '첫 화면으로 돌아가요. 친구들이 있는 테이블은 계속 열려 있어요.'}
          </p>
          <div className="modal-buttons">
            <button className="button secondary" onClick={() => setModal(null)}>
              계속 함께하기
            </button>
            <button
              className="button danger"
              onClick={() => {
                client.enqueue({ type: 'leave' });
                setModal(null);
              }}
            >
              방 나가기
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
