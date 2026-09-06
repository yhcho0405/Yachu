import { describe, expect, it } from 'vitest';
import {
  aggregateAvalonCards,
  avalonCardLayout,
  avalonSeatLayout,
} from '../src/client/games/avalon/layout';
import type {
  AvalonEvent,
  AvalonProposal,
  AvalonQuestRecord,
  AvalonVoteRecord,
} from '../src/shared/avalon';

describe('Avalon public visual layout', () => {
  it('keeps 5–10 neutral seats fixed clockwise and gives every pawn and hit area distinct space', () => {
    for (let count = 5; count <= 10; count++) {
      const positions = Array.from({ length: count }, (_, index) => avalonSeatLayout(index, count));
      expect(positions[0]).toEqual({ x: 0, z: -4.48 });
      expect(positions[1].x).toBeGreaterThan(0);
      positions.forEach((position, index) => {
        expect(Math.hypot(position.x, position.z)).toBeCloseTo(4.48);
        for (const next of positions.slice(index + 1)) {
          // Two .72-radius raycast targets and status tokens do not share a seat's footprint.
          expect(Math.hypot(position.x - next.x, position.z - next.z)).toBeGreaterThan(1.44);
        }
      });
    }
  });

  it('centres all 1–10 anonymous card slots and keeps rows separated', () => {
    for (let count = 1; count <= 10; count++) {
      const positions = Array.from({ length: count }, (_, index) => avalonCardLayout(index, count));
      expect(positions.reduce((sum, point) => sum + point.x, 0)).toBeCloseTo(0);
      expect(new Set(positions.map((point) => `${point.x}:${point.z}`)).size).toBe(count);
      expect(Math.max(...positions.map((point) => Math.abs(point.x)))).toBeLessThanOrEqual(1.5);
      positions.forEach((point, index) => {
        for (const other of positions.slice(index + 1)) {
          expect(Math.hypot(point.x - other.x, point.z - other.z)).toBeGreaterThanOrEqual(0.75);
        }
      });
    }
  });

  it('makes unrevealed backs and resolved faces independent of player identities and arrival order', () => {
    const proposal: AvalonProposal = {
      id: 'proposal',
      questNumber: 1,
      leaderId: 'a',
      teamIds: ['a', 'b', 'c'],
      submittedIds: ['a', 'c'],
    };
    const quest: AvalonQuestRecord = {
      questNumber: 1,
      proposalId: 'proposal',
      teamIds: ['a', 'b', 'c'],
      successCount: 2,
      failCount: 1,
      failed: true,
      at: 5,
    };
    const event: AvalonEvent = {
      id: 'public',
      type: 'quest_resolved',
      actorId: null,
      targetId: null,
      questNumber: 1,
      proposalId: 'proposal',
      at: 5,
    };
    const base = {
      stage: 'quest' as const,
      proposal,
      latestEvent: null,
      history: { proposals: [], quests: [] },
    };
    expect(aggregateAvalonCards(base)).toEqual(['back', 'back']);
    expect(
      aggregateAvalonCards({ ...base, proposal: { ...proposal, submittedIds: ['z', 'y'] } }),
    ).toEqual(['back', 'back']);
    const resolved = {
      ...base,
      stage: 'team' as const,
      latestEvent: event,
      history: { proposals: [], quests: [quest] },
    };
    expect(aggregateAvalonCards(resolved)).toEqual(['success', 'success', 'fail']);
    expect(
      aggregateAvalonCards({
        ...resolved,
        history: { proposals: [], quests: [{ ...quest, teamIds: ['z', 'y', 'x'] }] },
      }),
    ).toEqual(aggregateAvalonCards(resolved));
    const vote: AvalonVoteRecord = {
      id: 'proposal',
      questNumber: 1,
      attempt: 1,
      leaderId: 'a',
      teamIds: ['a', 'b', 'c'],
      approved: true,
      at: 5,
      votes: [
        { playerId: 'c', approve: false },
        { playerId: 'a', approve: true },
        { playerId: 'b', approve: true },
      ],
    };
    const revealed = {
      ...base,
      latestEvent: { ...event, type: 'vote_revealed' as const },
      history: { proposals: [vote], quests: [] },
    };
    expect(aggregateAvalonCards(revealed)).toEqual(['success', 'success', 'fail']);
    expect(
      aggregateAvalonCards({
        ...revealed,
        history: { proposals: [{ ...vote, votes: [...vote.votes].reverse() }], quests: [] },
      }),
    ).toEqual(aggregateAvalonCards(revealed));
  });
});
