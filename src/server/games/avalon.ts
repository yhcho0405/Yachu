import {
  applyIntent as applyGameIntent,
  type AvalonInternalState,
  type AvalonIntent,
} from '../../shared/avalon';
import { GameError, type EngineClock } from '../errors';

export { createState, start, reset, abort, projectAvalon } from '../../shared/avalon';

/** Discussion changes only public records; private choices stay in the game engine. */
export function applyIntent(
  state: AvalonInternalState,
  playerId: string,
  intent: AvalonIntent,
  clock: EngineClock,
): void {
  if (intent.type === 'av_chat') {
    const text = intent.text.normalize('NFC').trim();
    if (
      state.chat.some(
        (message) =>
          message.playerId === playerId && message.text === text && clock.now - message.at < 5000,
      )
    )
      throw new GameError(
        'DUPLICATE_CHAT',
        '같은 글을 연속해서 보낼 수 없습니다. 잠시 후 다시 보내 주세요.',
        429,
      );
    state.chat.push({ id: clock.uuid(), playerId, text, at: clock.now });
    state.chat = state.chat.slice(-100);
    return;
  }
  if (intent.type === 'av_signal') {
    if (!state.players.some((player) => player.id === intent.targetId))
      throw new GameError('INVALID_TARGET', '현재 방의 참가자를 선택해 주세요.', 400);
    state.signals.push({
      id: clock.uuid(),
      playerId,
      targetId: intent.targetId,
      kind: intent.kind,
      at: clock.now,
    });
    state.signals = state.signals.slice(-30);
    return;
  }
  applyGameIntent(state, playerId, intent, clock);
}
