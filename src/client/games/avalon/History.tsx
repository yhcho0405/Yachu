import { useState } from 'react';
import type { AvalonPublicState } from '../../../shared/avalon';

export default function History({
  room,
  onFocus,
}: {
  room: AvalonPublicState;
  onFocus: (id: string) => void;
}) {
  const [tab, setTab] = useState<'votes' | 'quests' | 'events'>('votes');
  const player = (id: string) => room.players.find((value) => value.id === id);
  const person = (id: string) => (
    <button className="avalon-person-link" onClick={() => onFocus(id)}>
      {player(id)?.seat !== undefined ? `${player(id)!.seat + 1}번 ` : ''}
      {player(id)?.nickname ?? '참가자'}
    </button>
  );
  const eventText = (event: AvalonPublicState['history']['events'][number]) => {
    const actor = event.actorId ? (player(event.actorId)?.nickname ?? '참가자') : '';
    const target = event.targetId ? (player(event.targetId)?.nickname ?? '참가자') : '';
    switch (event.type) {
      case 'start':
        return '역할 배정 완료 · 첫 원정대 구성';
      case 'team_proposed':
        return `${actor} 대장의 원정대가 확정되어 전원 투표를 시작했습니다.`;
      case 'vote_revealed':
        return '전원의 찬반 투표가 동시에 공개되었습니다.';
      case 'quest_resolved':
        return `${event.questNumber}번째 원정의 익명 카드 결과가 공개되었습니다.`;
      case 'lady_used':
        return `${actor} → ${target} 조사 · 호수의 여인 전달`;
      case 'assassination':
        return '암살 선택과 최종 판정이 확정되었습니다.';
      case 'aborted':
        return '경기를 무효 종료했습니다. 비공개 역할은 공개하지 않습니다.';
      case 'config':
        return '대기실의 역할 구성이 변경되었습니다.';
      default:
        return null;
    }
  };
  return (
    <section className="avalon-history avalon-panel" aria-label="공개 기록">
      <div className="avalon-panel-heading">
        <div>
          <span className="avalon-kicker">확정된 공개 정보</span>
          <h2>경기 기록</h2>
        </div>
      </div>
      <div className="avalon-tabs" role="tablist" aria-label="기록 종류">
        {(
          [
            ['votes', '투표 비교'],
            ['quests', '원정 결과'],
            ['events', '진행 기록'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'votes' && (
        <div
          role="tabpanel"
          aria-label="개인별 공개 찬반"
          className="avalon-table-scroll"
          tabIndex={0}
        >
          {room.history.proposals.length === 0 ? (
            <p className="avalon-empty">전원이 투표를 제출하면 개인별 찬반이 함께 공개됩니다.</p>
          ) : (
            <table className="avalon-vote-table" data-testid="av-vote-table">
              <caption>제안별 개인 찬반 · 대장과 원정대는 표 아래에서 확인할 수 있습니다.</caption>
              <thead>
                <tr>
                  <th>참가자</th>
                  {room.history.proposals.map((proposal) => (
                    <th key={proposal.id}>
                      {proposal.questNumber}원정
                      <br />
                      <span>{proposal.attempt}차 제안</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {room.players.map((participant) => (
                  <tr key={participant.id}>
                    <th>{person(participant.id)}</th>
                    {room.history.proposals.map((proposal) => {
                      const vote = proposal.votes.find(
                        (value) => value.playerId === participant.id,
                      );
                      return (
                        <td key={proposal.id} className={vote?.approve ? 'approve' : 'reject'}>
                          {vote ? (vote.approve ? '✓ 찬성' : '× 반대') : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="avalon-vote-total">
                  <th>집계</th>
                  {room.history.proposals.map((proposal) => (
                    <td key={proposal.id}>
                      {proposal.votes.filter((value) => value.approve).length} :{' '}
                      {proposal.votes.filter((value) => !value.approve).length}
                      <strong>{proposal.approved ? '가결' : '부결'}</strong>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          <div className="avalon-proposal-list">
            {room.history.proposals.map((proposal) => (
              <article key={proposal.id}>
                <strong>
                  {proposal.questNumber}원정 {proposal.attempt}차 ·{' '}
                  {proposal.approved ? '가결' : '부결'}
                </strong>
                <p>대장 {person(proposal.leaderId)}</p>
                <p>
                  원정대{' '}
                  {proposal.teamIds.map((id) => (
                    <span key={id}>{person(id)} </span>
                  ))}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
      {tab === 'quests' && (
        <div role="tabpanel" aria-label="익명 원정 결과">
          {room.history.quests.length === 0 ? (
            <p className="avalon-empty">
              원정대원 전원이 카드를 제출하면 카드 수와 판정이 공개됩니다.
            </p>
          ) : (
            <div className="avalon-quest-history">
              {room.history.quests.map((quest) => (
                <article key={quest.proposalId}>
                  <header>
                    <strong>{quest.questNumber}번째 원정</strong>
                    <b className={quest.failed ? 'failed' : 'succeeded'}>
                      {quest.failed ? '실패' : '성공'}
                    </b>
                  </header>
                  <p>
                    {quest.teamIds.map((id) => (
                      <span key={id}>{person(id)} </span>
                    ))}
                  </p>
                  <div className="avalon-anonymous-counts">
                    <span>성공 {quest.successCount}장</span>
                    <span>실패 {quest.failCount}장</span>
                  </div>
                  <small>카드는 익명 집계이며 작성자를 표시하지 않습니다.</small>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'events' && (
        <ol role="tabpanel" aria-label="중요한 단계 전환" className="avalon-event-log">
          {room.history.events
            .filter((event) => eventText(event))
            .map((event) => (
              <li key={event.id}>
                <span>{event.questNumber}원정</span>
                <p>{eventText(event)}</p>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
