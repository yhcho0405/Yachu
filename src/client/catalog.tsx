import { GAME_CATALOG, gameMetadata, type GameType } from '../shared/games';
import { DieIcon } from './components';

// Catalog images are captured from this app’s own procedural boards.
// Game scenes and audio load only after entering an active game.
export function GameThumbnail({ gameType }: { gameType: GameType }) {
  if (gameType === 'avalon')
    return (
      <div className="avalon-card-board" aria-hidden="true">
        <div className="avalon-card-ring">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ transform: `rotate(${i * 36}deg) translateY(-72px)` }} />
          ))}
        </div>
        <span className="avalon-card-sigil">✦</span>
      </div>
    );
  if (gameType === 'yacht')
    return (
      <div className="yacht-card-board" aria-hidden="true">
        <div className="yacht-card-reserve">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} />
          ))}
        </div>
        <div className="yacht-card-dice">
          {[2, 5, 1, 6, 4].map((v, i) => (
            <span key={i}>
              <DieIcon value={v} />
            </span>
          ))}
        </div>
      </div>
    );
  return (
    <div className="tika-card-board" aria-hidden="true">
      {[0, 1].map((side) => (
        <div className={`tika-card-side side-${side}`} key={side}>
          {[0, 1, 2].map((line) => (
            <div className="tika-card-line" key={line}>
              {[0, 1, 2].map((slot) => (
                <span
                  className={`tika-card-slot ${slot === 0 && line === 1 ? 'shield' : ''}`}
                  key={slot}
                >
                  {(line + slot + side) % 4 !== 0 && (
                    <DieIcon value={((line * 2 + slot + side * 3) % 6) + 1} />
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="tika-card-divider">
        <i>1</i>
        <i>2</i>
        <i>3</i>
      </div>
    </div>
  );
}
export function GamePreview({ gameType }: { gameType: GameType }) {
  return (
    <div className={`catalog-preview preview-${gameType}`}>
      <GameThumbnail gameType={gameType} />
      <img
        className="catalog-board-image"
        src={`/previews/${gameType}.webp`}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={(event) => {
          event.currentTarget.parentElement!.dataset.previewLoaded = 'true';
        }}
        onError={(event) => {
          event.currentTarget.style.visibility = 'hidden';
        }}
      />
    </div>
  );
}
export function GameCatalog({
  selected,
  onSelect,
}: {
  selected: GameType;
  onSelect: (game: GameType) => void;
}) {
  return (
    <section className="game-catalog" aria-label="게임 선택">
      {GAME_CATALOG.map((game) => (
        <button
          type="button"
          className={`game-card ${selected === game.id ? 'selected' : ''}`}
          data-testid={`game-card-${game.id}`}
          aria-pressed={selected === game.id}
          onClick={() => onSelect(game.id)}
          key={game.id}
        >
          <div className="game-card-visual">
            <GamePreview gameType={game.id} />
            <span className="game-card-selection">
              {selected === game.id ? '✓ 선택됨' : '선택'}
            </span>
          </div>
          <div className="game-card-copy">
            <div className="game-card-heading">
              <h2>{game.name}</h2>
              <span>
                {game.minPlayers === game.maxPlayers
                  ? `${game.maxPlayers}명`
                  : `${game.minPlayers}–${game.maxPlayers}명`}
              </span>
            </div>
            <p>{game.description}</p>
            <small>
              {game.soloMode === 'computer'
                ? '컴퓨터 대전 · 온라인 1대1'
                : game.soloMode === 'none'
                  ? '5–10인 · 정체 추리 · 토론과 투표'
                  : '혼자 플레이 · 온라인 대전'}
            </small>
          </div>
        </button>
      ))}
    </section>
  );
}
export function SelectedGameSummary({ gameType }: { gameType: GameType }) {
  const game = gameMetadata(gameType);
  return (
    <div className="selected-game-summary">
      <span>선택한 게임</span>
      <strong>{game.name}</strong>
      <p>
        {game.soloMode === 'computer'
          ? '혼자 시작하면 컴퓨터와 대전합니다.'
          : game.soloMode === 'none'
            ? '5~10명이 모여 토론하고 투표하는 온라인 대전입니다.'
            : '혼자 또는 친구와 플레이할 수 있습니다.'}
      </p>
    </div>
  );
}
