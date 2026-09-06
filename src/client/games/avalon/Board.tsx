import { useEffect, useRef, useState } from 'react';
import type { AvalonPublicState } from '../../../shared/avalon';
import { createAvalonScene } from './scene';
import type { createAvalonAudio } from './audio';

type SeatPosition = { playerId: string; seat: number; x: number; y: number };
export default function AvalonBoard({
  room,
  viewerId,
  selectedIds,
  focusedId,
  interactive,
  reducedMotion,
  online,
  audio,
  onSeatClick,
}: {
  room: AvalonPublicState;
  viewerId: string;
  selectedIds: string[];
  focusedId: string | null;
  interactive: boolean;
  reducedMotion: boolean;
  online: boolean;
  audio: ReturnType<typeof createAvalonAudio>;
  onSeatClick: (playerId: string) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createAvalonScene> | null>(null);
  const click = useRef(onSeatClick);
  const previous = useRef<{ gameId: string; eventKey: string; online: boolean } | null>(null);
  const [positions, setPositions] = useState<SeatPosition[]>([]);
  const [error, setError] = useState('');
  click.current = onSeatClick;
  useEffect(() => {
    if (!mount.current) return;
    try {
      scene.current = createAvalonScene(mount.current, {
        onSeatClick: (id) => click.current(id),
        onSeatPositions: setPositions,
        onError: setError,
        onSound: (event, intensity) => audio.play(event, intensity),
      });
    } catch {
      setError('3D 보드를 불러오지 못했습니다. 아래 좌석 목록과 조작으로 계속할 수 있습니다.');
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [audio]);
  useEffect(() => {
    const eventKey = `${room.latestEvent?.id ?? 'snapshot'}:${room.signals.at(-1)?.id ?? ''}`;
    const animate = !!(
      previous.current &&
      previous.current.gameId === room.gameId &&
      previous.current.eventKey !== eventKey &&
      previous.current.online &&
      online &&
      !document.hidden
    );
    scene.current?.update(room, {
      viewerId,
      selectedIds,
      focusedId,
      interactive,
      reducedMotion,
      animate,
      eventKey,
    });
    previous.current = { gameId: room.gameId, eventKey, online };
  }, [room, viewerId, selectedIds, focusedId, interactive, reducedMotion, online]);
  return (
    <div className="avalon-board" data-testid="avalon-board">
      <div className="canvas-mount" ref={mount} />
      <div className="avalon-seat-overlays" aria-label="원탁 좌석">
        {positions.map((position) => {
          const player = room.players.find((value) => value.id === position.playerId);
          if (!player) return null;
          const selected = selectedIds.includes(player.id);
          const team = room.proposal?.teamIds.includes(player.id);
          const submitted = room.proposal?.submittedIds.includes(player.id);
          return (
            <button
              key={player.id}
              data-testid={`av-board-seat-${player.seat}`}
              className={`avalon-board-name ${selected ? 'selected' : ''} ${focusedId === player.id ? 'focused' : ''}`}
              style={{
                left: `${position.x * 100}%`,
                top: `clamp(26px, ${position.y * 100}%, calc(100% - 26px))`,
              }}
              onClick={() => onSeatClick(player.id)}
              aria-label={`${player.seat + 1}번 ${player.nickname}${player.id === viewerId ? ' · 나' : ''}${room.leaderId === player.id ? ' · 대장' : ''}${team ? ' · 원정대원' : ''}${submitted ? ' · 제출 완료' : ''}`}
              aria-pressed={selected}
              title={player.nickname}
            >
              <span>
                <b>{player.seat + 1}</b> {player.nickname}
              </span>
              <small>
                {room.leaderId === player.id
                  ? '대장'
                  : player.id === viewerId
                    ? '나'
                    : team
                      ? '원정'
                      : '좌석'}
                {submitted ? ' · ✓' : !player.connected ? ' · 끊김' : ''}
              </small>
            </button>
          );
        })}
      </div>
      <span className="avalon-board-direction">좌석 번호 순서로 대장이 바뀝니다 ↻</span>
      {error && (
        <p className="scene-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
