import { useEffect, useState } from 'react';
import {
  AVALON_ROLE_DESCRIPTIONS,
  AVALON_ROLE_LABELS,
  type AvalonRoomState,
} from '../../../shared/avalon';

export default function PrivateInfo({
  room,
  playerId,
  onFocus,
}: {
  room: AvalonRoomState;
  playerId: string;
  onFocus: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const key = `atelier.avalon.notes.${room.roomId}.${room.gameId}.${playerId}`;
  const [note, setNote] = useState('');
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => {
    setOpen(false);
    try {
      setNote(localStorage.getItem(key) ?? '');
    } catch {
      setNote('');
    }
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try {
      localStorage.setItem(key, note);
    } catch {
      /* Personal notes remain usable in memory. */
    }
  }, [key, loadedKey, note]);
  const info = room.privateInfo?.playerId === playerId ? room.privateInfo : null;
  const name = (id: string) => room.players.find((player) => player.id === id);
  const people = (ids: string[]) => (
    <div className="avalon-private-people">
      {ids.map((id) => {
        const player = name(id);
        return player ? (
          <button key={id} className="avalon-person-link" onClick={() => onFocus(id)}>
            {player.seat + 1}번 {player.nickname}
          </button>
        ) : null;
      })}
    </div>
  );
  return (
    <section className="avalon-private avalon-panel" aria-label="내 비공개 정보">
      <div className="avalon-panel-heading">
        <div>
          <span className="avalon-kicker">나만 보는 정보</span>
          <h2>내 정보</h2>
        </div>
        <button
          className="button secondary small"
          data-testid="av-private-toggle"
          aria-expanded={open}
          aria-controls="avalon-private-content"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '닫기' : '내 역할 확인'}
        </button>
      </div>
      {!open ? (
        <p className="avalon-subtle">
          역할과 개인 메모를 보려면 직접 여세요. 열었는지는 다른 사람에게 알려지지 않습니다.
        </p>
      ) : (
        <div id="avalon-private-content" data-testid="av-private-content">
          {info ? (
            <>
              <div className={`avalon-role-card alignment-${info.alignment}`}>
                <span>{info.alignment === 'good' ? '선 진영' : '악 진영'}</span>
                <h3 data-testid="av-own-role">{AVALON_ROLE_LABELS[info.role]}</h3>
                <p>{AVALON_ROLE_DESCRIPTIONS[info.role]}</p>
              </div>
              {info.knownEvilIds.length > 0 && (
                <div className="avalon-private-section">
                  <h3>{info.role === 'merlin' ? '내가 아는 악의 인물' : '내가 아는 악의 동료'}</h3>
                  {people(info.knownEvilIds)}
                  <p>상대의 상세 역할명은 알 수 없습니다.</p>
                </div>
              )}
              {info.merlinCandidateIds.length > 0 && (
                <div className="avalon-private-section">
                  <h3>멀린 후보</h3>
                  {people(info.merlinCandidateIds)}
                  <p>
                    {info.merlinCandidateIds.length > 1
                      ? '멀린과 모르가나 중 누구인지 구별할 수 없습니다.'
                      : '적용 역할 구성에서 보이는 멀린 후보입니다.'}
                  </p>
                </div>
              )}
              {info.ladyInsights.length > 0 && (
                <div className="avalon-private-section">
                  <h3>내가 확인한 진영</h3>
                  <ul>
                    {info.ladyInsights.map((insight, index) => (
                      <li key={`${insight.targetId}-${index}`}>
                        <button
                          className="avalon-person-link"
                          onClick={() => onFocus(insight.targetId)}
                        >
                          {name(insight.targetId)?.nickname ?? '참가자'}
                        </button>{' '}
                        · {insight.alignment === 'good' ? '선' : '악'} · {insight.questNumber}번째
                        원정 뒤
                      </li>
                    ))}
                  </ul>
                  <p>호수의 여인으로 확인한 진영입니다. 역할명은 제공되지 않습니다.</p>
                </div>
              )}
            </>
          ) : (
            <p className="avalon-subtle">현재 내 역할 정보가 없습니다.</p>
          )}
          <label className="avalon-notes-label" htmlFor="avalon-notes">
            개인 메모 <span>이 브라우저에만 저장</span>
          </label>
          <textarea
            id="avalon-notes"
            data-testid="av-notes"
            value={note}
            maxLength={4000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="공개 기록과 자신의 추리를 적어 두세요."
            rows={5}
          />
          <p className="avalon-subtle">
            메모는 다른 참가자에게 전송하지 않습니다. 화면을 공유할 때에는 이 패널을 닫으세요.
          </p>
        </div>
      )}
    </section>
  );
}
