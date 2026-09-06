import { useEffect, useRef, useState } from 'react';
import type { TikatukaLane, TikatukaPreview, TikatukaRoomState } from '../../../shared/tikatuka';
import { createTikatukaScene } from './scene';
import type { createTikatukaAudio } from './audio';

export type BoardTarget = { ownerId: string; lane: TikatukaLane };
export default function TikatukaBoard({
  room = null,
  viewerId,
  interactive = false,
  selectedTarget = null,
  preview = null,
  reducedMotion,
  online = true,
  audio,
  onTargetClick = () => {},
  onAnimationChange = () => {},
}: {
  room?: TikatukaRoomState | null;
  viewerId?: string;
  interactive?: boolean;
  selectedTarget?: BoardTarget | null;
  preview?: TikatukaPreview | null;
  reducedMotion: boolean;
  online?: boolean;
  audio?: ReturnType<typeof createTikatukaAudio>;
  onTargetClick?: (target: BoardTarget) => void;
  onAnimationChange?: (active: boolean) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createTikatukaScene> | null>(null);
  const click = useRef(onTargetClick);
  const animation = useRef(onAnimationChange);
  const previous = useRef<{ gameId: string; eventKey: string; online: boolean } | null>(null);
  const [error, setError] = useState('');
  click.current = onTargetClick;
  animation.current = onAnimationChange;
  useEffect(() => {
    if (!mount.current) return;
    try {
      scene.current = createTikatukaScene(mount.current, {
        onTargetClick: (target) => click.current(target),
        onError: setError,
        onAnimationChange: (active) => animation.current(active),
        onSound: (event, intensity) => audio?.play(event, intensity),
      });
    } catch {
      setError('보드를 불러오지 못했습니다. 아래의 줄 선택 버튼으로 플레이할 수 있습니다.');
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    const eventKey = room?.latestEvent?.id ?? 'preview';
    const animate = !!(
      room &&
      previous.current &&
      previous.current.gameId === room.gameId &&
      previous.current.eventKey !== eventKey &&
      previous.current.online &&
      online &&
      !document.hidden
    );
    scene.current?.update(room, {
      viewerId,
      interactive,
      selectedTarget,
      preview,
      reducedMotion,
      animate,
      eventKey,
      demo: !room,
    });
    previous.current = room ? { gameId: room.gameId, eventKey, online } : null;
  }, [room, viewerId, interactive, selectedTarget, preview, reducedMotion, online]);
  return (
    <div className="tikatuka-board-viewport">
      <div className="canvas-mount" ref={mount} />
      {error && (
        <p className="scene-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
