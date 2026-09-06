import type { Category } from '../../../shared/protocol';

export const RULES: Record<Category, string> = {
  aces: '1이 나온 주사위의 합',
  deuces: '2가 나온 주사위의 합',
  threes: '3이 나온 주사위의 합',
  fours: '4가 나온 주사위의 합',
  fives: '5가 나온 주사위의 합',
  sixes: '6이 나온 주사위의 합',
  choice: '주사위 다섯 개의 합',
  fourKind: '같은 눈 4개 이상 · 다섯 개의 합',
  fullHouse: '같은 눈 3개 + 2개 (5개도 인정) · 합계',
  smallStraight: '서로 다른 눈 4개 이상 연속 · 15점',
  largeStraight: '서로 다른 눈 5개 연속 · 30점',
  yacht: '다섯 개가 모두 같은 눈 · 50점',
};
