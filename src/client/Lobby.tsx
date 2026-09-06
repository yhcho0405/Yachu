import { lazy, Suspense } from 'react';
import { gameMetadata, type GameType } from '../shared/games';
import { getAvalonStartIssues } from '../shared/avalon';
import type { RoomState, Session, Intent } from '../shared/protocol';
import { GamePreview } from './catalog';
import { Icon } from './components';
const AvalonLobbyOptions = lazy(() => import('./AvalonLobbyOptions'));
export function ConnectionPolicy({ gameType = 'yacht' }: { gameType?: GameType }) {
  if (gameType === 'avalon')
    return (
      <>
        <h3>아발론 재접속과 경기 중단</h3>
        <p className="help-text">
          역할과 좌석은 경기 내내 고정됩니다. 연결이 끊기면 경기당 누적 2분 동안 재접속할 수 있고,
          같은 역할과 제출 상태로 돌아옵니다.
        </p>
        <p className="help-text">
          유예 시간이 끝나거나 참가자가 명시적으로 퇴장하면 전체 경기를 무효 종료합니다. 특정 진영의
          승리로 판정하거나 전체 역할을 공개하지 않습니다. 게임 목록을 둘러보는 동안에는 현재 방에
          계속 연결됩니다.
        </p>
      </>
    );
  return (
    <>
      <h3>온라인 참가 안내</h3>
      <p className="help-text">
        턴 시간 제한은 없습니다. 연결이 끊기면 경기당 누적 2분 동안 재접속을 기다리며, 시간이 지나면
        기권 처리됩니다. 재접속해도 이미 사용한 대기 시간은 복구되지 않습니다.
      </p>
      <p className="help-text">
        명시적으로 방을 나가면 즉시 기권합니다. 로비에서는 연결이 끊긴 자리를 2분 뒤 정리하고,
        방장이 나가면 다음 참가자에게 방장을 넘깁니다. 게임 목록을 둘러보는 동안에는 현재 방에 계속
        연결됩니다.
      </p>
    </>
  );
}
export default function Lobby({
  room,
  session,
  connected,
  pending,
  onIntent,
  onHelp,
}: {
  room: RoomState;
  session: Session;
  connected: boolean;
  pending: boolean;
  onIntent: (intent: Intent) => void;
  onHelp: () => void;
}) {
  const game = gameMetadata(room.gameType);
  const own = room.players.find((player) => player.id === session.playerId);
  const host = room.hostId === session.playerId;
  const configIssues =
    room.gameType === 'avalon' ? getAvalonStartIssues(room.players.length, room.config) : [];
  const readyToStart =
    room.players.length >= game.minPlayers &&
    configIssues.length === 0 &&
    room.players.every((player) => player.connected && (player.id === room.hostId || player.ready));
  return (
    <div className={`lobby-layout game-${room.gameType}`}>
      <section className="lobby-panel">
        <div className="lobby-intro">
          <span className="section-number">{game.name} · 대기실</span>
          <h2>참가자를 기다리고 있습니다.</h2>
          <p>
            초대 링크나 방 코드를 공유하세요.
            <br />
            {game.minPlayers === game.maxPlayers
              ? `${game.maxPlayers}명이 준비하면 시작할 수 있습니다.`
              : `${game.minPlayers === 1 ? 1 : game.minPlayers}~${game.maxPlayers}명이 플레이할 수 있습니다.`}
          </p>
        </div>
        <div className="lobby-seats">
          {Array.from({ length: game.maxPlayers }, (_, seat) => {
            const player = room.players.find((value) => value.seat === seat);
            return player ? (
              <div key={seat} className="lobby-seat occupied">
                <span className={`player-avatar seat-${seat}`}>{seat + 1}</span>
                <div>
                  <strong>
                    {player.nickname} {player.id === session.playerId && <small>나</small>}
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
                  {player.ready ? '✓ 준비 완료' : player.connected ? '준비 중' : '연결 대기'}
                </span>
              </div>
            ) : (
              <div key={seat} className="lobby-seat empty">
                <span className="empty-avatar">+</span>
                <div>
                  <strong>빈 자리</strong>
                  <span>참가 대기</span>
                </div>
              </div>
            );
          })}
        </div>
        {room.gameType === 'avalon' && (
          <Suspense fallback={<p>역할 설정 불러오는 중…</p>}>
            <AvalonLobbyOptions
              room={room}
              canEdit={host && connected && !pending}
              onIntent={onIntent}
            />
          </Suspense>
        )}
        <div className="lobby-controls">
          <button
            data-testid="ready-button"
            className={`button ${own?.ready ? 'secondary' : 'primary'}`}
            disabled={!connected || pending}
            onClick={() => onIntent({ type: 'ready', ready: !own?.ready })}
          >
            {own?.ready ? '준비 취소' : '준비 완료'}
          </button>
          {host && (
            <button
              data-testid="start-game"
              className="button primary"
              disabled={!connected || pending || !readyToStart}
              onClick={() => onIntent({ type: 'start' })}
            >
              게임 시작 <Icon name="arrow" />
            </button>
          )}
        </div>
        <p className="lobby-wait">
          {room.players.length < game.minPlayers
            ? `시작하려면 ${game.minPlayers - room.players.length}명이 더 필요합니다.`
            : configIssues.length
              ? configIssues[0]
              : host
                ? '참가자가 모두 준비하면 게임을 시작하세요.'
                : '준비를 마치면 방장이 게임을 시작합니다.'}
        </p>
        <div className="policy-note">
          <strong>{room.gameType === 'avalon' ? '재접속과 경기 중단' : '재접속과 기권'}</strong>
          <p>
            {room.gameType === 'avalon'
              ? '연결이 끊기면 경기당 누적 2분 동안 기다립니다. 시간이 지나거나 참가자가 방을 나가면 전체 경기를 무효 종료하며 역할을 공개하지 않습니다.'
              : '연결이 끊기면 경기당 누적 2분 동안 기다립니다. 시간이 지나거나 방을 나가면 기권 처리됩니다.'}{' '}
            <button onClick={onHelp}>자세히 보기</button>
          </p>
        </div>
      </section>
      <section className="lobby-table">
        <GamePreview gameType={room.gameType} />
        <div className="lobby-code-card">
          <span>방 코드</span>
          <strong>{room.code}</strong>
          <p>초대받은 사람은 게임을 따로 선택하지 않아도 참가할 수 있습니다.</p>
        </div>
      </section>
    </div>
  );
}
