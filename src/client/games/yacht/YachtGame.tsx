import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, LABELS, type Category, type YachtRoomState } from '../../../shared/protocol';
import { Icon, DieIcon } from '../../components';
import { createAudio } from '../../audio';
import type { GameScreenProps } from '../types';
import YachtBoard from './Board';
import { RULES } from './help-data';

type Player = YachtRoomState['players'][number];
const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
function Scorecard({
  room,
  me,
  selected,
  onSelect,
  canScore,
}: {
  room: YachtRoomState;
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
          <span className="eyebrow">점수판</span>
          <h2>점수판</h2>
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
          ? '연한 숫자는 예상 점수 · 항목 선택 후 확정'
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
                : '참가 중'}
        </span>
      </div>
      <b className="player-total">
        {player.total}
        <small>점</small>
      </b>
    </div>
  );
}
export default function YachtGame({
  room,
  session,
  connection,
  queue,
  settings,
  error,
  onIntent,
}: GameScreenProps<YachtRoomState>) {
  const view = { connection, queue, error };
  const [audio] = useState(createAudio);
  const [selected, setSelected] = useState<Category | null>(null);
  const [zeroConsent, setZeroConsent] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [time, setTime] = useState(Date.now());
  const lastSound = useRef<YachtRoomState | null>(null);
  useEffect(() => {
    const unlock = () => {
      void audio.unlock();
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      audio.dispose();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [audio]);
  useEffect(() => audio.setSettings(settings), [audio, settings]);
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
  }, [room, view.connection, audio]);
  const own = room?.players.find((p) => p.id === session?.playerId);
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
    onIntent({
      type: 'hold',
      held: optimisticDice.map((d) => (d.id === id ? !d.held : d.held)),
    });
  };
  const roll = () => {
    if (canRoll) {
      setSelected(null);
      setZeroConsent(false);
      onIntent({ type: 'roll' });
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
    onIntent({ type: 'score', category: selected });
    setSelected(null);
    setZeroConsent(false);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.isComposing ||
        document.querySelector('dialog[open]') ||
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
  return (
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
              {room.phase === 'finished' ? '최종 점수판' : myTurn ? '내 차례' : '상대 차례'}
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
          <YachtBoard
            audio={audio}
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
                    ? '주사위를 굴려 차례를 시작하세요.'
                    : room.rolls === 3
                      ? '세 번 모두 굴렸습니다. 점수표에 기록해 주세요.'
                      : allHeld
                        ? '모두 보관했습니다. 점수를 기록하거나 보관을 해제해 주세요.'
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
                      ? '처리 중…'
                      : animating
                        ? '주사위가 멈추는 중…'
                        : !myTurn
                          ? '상대 차례'
                          : room.rolls === 0
                            ? '주사위 굴리기'
                            : room.rolls < 3
                              ? `다시 굴리기 · ${3 - room.rolls}번 남음`
                              : '점수 선택'}
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
                      <span className="eyebrow">선택한 항목</span>
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
                          <span>이 항목을 0점으로 사용하고 되돌릴 수 없음을 확인했습니다.</span>
                        </label>
                      )}
                    </div>
                    <button
                      data-testid="confirm-score"
                      className="button primary"
                      disabled={!canScore || (room.previews[selected] === 0 && !zeroConsent)}
                      onClick={confirm}
                    >
                      {room.previews[selected] === 0 ? '0점으로 기록' : '이 점수로 기록'}{' '}
                      <Icon name="arrow" />
                    </button>
                  </>
                ) : (
                  <p>
                    <span>✎</span>
                    {myTurn ? '점수표에서 항목을 선택하세요.' : '상대가 점수를 선택하고 있습니다.'}
                  </p>
                )}
              </div>
            </>
          ) : (
            <section className="results" aria-label="최종 순위">
              <span className="eyebrow">경기 결과</span>
              <h2>
                {room.players.length === 1
                  ? `${own?.total ?? 0}점`
                  : room.results
                      .filter((r) => r.rank === 1 && !r.forfeited)
                      .map((r) => room.players.find((p) => p.id === r.playerId)?.nickname)
                      .join(', ') + ' 님이 1위입니다.'}
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
                  onClick={() => onIntent({ type: 'rematch' })}
                >
                  재경기 <Icon name="arrow" />
                </button>
              ) : (
                <p>방장이 재경기를 시작하면 대기실로 이동합니다.</p>
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
  );
}
