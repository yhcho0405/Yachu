import type { AvalonPublicState } from '../../../shared/avalon';

export function avalonSeatLayout(seat: number, count: number, radius = 4.48) {
  const angle = (seat / count) * Math.PI * 2;
  return { x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius };
}

export function avalonCardLayout(index: number, count: number) {
  const rows = count > 5;
  const row = rows ? Math.floor(index / 5) : 0;
  const columns = rows ? Math.min(5, count - row * 5) : count;
  const column = rows ? index % 5 : index;
  return {
    x: (column - (columns - 1) / 2) * 0.75,
    z: rows ? (row - 0.5) * 1.1 + 0.23 : 0.18,
    angle: (column - (columns - 1) / 2) * -0.045,
  };
}

export type AvalonCardFace = 'back' | 'success' | 'fail';
type CardInput = Pick<AvalonPublicState, 'stage' | 'proposal' | 'latestEvent'> & {
  history: Pick<AvalonPublicState['history'], 'proposals' | 'quests'>;
};

/** Returns anonymous aggregate faces, never an individual card object or a player association. */
export function aggregateAvalonCards(state: CardInput): AvalonCardFace[] {
  const vote = state.history.proposals.at(-1);
  if (state.latestEvent?.type === 'vote_revealed' && vote) {
    const approvals = vote.votes.filter((item) => item.approve).length;
    return [
      ...Array(approvals).fill('success'),
      ...Array(vote.votes.length - approvals).fill('fail'),
    ];
  }
  if (state.stage === 'vote' || state.stage === 'quest') {
    return Array(state.proposal?.submittedIds.length ?? 0).fill('back');
  }
  const quest = state.history.quests.at(-1);
  return quest
    ? [...Array(quest.successCount).fill('success'), ...Array(quest.failCount).fill('fail')]
    : [];
}
