import { useEffect, useRef, useState } from 'react';
import type { AvalonPublicState, AvalonSignalKind } from '../../../shared/avalon';
import type { Intent } from '../../../shared/protocol';
import type { ClientView } from '../../network';

export const SIGNAL_LABELS: Record<AvalonSignalKind, string> = {
  question: '질문',
  speak: '발언 요청',
  trust: '신뢰',
  suspect: '의심',
  agree: '동의',
};
export default function Discussion({
  room,
  playerId,
  connected,
  queue,
  error,
  focusedId,
  onFocus,
  onIntent,
}: {
  room: AvalonPublicState;
  playerId: string;
  connected: boolean;
  queue: ClientView['queue'];
  error?: string | null;
  focusedId: string | null;
  onFocus: (id: string) => void;
  onIntent: (intent: Intent) => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<{
    text: string;
    raw: string;
    seenIds: Set<string>;
  } | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const [unread, setUnread] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const name = (id: string) => room.players.find((player) => player.id === id);
  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!sending) return;
    const delivered = room.chat.some(
      (message) =>
        message.playerId === playerId &&
        message.text === sending.text &&
        !sending.seenIds.has(message.id),
    );
    if (delivered) {
      setDraft((current) => (current === sending.raw ? '' : current));
      setSending(null);
    } else if (!queue.some((item) => item.intent.type === 'av_chat')) {
      // Queue completion ends the local submission lifetime, even when an error repeats
      // or the acknowledged message has already left the bounded public chat history.
      // Only a visible server message above authorizes clearing the user's draft.
      setSending(null);
    }
  }, [room.chat, playerId, sending, queue, error]);
  useEffect(() => {
    if (atBottom.current) {
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    } else setUnread(true);
  }, [room.chat.at(-1)?.id]);
  const submit = () => {
    const text = draft.trim().normalize('NFC');
    if (!connected || sending || !text || [...text].length > 300) return;
    setSending({
      text,
      raw: draft,
      seenIds: new Set(room.chat.map((message) => message.id)),
    });
    onIntent({ type: 'av_chat', text });
  };
  const signal = (kind: AvalonSignalKind) => {
    if (!connected || cooldown || !focusedId || !name(focusedId)) return;
    onIntent({ type: 'av_signal', targetId: focusedId, kind });
    setCooldown(true);
    cooldownTimer.current = setTimeout(() => setCooldown(false), 1600);
  };
  const recent = room.signals.slice(-5);
  return (
    <section className="avalon-discussion avalon-panel" aria-label="공개 토론">
      <div className="avalon-panel-heading">
        <div>
          <span className="avalon-kicker">모두에게 공개</span>
          <h2>토론</h2>
        </div>
        <span className="avalon-counter">{room.players.length}명</span>
      </div>
      <div
        className="avalon-chat-log"
        data-testid="av-chat-log"
        ref={scroll}
        tabIndex={0}
        role="log"
        aria-label="방 채팅"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={() => {
          const element = scroll.current;
          if (!element) return;
          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
          if (atBottom.current) setUnread(false);
        }}
      >
        {room.chat.length === 0 ? (
          <p className="avalon-chat-empty">원정대 구성과 투표 이유를 이야기해 보세요.</p>
        ) : (
          room.chat.map((message) => (
            <article
              className={`avalon-chat-message ${message.playerId === playerId ? 'mine' : ''}`}
              key={message.id}
              data-testid="av-chat-message"
            >
              <header>
                <button className="avalon-person-link" onClick={() => onFocus(message.playerId)}>
                  {name(message.playerId)?.seat !== undefined
                    ? `${name(message.playerId)!.seat + 1}번 `
                    : ''}
                  {name(message.playerId)?.nickname ?? '참가자'}
                </button>
                <time dateTime={new Date(message.at).toISOString()}>
                  {new Date(message.at).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </header>
              <p>{message.text}</p>
            </article>
          ))
        )}
      </div>
      {unread && (
        <button
          className="avalon-unread"
          onClick={() => {
            atBottom.current = true;
            if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
            setUnread(false);
          }}
        >
          새 메시지 보기 ↓
        </button>
      )}
      <form
        className="avalon-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="avalon-chat-input">
          공개 채팅
        </label>
        <textarea
          id="avalon-chat-input"
          data-testid="av-chat-input"
          rows={2}
          value={draft}
          maxLength={600}
          placeholder="방 전체에 보낼 메시지"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div>
          <span className={[...draft.trim().normalize('NFC')].length > 300 ? 'avalon-invalid' : ''}>
            {[...draft.trim().normalize('NFC')].length}/300 · Enter 전송
          </span>
          <button
            className="button primary small"
            data-testid="av-chat-send"
            disabled={
              !connected ||
              !!sending ||
              !draft.trim() ||
              [...draft.trim().normalize('NFC')].length > 300
            }
          >
            {sending ? '전송 중' : '보내기'}
          </button>
        </div>
      </form>
      <div className="avalon-signals">
        <label htmlFor="avalon-signal-target">
          좌석 지목 <small>의견 표현</small>
        </label>
        <select
          id="avalon-signal-target"
          data-testid="av-signal-target"
          value={focusedId ?? ''}
          onChange={(event) => onFocus(event.target.value)}
        >
          <option value="">대상을 선택하세요</option>
          {room.players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.seat + 1}번 {player.nickname}
            </option>
          ))}
        </select>
        <div className="avalon-signal-actions">
          {(Object.keys(SIGNAL_LABELS) as AvalonSignalKind[]).map((kind) => (
            <button
              key={kind}
              data-testid={`av-signal-${kind}`}
              disabled={!connected || !focusedId || cooldown}
              onClick={() => signal(kind)}
            >
              {SIGNAL_LABELS[kind]}
            </button>
          ))}
        </div>
        <p className="avalon-subtle">신뢰·의심은 참가자의 의견이며 확인된 진영이 아닙니다.</p>
        {recent.length > 0 && (
          <ul className="avalon-signal-log">
            {recent.map((item) => (
              <li key={item.id}>
                <button className="avalon-person-link" onClick={() => onFocus(item.playerId)}>
                  {name(item.playerId)?.nickname ?? '참가자'}
                </button>{' '}
                →{' '}
                <button className="avalon-person-link" onClick={() => onFocus(item.targetId)}>
                  {name(item.targetId)?.nickname ?? '참가자'}
                </button>
                <span>{SIGNAL_LABELS[item.kind]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
