import { useEffect, useRef, useState } from 'react';
import type { Dice, YachtRoomState } from '../../../shared/protocol';
import { createDiceScene } from '../../scene';
import type { AtelierAudio } from '../../audio';

const DECORATIVE: Dice[] = [3, 5, 1, 6, 4].map((value, id) => ({ id, value, held: false }));
export default function YachtBoard({
  audio,
  dice = DECORATIVE,
  room,
  interactive = false,
  pending = false,
  reducedMotion,
  onDieClick,
  onAnimationChange,
  online = true,
}: {
  audio?: AtelierAudio;
  dice?: Dice[];
  room?: YachtRoomState;
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
        onImpact: (intensity) => audio?.play('impact', intensity),
        onCollision: (intensity) => audio?.play('collision', intensity),
      });
    } catch {
      setError('주사위 화면을 불러오지 못했습니다. 아래 버튼으로 플레이할 수 있습니다.');
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
        야추
      </div>
    </div>
  );
}
