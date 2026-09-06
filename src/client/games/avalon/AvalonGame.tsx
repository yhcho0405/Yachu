import { useEffect, useRef, useState } from 'react';
import {
  AVALON_ROLE_LABELS,
  getAvalonActions,
  getAvalonFailThreshold,
  getAvalonQuestSize,
  type AvalonFinishReason,
  type AvalonGameIntent,
  type AvalonPublicState,
  type AvalonQuestCard,
  type AvalonRoomState,
  type AvalonStage,
} from '../../../shared/avalon';
import type { GameScreenProps } from '../types';
import { createAvalonAudio } from './audio';
import AvalonBoard from './Board';
import Discussion from './Discussion';
import History from './History';
import PrivateInfo from './PrivateInfo';
import './avalon.css';

const STAGES: Record<AvalonStage, string> = {
  lobby: '대기실',
  team: '원정대 구성',
  vote: '원정대 투표',
  quest: '원정 진행',
  lady: '호수의 여인',
  assassination: '암살',
  finished: '최종 결과',
};
const REASONS: Record<AvalonFinishReason, string> = {
  three_failed_quests: '원정이 세 번 실패했습니다.',
  five_rejections: '같은 원정에서 제안이 다섯 번 연속 부결되었습니다.',
  merlin_assassinated: '암살자가 멀린을 찾아냈습니다.',
  assassination_missed: '원정 세 번 성공 후 멀린을 지켜냈습니다.',
  disconnected: '참가자의 재접속 유예가 끝나 경기를 무효 종료했습니다.',
  player_left: '진행 중 참가자가 방을 나가 경기를 무효 종료했습니다.',
  session_expired: '참가자의 접속 자격이 만료되어 경기를 무효 종료했습니다.',
  room_expired: '방의 유지 시간이 끝나 경기를 무효 종료했습니다.',
};

