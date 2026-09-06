import { CATEGORIES, type Category, type Scores } from './protocol';

export const RULES_VERSION = 'nintendo-yacht-12-v1';
export function emptyScores(): Scores {
  return Object.fromEntries(CATEGORIES.map((category) => [category, null])) as Scores;
}
export function scoreDice(dice: readonly number[]): Record<Category, number> {
  if (
    dice.length !== 5 ||
    dice.some((value) => !Number.isInteger(value) || value < 1 || value > 6)
  ) {
    throw new Error('주사위는 1~6 사이의 정수 5개여야 합니다.');
  }
  const counts = Array<number>(7).fill(0);
  for (const value of dice) counts[value] = (counts[value] ?? 0) + 1;
  const sum = dice.reduce((a, b) => a + b, 0);
  const streak = (start: number, length: number) =>
    Array.from({ length }, (_, index) => start + index).every((value) => (counts[value] ?? 0) > 0);
  return {
    aces: counts[1]!,
    deuces: counts[2]! * 2,
    threes: counts[3]! * 3,
    fours: counts[4]! * 4,
    fives: counts[5]! * 5,
    sixes: counts[6]! * 6,
    choice: sum,
    fourKind: counts.some((count) => count >= 4) ? sum : 0,
    fullHouse: counts.includes(5) || (counts.includes(3) && counts.includes(2)) ? sum : 0,
    smallStraight: [1, 2, 3].some((start) => streak(start, 4)) ? 15 : 0,
    largeStraight: [1, 2].some((start) => streak(start, 5)) ? 30 : 0,
    yacht: counts.includes(5) ? 50 : 0,
  };
}
export function totals(scores: Scores): { upper: number; bonus: number; total: number } {
  const upper = CATEGORIES.slice(0, 6).reduce((sum, key) => sum + (scores[key] ?? 0), 0);
  const bonus = upper >= 63 ? 35 : 0;
  return { upper, bonus, total: CATEGORIES.reduce((sum, key) => sum + (scores[key] ?? 0), bonus) };
}
