import { useEffect, useState } from 'react';
import {
  getTikatukaTargets,
  previewTikatukaMove,
  TIKATUKA_LANES,
  type TikatukaDie,
  type TikatukaLane,
  type TikatukaPlayer,
  type TikatukaRoomState,
  type TikatukaTarget,
} from '../../../shared/tikatuka';
import { DieIcon, Icon, Modal } from '../../components';
import type { GameScreenProps } from '../types';
import TikatukaBoard, { type BoardTarget } from './Board';
import { createTikatukaAudio } from './audio';

function Die({ die }: { die: TikatukaDie }) {
  return (
    <span
      className={`tika-die ${die.kind}`}
      aria-label={`${die.kind === 'shield' ? '실드' : '일반'} 주사위 ${die.value}`}
    >
      <DieIcon value={die.value} />
      {die.kind === 'shield' && (
        <span className="tika-shield-mark" aria-hidden="true">
          ◆
        </span>
      )}
    </span>
  );
}
function PlayerSummary({
  player,
  me,
  acting,
  preview,
}: {
  player: TikatukaPlayer;
  me: boolean;
  acting: boolean;
  preview?: { laneWins: number; total: number };
}) {
  return (
    <div
      className={`tika-player ${me ? 'mine' : 'opponent'} ${acting ? 'acting' : ''} ${player.forfeited ? 'forfeited' : ''}`}
    >
      <span className={`player-avatar seat-${player.seat}`}>
        {player.kind === 'computer' ? <Icon name="settings" /> : player.seat + 1}
      </span>
      <div className="tika-player-name">
        <strong>
          {player.nickname}
          {me && <small>나</small>}
        </strong>
        <span>
          {player.forfeited
            ? '기권'
            : player.held
              ? '홀드'
              : !player.connected
                ? '재접속 대기'
                : player.kind === 'computer' && acting
                  ? '컴퓨터가 선택하고 있습니다'
                  : acting
                    ? '진행 중'
                    : '대기'}
        </span>
      </div>
      <div className="tika-player-score">
        <strong>
          {player.laneWins}
          <small>줄 우세</small>
        </strong>
        <span>
          {player.total}점
          {preview && preview.total !== player.total && <em> → {preview.total}점</em>}
        </span>
      </div>
    </div>
  );
}
export default function TikatukaGame({
  room,
  session,
  connection,
  queue,
  settings,
  error,
  onIntent,
}: GameScreenProps<TikatukaRoomState>) {
  const [audio] = useState(createTikatukaAudio);
  const [selected, setSelected] = useState<BoardTarget | null>(null);
  const [animating, setAnimating] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [confirmHold, setConfirmHold] = useState(false);
  useEffect(() => {
    const unlock = () => {
      void audio.unlock();
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      audio.dispose();
    };
  }, [audio]);
  useEffect(() => audio.setSettings({ ...settings, music: 0 }), [audio, settings]);
  useEffect(() => {
    setNow(Date.now());
    if (room.inputAfter <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= room.inputAfter) clearInterval(timer);
    }, 70);
    return () => clearInterval(timer);
  }, [room.inputAfter]);
  useEffect(() => {
    setSelected(null);
    setConfirmHold(false);
  }, [room.gameId, room.turnId, room.version, error]);
  const own = room.players.find((player) => player.id === session.playerId)!;
  const other = room.players.find((player) => player.id !== session.playerId)!;
  const actingId = room.stage === 'responding' ? room.declaration?.responderId : room.turnPlayerId;
  const myTurn = room.phase === 'playing' && actingId === session.playerId && !own.forfeited;
  const connected = connection === 'online';
  const pending = queue.length > 0;
  const ready = connected && !pending && !animating && now >= room.inputAfter;
  const active = myTurn && ready;
  const targets = getTikatukaTargets(room, session.playerId);
  const selectedTarget = selected
    ? targets.find((target) => target.ownerId === selected.ownerId && target.lane === selected.lane)
    : null;
  const preview = selectedTarget
    ? previewTikatukaMove(room, selectedTarget.ownerId, selectedTarget.lane)
    : null;
  const canPlace = active && room.stage === 'placing';
  const canHold = active && !own.held && room.stage === 'placing';
  const choose = (target: BoardTarget) => {
    if (
      !canPlace ||
      !targets.some((value) => value.ownerId === target.ownerId && value.lane === target.lane)
    )
      return;
    setSelected(target);
    audio.play('select');
  };
  const confirm = () => {
    if (!canPlace || !selectedTarget) return;
    onIntent({ type: 'tika_place', ownerId: selectedTarget.ownerId, lane: selectedTarget.lane });
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        document.querySelector('dialog[open]')
      )
        return;
      if (
        !(event.target instanceof HTMLElement) ||
        event.target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (/^[1-6]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const target = {
          ownerId: index < 3 ? own.id : other.id,
          lane: (index % 3) as TikatukaLane,
        };
        if (canPlace) {
          event.preventDefault();
          choose(target);
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  const status =
    room.phase === 'finished'
      ? '경기가 종료되었습니다.'
      : pending
        ? '선택을 전송하고 있습니다.'
        : !connected
          ? '연결이 복구되면 계속할 수 있습니다.'
          : animating || now < room.inputAfter
            ? '주사위가 멈출 때까지 기다려 주세요.'
            : room.stage === 'responding'
              ? myTurn
                ? '상대의 티카투카 선언에 응답하세요.'
                : '선언에 대한 응답을 기다리고 있습니다.'
              : !myTurn
                ? `${room.players.find((player) => player.id === actingId)?.nickname ?? '상대'} 차례입니다.`
                : room.stage === 'choosingReroll'
                  ? '원래 주사위와 새 후보 중 하나를 고르세요.'
                  : room.stage === 'placing'
                    ? '표시된 줄을 선택하고 예상 점수를 확인하세요.'
                    : '차례가 시작되면 주사위가 자동으로 굴러갑니다.';
  const targetFor = (ownerId: string, lane: TikatukaLane): TikatukaTarget | undefined =>
    targets.find((target) => target.ownerId === ownerId && target.lane === lane);
  const unavailableReason = (player: TikatukaPlayer, lane: TikatukaLane): string => {
    if (room.phase === 'finished') return '경기 종료';
    if (own.held) return '홀드 완료';
    if (!myTurn) return '상대 차례';
    if (room.stage === 'choosingReroll') return '주사위 후보 선택 필요';
    if (room.stage !== 'placing') return '현재 선택할 수 없음';
    if (player.id === own.id && player.lanes[lane].length === 3) return '빈칸 없음';
    if (room.pendingDie.kind === 'shield') {
      if (player.id !== own.id && room.pendingDie.source !== 'bonus') return '첫 실드는 내 줄만';
      if (player.lanes[lane].length === 3) return '빈칸 없음';
    } else {
      if (own.lanes[lane].length === 3) return '내 대응 줄이 가득 참';
      if (
        player.id === own.id &&
        targets.some((target) => target.ownerId === other.id && target.lane === lane)
      )
        return '대응 줄은 상대 공격만';
      if (player.id !== own.id) return '같은 눈의 일반 주사위 없음';
    }
    return '선택할 수 없음';
  };
  return (
    <div className="tikatuka-game" data-testid="tika-game" data-stage={room.stage}>
      <div className="tika-players">
        {[own, other].map((player) => (
          <PlayerSummary
            key={player.id}
            player={player}
            me={player.id === session.playerId}
            acting={room.phase === 'playing' && actingId === player.id}
            preview={preview?.players.find((value) => value.playerId === player.id)}
          />
        ))}
      </div>
      <div className="tika-layout">
        <section className="tika-table">
          <div className="tika-table-heading">
            <span>티카투카</span>
            <span>{room.phase === 'finished' ? '최종 보드' : `${room.turnNumber}번째 차례`}</span>
          </div>
          <TikatukaBoard
            room={room}
            viewerId={session.playerId}
            interactive={canPlace}
            selectedTarget={selected}
            preview={preview}
            reducedMotion={settings.reducedMotion}
            online={connected}
            audio={audio}
            onTargetClick={choose}
            onAnimationChange={setAnimating}
          />
          <p className="tika-status" role="status">
            {status}
          </p>
          <div className="tika-board-legend">
            <span className="tika-layout-note">내 보드 아래 · 상대 보드 위 · 1번 줄은 왼쪽</span>
            <span>
              <i className="normal" />
              일반 주사위
            </span>
            <span>
              <i className="shield" />
              실드 · 공격으로 제거되지 않음
            </span>
            <span>밝은 테두리 · 선택 가능</span>
          </div>
        </section>
        <section className="tika-panel" aria-label="티카투카 조작">
          {room.phase === 'finished' ? (
            <div className="tika-results">
              <span className="eyebrow">경기 결과</span>
              <h2>
                {room.results.filter((result) => result.rank === 1).length > 1
                  ? '무승부'
                  : room.players.find(
                      (player) =>
                        player.id === room.results.find((result) => result.rank === 1)?.playerId,
                    )?.nickname + ' 승리'}
              </h2>
              <p>
                {room.finishReason === 'forfeit'
                  ? '기권으로 경기가 종료되었습니다.'
                  : room.finishReason === 'declaration'
                    ? '티카투카 선언으로 경기가 종료되었습니다.'
                    : '이긴 줄 수와 총점으로 결과를 정했습니다.'}
              </p>
              {room.results.map((result) => {
                const player = room.players.find((value) => value.id === result.playerId)!;
                return (
                  <div className="tika-result-row" key={result.playerId}>
                    <span>
                      {result.rank}위 <strong>{player.nickname}</strong>
                      {result.forfeited && <small>기권</small>}
                    </span>
                    <b>
                      {player.laneWins}줄 · {result.total}점
                    </b>
                  </div>
                );
              })}
              {room.hostId === session.playerId ? (
                <button
                  className="button primary"
                  data-testid="rematch"
                  disabled={!connected || pending}
                  onClick={() => onIntent({ type: 'rematch' })}
                >
                  재경기 <Icon name="arrow" />
                </button>
              ) : (
                <p>방장이 재경기를 시작하면 대기실로 이동합니다.</p>
              )}
            </div>
          ) : (
            <>
              <div className="tika-pending">
                <div>
                  <span className="eyebrow">
                    {room.stage === 'choosingReroll'
                      ? '타짜의 손놀림'
                      : room.pendingDie?.source === 'bonus' || room.nextRoll === 'bonus'
                        ? '보너스 주사위'
                        : '현재 주사위'}
                  </span>
                  <h2>
                    {room.stage === 'choosingReroll'
                      ? '주사위를 선택하세요'
                      : room.pendingDie
                        ? `${room.pendingDie.kind === 'shield' ? '실드' : '일반'} 주사위`
                        : '다음 주사위'}
                  </h2>
                </div>
                {room.pendingDie && <Die die={room.pendingDie} />}
              </div>
              {room.stage === 'choosingReroll' ? (
                <div className="tika-candidates">
                  {(['original', 'rerolled'] as const).map((choice) => (
                    <button
                      key={choice}
                      data-testid={`tika-choose-${choice}`}
                      disabled={!active}
                      onClick={() => onIntent({ type: 'tika_choose', choice })}
                    >
                      <span>{choice === 'original' ? '원래 주사위' : '새 후보'}</span>
                      <Die die={room.rerollChoices![choice]} />
                      <strong>{room.rerollChoices![choice].value}</strong>
                    </button>
                  ))}
                </div>
              ) : room.stage === 'responding' ? (
                <div className="tika-response">
                  <p>
                    {myTurn
                      ? '상대가 티카투카를 선언했습니다.'
                      : '상대의 응답을 기다리고 있습니다.'}
                  </p>
                  <button
                    className="button primary"
                    data-testid="tika-respond-accept"
                    disabled={!active}
                    onClick={() => onIntent({ type: 'tika_respond', accept: true })}
                  >
                    수락
                  </button>
                  <button
                    className="button secondary"
                    data-testid="tika-respond-decline"
                    disabled={!active}
                    onClick={() => onIntent({ type: 'tika_respond', accept: false })}
                  >
                    거절
                  </button>
                </div>
              ) : (
                <p className="tika-auto-roll">주사위는 차례가 시작될 때 자동으로 굴러갑니다.</p>
              )}
              <div className="tika-tools">
                <button
                  className="button secondary"
                  data-testid="tika-reroll"
                  disabled={!canPlace || own.rerollUsed}
                  onClick={() => onIntent({ type: 'tika_reroll' })}
                >
                  타짜의 손놀림 <span>{own.rerollUsed ? '사용 완료' : '1회'}</span>
                </button>
                <button
                  className="button secondary"
                  data-testid="tika-hold"
                  disabled={!canHold}
                  onClick={() => setConfirmHold(true)}
                >
                  {own.held ? '홀드 완료' : '홀드'}
                </button>
              </div>
              <div className={`tika-selection ${selectedTarget ? 'selected' : ''}`}>
                <span className="eyebrow">선택 확인</span>
                {selectedTarget && preview ? (
                  <>
                    <h3>
                      {selectedTarget.ownerId === own.id ? '내' : '상대'} {selectedTarget.lane + 1}
                      번 줄 · {selectedTarget.action === 'attack' ? '공격' : '배치'}
                    </h3>
                    <p>
                      {selectedTarget.action === 'attack'
                        ? `같은 눈의 일반 주사위 ${preview.removedIds.length}개 제거 · 사용한 주사위도 소모 · 보너스 실드 주사위 획득`
                        : `${room.pendingDie?.value} 주사위를 선택한 줄에 배치합니다.`}
                    </p>
                    <div className="tika-preview-scores">
                      {[own, other].map((player) => {
                        const projected = preview.players.find(
                          (value) => value.playerId === player.id,
                        )!;
                        return (
                          <div key={player.id}>
                            <span>{player.id === own.id ? '내 점수' : '상대 점수'}</span>
                            <strong>
                              {player.laneScores[selectedTarget.lane]} →{' '}
                              {projected.laneScores[selectedTarget.lane]}
                              <small>줄 점수</small>
                            </strong>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p>
                    {room.stage === 'placing' && myTurn
                      ? '보드 또는 아래 줄 선택 버튼을 누르세요.'
                      : '내 차례에 줄을 선택할 수 있습니다.'}
                  </p>
                )}
                <button
                  className="button primary"
                  data-testid="tika-confirm"
                  disabled={!canPlace || !selectedTarget}
                  onClick={confirm}
                >
                  {selectedTarget?.action === 'attack' ? '공격 확정' : '배치 확정'}
                  <Icon name="arrow" />
                </button>
              </div>
            </>
          )}
        </section>
      </div>
      <section className="tika-scoreboard" aria-label="줄 점수와 선택">
        <div className="tika-scoreboard-heading">
          <h2>줄 점수</h2>
          <p>더 많은 줄에서 이기면 승리 · 줄 수가 같으면 총점 비교</p>
        </div>
        <div className="tika-lane-grid">
          {TIKATUKA_LANES.map((lane) => (
            <div className="tika-lane-pair" key={lane}>
              <span className="tika-lane-number">
                {lane + 1}번 줄{' '}
                <strong>
                  {own.laneScores[lane] === other.laneScores[lane]
                    ? '동점'
                    : own.laneScores[lane] > other.laneScores[lane]
                      ? '나 우세'
                      : '상대 우세'}
                </strong>
              </span>
              {[own, other].map((player) => {
                const target = targetFor(player.id, lane);
                const chosen =
                  selectedTarget?.ownerId === player.id && selectedTarget.lane === lane;
                const projected = preview?.players.find((value) => value.playerId === player.id)
                  ?.laneScores[lane];
                return (
                  <button
                    key={player.id}
                    className={`tika-lane ${player.id === own.id ? 'mine' : 'opponent'} ${target ? 'legal' : ''} ${chosen ? 'selected' : ''}`}
                    data-testid={`tika-target-${player.seat}-${lane}`}
                    disabled={!canPlace || !target}
                    aria-pressed={chosen}
                    aria-describedby={`tika-reason-${player.seat}-${lane}`}
                    aria-label={`${player.id === own.id ? '내' : '상대'} ${lane + 1}번 줄 ${player.laneScores[lane]}점${target ? (target.action === 'attack' ? ' 공격 가능' : ' 배치 가능') : ''}`}
                    onClick={() => choose({ ownerId: player.id, lane })}
                  >
                    <span className="tika-lane-owner">
                      <span>{player.id === own.id ? '나' : player.nickname}</span>
                      <small>빈칸 {3 - player.lanes[lane].length}</small>
                    </span>
                    <span className="tika-lane-dice">
                      {[0, 1, 2].map((index) =>
                        player.lanes[lane][index] ? (
                          <Die key={index} die={player.lanes[lane][index]!} />
                        ) : (
                          <i key={index} />
                        ),
                      )}
                    </span>
                    <strong>
                      {player.laneScores[lane]}
                      {projected !== undefined && projected !== player.laneScores[lane] && (
                        <em> → {projected}</em>
                      )}
                      <small>점</small>
                    </strong>
                    <span className="tika-lane-action" id={`tika-reason-${player.seat}-${lane}`}>
                      {target
                        ? target.action === 'attack'
                          ? '공격 선택'
                          : '배치 선택'
                        : unavailableReason(player, lane)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="tika-shortcuts">키보드: 1–3 내 줄 · 4–6 상대 줄</p>
      </section>
      {confirmHold && (
        <Modal title="홀드할까요?" onClose={() => setConfirmHold(false)}>
          <p className="help-text">
            홀드하면 이번 경기에서 더 이상 주사위를 굴리거나 배치하지 않습니다. 현재 주사위는
            사용하지 않으며 홀드는 취소할 수 없습니다.
          </p>
          <div className="modal-buttons">
            <button className="button secondary" onClick={() => setConfirmHold(false)}>
              취소
            </button>
            <button
              className="button primary"
              data-testid="tika-hold-confirm"
              disabled={!canHold}
              onClick={() => {
                onIntent({ type: 'tika_hold' });
                setConfirmHold(false);
              }}
            >
              홀드 확정
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