export default function AvalonGame({
  room,
  session,
  connection,
  queue,
  settings,
  error,
  onIntent,
}: GameScreenProps<AvalonRoomState>) {
  const [audio] = useState(createAvalonAudio);
  const [teamDraft, setTeamDraft] = useState<string[]>([]);
  const [voteDraft, setVoteDraft] = useState<boolean | null>(null);
  const [cardDraft, setCardDraft] = useState<AvalonQuestCard | null>(null);
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [localPending, setLocalPending] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const submittedPhase = useRef<string | null>(null);
  const discussionEvent = useRef<string | null>(null);
  const phaseKey = `${room.gameId}:${room.phaseId}:${room.proposal?.id ?? ''}`;
  const actions = getAvalonActions(room, session.playerId);
  const connected = connection === 'online';
  const gamePending = queue.some(
    (item) => item.intent.type !== 'av_chat' && item.intent.type !== 'av_signal',
  );
  const ready = connected && !gamePending && !localPending && now >= room.inputAfter;
  const ownInfo = room.privateInfo?.playerId === session.playerId ? room.privateInfo : null;
  const player = (id: string | null) => room.players.find((value) => value.id === id);
  const needed = getAvalonQuestSize(room.players.length, room.questNumber);
  const failThreshold = getAvalonFailThreshold(room.players.length, room.questNumber);
  const submittedIds = room.proposal?.submittedIds ?? [];
  const participants =
    room.stage === 'quest' ? (room.proposal?.teamIds ?? []) : room.players.map((value) => value.id);
  const awaiting = participants.filter((id) => !submittedIds.includes(id));
  const successes = room.history.quests.filter((quest) => !quest.failed).length;
  const failures = room.history.quests.filter((quest) => quest.failed).length;
  const { privateInfo: _privateInfo, ...publicRoom } = room;
  const publicState: AvalonPublicState = publicRoom;
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
    const key = `${room.gameId}:${room.chat.at(-1)?.id ?? ''}:${room.signals.at(-1)?.id ?? ''}`;
    if (discussionEvent.current !== null && discussionEvent.current !== key && connected) {
      const latestAt = Math.max(room.chat.at(-1)?.at ?? 0, room.signals.at(-1)?.at ?? 0);
      if (!document.hidden && Date.now() - latestAt < 3000) audio.play('message', 0.4);
    }
    discussionEvent.current = connected ? key : null;
  }, [audio, connected, room.gameId, room.chat, room.signals]);
  useEffect(() => {
    setTeamDraft([]);
    setVoteDraft(null);
    setCardDraft(null);
    setTargetDraft(null);
    setLocalPending(null);
    submittedPhase.current = null;
  }, [phaseKey]);
  useEffect(() => {
    if (actions.submitted || (error && !gamePending)) {
      setLocalPending(null);
      submittedPhase.current = null;
    }
  }, [actions.submitted, error, gamePending]);
  useEffect(() => {
    setNow(Date.now());
    if (room.inputAfter <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= room.inputAfter) clearInterval(timer);
    }, 75);
    return () => clearInterval(timer);
  }, [room.inputAfter]);
  const focus = (id: string) => {
    if (!player(id)) return;
    setFocusedId(id);
  };
  const selectSeat = (id: string) => {
    focus(id);
    if (!ready) return;
    if (actions.canSelectTeam) {
      setTeamDraft((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : current.length < needed
            ? [...current, id]
            : current,
      );
      audio.play('select');
    } else if (
      (actions.canUseLady && actions.ladyTargetIds.includes(id)) ||
      (actions.canAssassinate && actions.assassinationTargetIds.includes(id))
    ) {
      setTargetDraft((current) => (current === id ? null : id));
      audio.play('select');
    }
  };
  const send = (intent: AvalonGameIntent) => {
    if (!ready || submittedPhase.current === phaseKey) return;
    submittedPhase.current = phaseKey;
    setLocalPending(phaseKey);
    onIntent(intent);
  };
  const envelope = { phaseId: room.phaseId, proposalId: room.proposal?.id ?? null };
  const selectedIds = room.stage === 'team' ? teamDraft : targetDraft ? [targetDraft] : [];
  const acting =
    room.stage === 'team'
      ? `${player(room.leaderId)?.nickname ?? '대장'}`
      : room.stage === 'vote'
        ? `참가자 전원 ${room.players.length}명`
        : room.stage === 'quest'
          ? `원정대원 ${room.proposal?.teamIds.length ?? needed}명`
          : room.stage === 'lady'
            ? `${player(room.lady?.holderId ?? null)?.nickname ?? '토큰 소유자'}`
            : room.stage === 'assassination'
              ? '암살자'
              : '모든 참가자';
  const progress =
    room.stage === 'vote' || room.stage === 'quest'
      ? `${participants.length}명 중 ${submittedIds.length}명 제출 완료`
      : room.stage === 'team'
        ? `이번 원정은 ${needed}명 · ${room.rejections + 1}차 제안`
        : room.stage === 'assassination'
          ? '원정 3회 성공 · 최종 승패 미정'
          : room.stage === 'lady'
            ? '조사 대상과 토큰 전달만 공개됩니다.'
            : room.winner
              ? `${room.winner === 'good' ? '선' : '악'} 승리`
              : '무효 종료';
  const instruction = !connected
    ? '연결을 복구하면 같은 역할과 제출 상태로 계속할 수 있습니다.'
    : localPending || gamePending
      ? '선택을 전송하고 있습니다. 서버의 확정을 기다려 주세요.'
      : room.phase === 'finished'
        ? room.winner
          ? '최종 판정과 공개된 역할을 확인하세요.'
          : '승리 진영이 없으며 비공개 역할을 공개하지 않습니다.'
        : actions.submitted && (room.stage === 'vote' || room.stage === 'quest')
          ? `제출 완료 · 아직 제출하지 않은 ${awaiting.length}명을 기다리고 있습니다.`
          : actions.canSelectTeam
            ? `보드나 좌석 목록에서 ${needed}명을 선택하고 원정대를 확정하세요.`
            : actions.canVote
              ? '찬성 또는 반대를 선택한 뒤 최종 제출하세요.'
              : actions.canSubmitQuest
                ? '카드를 고른 뒤 제출하세요.'
                : actions.canUseLady
                  ? '조사할 사람을 선택한 뒤 확인하세요. 이미 사용한 사람은 조사할 수 없습니다.'
                  : actions.canAssassinate
                    ? '멀린으로 생각하는 사람을 선택한 뒤 암살 대상을 확정하세요.'
                    : room.stage === 'team'
                      ? '대장이 원정대를 구성하고 있습니다. 채팅으로 의견을 나누세요.'
                      : room.stage === 'quest'
                        ? '이번 원정대원이 아닙니다. 카드 제출을 기다리며 토론을 계속하세요.'
                        : room.stage === 'lady'
                          ? '토큰 소유자의 조사를 기다리고 있습니다.'
                          : '암살자의 선택을 기다리고 있습니다. 아직 선의 최종 승리가 아닙니다.';
  const latestQuest = room.history.quests.at(-1);
  const latestVote = room.history.proposals.at(-1);
  const latestSummary =
    room.latestEvent?.type === 'vote_revealed' && latestVote
      ? `찬성 ${latestVote.votes.filter((vote) => vote.approve).length} · 반대 ${latestVote.votes.filter((vote) => !vote.approve).length} — ${latestVote.approved ? '원정대 가결' : '원정대 부결'}`
      : room.latestEvent?.type === 'quest_resolved' && latestQuest
        ? `${latestQuest.questNumber}번째 원정 ${latestQuest.failed ? '실패' : '성공'} · 성공 ${latestQuest.successCount}장 / 실패 ${latestQuest.failCount}장`
        : room.latestEvent?.type === 'lady_used'
          ? '조사가 끝나고 호수의 여인이 전달되었습니다. 확인한 진영은 개인 정보입니다.'
          : null;
  return (
    <div className="avalon-game" data-testid="avalon-game" data-stage={room.stage}>
      <div className="avalon-core" data-testid="av-core">
        <section className="avalon-status" aria-label="현재 진행" aria-live="polite">
          <div className="avalon-phase-heading">
            <span className="avalon-kicker">{Math.min(5, room.questNumber)}번째 원정</span>
            <h2 data-testid="av-stage">{STAGES[room.stage]}</h2>
          </div>
          <div className="avalon-status-owner">
            <span>행동할 사람</span>
            <strong>{acting}</strong>
          </div>
          <div className="avalon-status-task">
            <span>{latestSummary ? '최근 결과' : '진행 상황'}</span>
            <p className={latestSummary ? 'avalon-latest-summary' : ''}>
              {latestSummary ?? progress}
            </p>
          </div>
        </section>
        <div className="avalon-tracks">
          <ol className="avalon-quest-track" aria-label="다섯 원정 기록">
            {[1, 2, 3, 4, 5].map((number) => {
              const quest = room.history.quests.find((value) => value.questNumber === number);
              return (
                <li
                  key={number}
                  className={`${quest ? (quest.failed ? 'failed' : 'succeeded') : ''} ${room.questNumber === number && room.phase === 'playing' ? 'current' : ''}`}
                >
                  <span>{number}원정</span>
                  <strong>
                    {quest
                      ? quest.failed
                        ? '× 실패'
                        : '✓ 성공'
                      : `${getAvalonQuestSize(room.players.length, number)}명`}
                  </strong>
                  <small>
                    {getAvalonFailThreshold(room.players.length, number) === 2
                      ? '실패 2장 필요'
                      : quest
                        ? `${quest.successCount}성공 · ${quest.failCount}실패`
                        : '실패 1장 필요'}
                  </small>
                </li>
              );
            })}
          </ol>
          <div className="avalon-rejections">
            <span>
              연속 부결 <b>{room.rejections}/5</b>
            </span>
            <div aria-hidden="true">
              {[1, 2, 3, 4, 5].map((value) => (
                <i key={value} className={value <= room.rejections ? 'filled' : ''} />
              ))}
            </div>
            <small>
              {room.phase === 'finished'
                ? '최종 기록'
                : `${5 - room.rejections}회 더 부결되면 악 승리`}
            </small>
          </div>
        </div>
        <div className="avalon-layout">
          <div className="avalon-board-area">
            <AvalonBoard
              room={publicState}
              viewerId={session.playerId}
              selectedIds={selectedIds}
              focusedId={focusedId}
              interactive={connected}
              reducedMotion={settings.reducedMotion}
              online={connected}
              audio={audio}
              onSeatClick={selectSeat}
            />
            <details className="avalon-seat-details" data-testid="av-seat-details">
              <summary>좌석 상세 상태 · {room.players.length}명</summary>
              <div className="avalon-seat-list" aria-label="좌석과 공개 상태">
                {room.players.map((participant) => {
                  const team = room.proposal?.teamIds.includes(participant.id);
                  const submitted = submittedIds.includes(participant.id);
                  const expected = room.stage === 'vote' || (room.stage === 'quest' && team);
                  const selected = selectedIds.includes(participant.id);
                  return (
                    <button
                      key={participant.id}
                      data-testid={`av-seat-${participant.seat}`}
                      className={`avalon-seat ${selected ? 'selected' : ''} ${focusedId === participant.id ? 'focused' : ''}`}
                      aria-pressed={selected}
                      onClick={() => selectSeat(participant.id)}
                      title={participant.nickname}
                    >
                      <span className="avalon-seat-number">{participant.seat + 1}</span>
                      <span className="avalon-seat-description">
                        <strong>
                          {participant.nickname}
                          {participant.id === session.playerId && <small>나</small>}
                        </strong>
                        <span>
                          {room.leaderId === participant.id && <b>대장</b>}
                          {team && <b>원정대원</b>}
                          {room.lady?.holderId === participant.id && <b>호수의 여인</b>}
                          {!participant.connected && <em>연결 끊김</em>}
                          {expected && (
                            <em className={submitted ? 'submitted' : ''}>
                              {submitted ? '✓ 제출 완료' : '제출 대기'}
                            </em>
                          )}
                          {selected && room.stage === 'team' && <em>선택 초안</em>}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>
          </div>
          <aside className="avalon-side">
            <section
              id="avalon-action"
              className="avalon-action avalon-panel"
              aria-label="나의 조작"
            >
              <div className="avalon-panel-heading">
                <div>
                  <h2>{room.phase === 'finished' ? '경기 결과' : '나의 조작'}</h2>
                </div>
                {(room.stage === 'vote' || room.stage === 'quest') && (
                  <span className="avalon-counter" data-testid="av-submission-count">
                    {submittedIds.length}/{participants.length} 제출
                  </span>
                )}
              </div>
              <p className="avalon-action-instruction" data-testid="av-instruction">
                {instruction}
              </p>
              {room.stage === 'team' && (
                <>
                  <div className="avalon-team-selection">
                    <strong>
                      {actions.canSelectTeam
                        ? `선택 초안 ${teamDraft.length}/${needed}명`
                        : `대장이 ${needed}명을 선택 중`}
                    </strong>
                    {actions.canSelectTeam && (
                      <div>
                        {teamDraft.map((id) => (
                          <button key={id} onClick={() => selectSeat(id)} disabled={!ready}>
                            {player(id)?.seat !== undefined ? `${player(id)!.seat + 1}번 ` : ''}
                            {player(id)?.nickname} ×
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {actions.canSelectTeam && (
                    <div className="avalon-confirm-row">
                      <p>확정하면 모든 사람에게 원정대가 공개되고 투표를 시작합니다.</p>
                      <button
                        className="button primary"
                        data-testid="av-team-confirm"
                        disabled={!ready || teamDraft.length !== needed}
                        onClick={() =>
                          send({ ...envelope, type: 'av_team', teamIds: [...teamDraft] })
                        }
                      >
                        원정대 확정 · {teamDraft.length}/{needed}
                      </button>
                    </div>
                  )}
                </>
              )}
              {room.proposal && (room.stage === 'vote' || room.stage === 'quest') && (
                <div className="avalon-confirmed-team">
                  <span>확정 원정대</span>
                  {room.proposal.teamIds.map((id) => (
                    <button key={id} className="avalon-person-link" onClick={() => focus(id)}>
                      {player(id)?.seat !== undefined ? `${player(id)!.seat + 1}번 ` : ''}
                      {player(id)?.nickname}
                    </button>
                  ))}
                </div>
              )}
              {room.stage === 'vote' && actions.canVote && (
                <>
                  <div className="avalon-choice-pair">
                    {([true, false] as const).map((approve) => (
                      <button
                        key={String(approve)}
                        data-testid={approve ? 'av-vote-approve' : 'av-vote-reject'}
                        className={voteDraft === approve ? 'chosen' : ''}
                        aria-pressed={voteDraft === approve}
                        disabled={!ready}
                        onClick={() => {
                          setVoteDraft(approve);
                          audio.play('select');
                        }}
                      >
                        <b>{approve ? '✓' : '×'}</b>
                        <strong>{approve ? '찬성' : '반대'}</strong>
                      </button>
                    ))}
                  </div>
                  <div className="avalon-confirm-row">
                    <p>비밀 투표입니다. 제출 후에는 바꿀 수 없습니다.</p>
                    <button
                      className="button primary"
                      data-testid="av-vote-submit"
                      disabled={!ready || voteDraft === null}
                      onClick={() => {
                        if (voteDraft !== null)
                          send({ ...envelope, type: 'av_vote', approve: voteDraft });
                      }}
                    >
                      {voteDraft === null
                        ? '찬반을 선택하세요'
                        : `${voteDraft ? '찬성' : '반대'} 제출`}
                    </button>
                  </div>
                </>
              )}
              {room.stage === 'quest' && actions.canSubmitQuest && (
                <>
                  <p className="avalon-rule-note">
                    실패 카드 {failThreshold}장 이상이면 원정 실패
                    {failThreshold === 2 && ' · 7인 이상 4번째 원정'}
                  </p>
                  <div className="avalon-choice-pair">
                    {(['success', 'fail'] as const).map((card) => (
                      <button
                        key={card}
                        data-testid={`av-card-${card}`}
                        className={cardDraft === card ? 'chosen' : ''}
                        aria-pressed={cardDraft === card}
                        disabled={!ready || !actions.questCards.includes(card)}
                        aria-describedby={
                          card === 'fail' && !actions.questCards.includes(card)
                            ? 'avalon-good-card-policy'
                            : undefined
                        }
                        onClick={() => {
                          setCardDraft(card);
                          audio.play('select');
                        }}
                      >
                        <b>{card === 'success' ? '◇' : '◆'}</b>
                        <strong>{card === 'success' ? '성공' : '실패'} 카드</strong>
                      </button>
                    ))}
                  </div>
                  {ownInfo?.alignment === 'good' && (
                    <p id="avalon-good-card-policy" className="avalon-subtle">
                      선 진영은 성공 카드만 제출할 수 있습니다.
                    </p>
                  )}
                  <div className="avalon-confirm-row">
                    <p>익명 카드입니다. 제출 후에는 바꿀 수 없습니다.</p>
                    <button
                      className="button primary"
                      data-testid="av-card-submit"
                      disabled={!ready || !cardDraft}
                      onClick={() => {
                        if (cardDraft) send({ ...envelope, type: 'av_quest', card: cardDraft });
                      }}
                    >
                      {cardDraft
                        ? `${cardDraft === 'success' ? '성공' : '실패'} 카드 제출`
                        : '카드를 선택하세요'}
                    </button>
                  </div>
                </>
              )}
              {actions.submitted && (room.stage === 'vote' || room.stage === 'quest') && (
                <div className="avalon-submitted" data-testid="av-submitted">
                  <b>✓ 제출 완료</b>
                  <p>
                    {room.stage === 'vote' && ownInfo && ownInfo.myVote !== null
                      ? `내 투표: ${ownInfo?.myVote ? '찬성' : '반대'} · 내 화면에만 표시`
                      : '원정 카드 제출을 마쳤습니다. 다른 참가자에게는 카드 종류를 표시하지 않습니다.'}
                  </p>
                  <small>전원 제출 후 결과가 함께 공개됩니다.</small>
                </div>
              )}
              {(actions.canUseLady || actions.canAssassinate) && (
                <>
                  <div className="avalon-target-selection">
                    <span>
                      {targetDraft ? '선택한 대상' : '보드나 좌석 목록에서 대상을 고르세요'}
                    </span>
                    {targetDraft && (
                      <strong>
                        {player(targetDraft)?.seat !== undefined
                          ? `${player(targetDraft)!.seat + 1}번 `
                          : ''}
                        {player(targetDraft)?.nickname}
                      </strong>
                    )}
                  </div>
                  {actions.canUseLady && (
                    <p className="avalon-subtle">
                      자신과 이미 호수의 여인을 사용한 사람은 대상에서 제외됩니다. 진영만 확인하며
                      역할명은 알 수 없습니다.
                    </p>
                  )}
                  <div className="avalon-confirm-row">
                    <p>
                      {actions.canAssassinate
                        ? '확정하면 암살 판정으로 경기가 끝납니다. 대상을 다시 확인하세요.'
                        : '확인한 진영은 나만 보고, 토큰은 조사한 사람에게 넘어갑니다.'}
                    </p>
                    <button
                      className={`button ${actions.canAssassinate ? 'danger' : 'primary'}`}
                      data-testid={
                        actions.canAssassinate ? 'av-assassinate-confirm' : 'av-lady-confirm'
                      }
                      disabled={!ready || !targetDraft}
                      onClick={() => {
                        if (targetDraft)
                          send({
                            ...envelope,
                            type: actions.canAssassinate ? 'av_assassinate' : 'av_lady',
                            targetId: targetDraft,
                          });
                      }}
                    >
                      {actions.canAssassinate ? '암살 대상 확정' : '진영 확인'}
                    </button>
                  </div>
                </>
              )}
              {room.phase === 'finished' && (
                <div className="avalon-results" data-testid="av-results">
                  <h3>
                    {room.winner ? `${room.winner === 'good' ? '선' : '악'} 승리` : '무효 종료'}
                  </h3>
                  <p>{room.finishReason ? REASONS[room.finishReason] : '경기가 종료되었습니다.'}</p>
                  <div className="avalon-result-counts">
                    <span>
                      원정 성공 <b>{successes}</b>
                    </span>
                    <span>
                      원정 실패 <b>{failures}</b>
                    </span>
                  </div>
                  {room.revealedRoles.length > 0 && (
                    <div className="avalon-role-reveal" data-testid="av-role-reveal">
                      {room.players.map((participant) => {
                        const revealed = room.revealedRoles.find(
                          (role) => role.playerId === participant.id,
                        );
                        return revealed ? (
                          <div key={participant.id}>
                            <span>
                              {participant.seat + 1}번 {participant.nickname}
                            </span>
                            <strong>{AVALON_ROLE_LABELS[revealed.role]}</strong>
                            <small>{revealed.alignment === 'good' ? '선' : '악'}</small>
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}
                  {session.playerId === room.hostId ? (
                    <button
                      className="button primary"
                      data-testid="rematch"
                      disabled={!connected || gamePending}
                      onClick={() => onIntent({ type: 'rematch' })}
                    >
                      같은 방에서 다시 하기
                    </button>
                  ) : (
                    <p className="avalon-subtle">방장이 재경기를 열면 다시 준비할 수 있습니다.</p>
                  )}
                </div>
              )}
              {(room.stage === 'vote' || room.stage === 'quest') && awaiting.length > 0 && (
                <details className="avalon-awaiting">
                  <summary>미제출 {awaiting.length}명 확인</summary>
                  <div>
                    {awaiting.map((id) => (
                      <button key={id} className="avalon-person-link" onClick={() => focus(id)}>
                        {player(id)?.nickname}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </section>
            <div className="avalon-private-area">
              <PrivateInfo
                key={room.gameId}
                room={room}
                playerId={session.playerId}
                onFocus={focus}
              />
            </div>
          </aside>
          <div id="avalon-discussion" className="avalon-discussion-area">
            <Discussion
              compact
              room={publicState}
              playerId={session.playerId}
              connected={connected}
              queue={queue}
              error={error}
              focusedId={focusedId}
              onFocus={focus}
              onIntent={onIntent}
            />
          </div>
        </div>
      </div>
      <details id="avalon-history" className="avalon-history-area avalon-history-details">
        <summary>경기 기록 · 투표 비교와 원정 결과</summary>
        <History room={publicState} onFocus={focus} />
      </details>
    </div>
  );
}
