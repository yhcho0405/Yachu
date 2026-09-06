/** Stable service catalog. Assets and client loaders live in the client registry. */
export const GAME_CATALOG = [
  {
    id: 'yacht',
    name: '야추',
    description: '주사위 다섯 개로 조합을 만들고 점수를 겨루는 게임.',
    minPlayers: 1,
    maxPlayers: 4,
    soloMode: 'solo',
  },
  {
    id: 'tikatuka',
    name: '티카투카',
    description: '주사위를 배치하고 상대를 견제하는 1대1 보드게임.',
    minPlayers: 2,
    maxPlayers: 2,
    soloMode: 'computer',
  },
] as const;

export type GameType = (typeof GAME_CATALOG)[number]['id'];
export function isGameType(value: unknown): value is GameType {
  return GAME_CATALOG.some((game) => game.id === value);
}
export function gameMetadata(type: GameType) {
  return GAME_CATALOG.find((game) => game.id === type)!;
}
