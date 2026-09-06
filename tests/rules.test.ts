import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../src/shared/protocol';
import { emptyScores, scoreDice, totals } from '../src/shared/rules';

describe('Nintendo Yacht 12-category rules', () => {
  it('matches the independently specified examples and upper bonus threshold', () => {
    expect(scoreDice([1, 2, 3, 4, 4])).toMatchObject({ smallStraight: 15, largeStraight: 0 });
    expect(scoreDice([2, 3, 4, 5, 6])).toMatchObject({ smallStraight: 15, largeStraight: 30 });
    expect(scoreDice([2, 2, 2, 5, 5]).fullHouse).toBe(16);
    expect(scoreDice([6, 6, 6, 6, 2]).fourKind).toBe(26);
    expect(scoreDice([6, 6, 6, 6, 6])).toMatchObject({
      fullHouse: 30,
      fourKind: 30,
      choice: 30,
      sixes: 30,
      yacht: 50,
    });
    expect(scoreDice([2, 2, 2, 2, 5]).fullHouse).toBe(0);
    expect(totals({ ...emptyScores(), aces: 2, deuces: 10, fives: 20, sixes: 30 })).toEqual({
      upper: 62,
      bonus: 0,
      total: 62,
    });
    expect(totals({ ...emptyScores(), aces: 3, deuces: 10, fives: 20, sixes: 30 })).toEqual({
      upper: 63,
      bonus: 35,
      total: 98,
    });
  });
  it('exhausts 7,776 ordered rolls, with independent combinatorial counts and invariants', () => {
    const found = { yacht: 0, fourKind: 0, fullHouse: 0, smallStraight: 0, largeStraight: 0 };
    const maxima = Object.fromEntries(CATEGORIES.map((key) => [key, 0])) as Record<
      (typeof CATEGORIES)[number],
      number
    >;
    for (let encoded = 0; encoded < 7776; encoded++) {
      let n = encoded;
      const dice = Array.from({ length: 5 }, () => {
        const value = (n % 6) + 1;
        n = Math.floor(n / 6);
        return value;
      });
      const result = scoreDice(dice);
      expect(result).toEqual(scoreDice([...dice].reverse()));
      expect(result).toEqual(scoreDice([...dice.slice(1), dice[0]!]));
      expect(CATEGORIES.slice(0, 6).reduce((sum, key) => sum + result[key], 0)).toBe(result.choice);
      expect(result.choice).toBeGreaterThanOrEqual(5);
      expect(result.choice).toBeLessThanOrEqual(30);
      for (const key of CATEGORIES) {
        expect(Number.isInteger(result[key])).toBe(true);
        expect(result[key]).toBeGreaterThanOrEqual(0);
        maxima[key] = Math.max(maxima[key], result[key]);
      }
      for (const key of Object.keys(found) as (keyof typeof found)[])
        if (result[key] > 0) found[key]++;
      if (result.yacht) {
        expect(result.fullHouse).toBe(result.choice);
        expect(result.fourKind).toBe(result.choice);
      }
      if (result.largeStraight) expect(result.smallStraight).toBe(15);
      // A sorted unique string oracle is deliberately different from the rule's count/streak representation.
      const sequence = [...new Set(dice)].sort().join('');
      expect(result.smallStraight > 0).toBe(/1234|2345|3456/.test(sequence));
      expect(result.largeStraight > 0).toBe(sequence === '12345' || sequence === '23456');
    }
    // Six uniform rolls; 6*5*5 four+one arrangements plus uniform rolls;
    // 6*5*C(5,3) full houses plus uniform rolls; 2*5! large straights;
    // 3*4*(5!/2!) four-unique and 4*5! five-unique small straights.
    expect(found).toEqual({
      yacht: 6,
      fourKind: 156,
      fullHouse: 306,
      smallStraight: 1200,
      largeStraight: 240,
    });
    expect(totals(maxima)).toEqual({ upper: 105, bonus: 35, total: 325 });
  });
  it('preserves unused versus written zero and rejects invalid dice', () => {
    expect(emptyScores().yacht).toBeNull();
    expect({ ...emptyScores(), yacht: 0 }.yacht).toBe(0);
    for (const dice of [
      [1, 2],
      [0, 1, 1, 1, 1],
      [7, 1, 1, 1, 1],
      [1.5, 1, 1, 1, 1],
      [NaN, 1, 1, 1, 1],
    ])
      expect(() => scoreDice(dice)).toThrow();
  });
});
