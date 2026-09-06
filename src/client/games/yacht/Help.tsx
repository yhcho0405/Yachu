import { CATEGORIES, LABELS } from '../../../shared/protocol';
import { RULES } from './help-data';

export default function YachtHelp() {
  return (
    <>
      <div className="help-steps">
        <p>
          <b>1</b>
          <span>
            <strong>주사위를 최대 세 번 굴립니다.</strong> 첫 굴림은 다섯 개 모두 굴립니다. 이후
            원하는 주사위를 보관하고 나머지만 다시 굴릴 수 있습니다.
          </span>
        </p>
        <p>
          <b>2</b>
          <span>
            <strong>점수 항목을 선택하고 확정합니다.</strong> 첫 번째나 두 번째 굴림 뒤에도 기록할
            수 있습니다. 조건에 맞지 않는 항목은 0점이며, 확인 후 사용합니다. 확정한 항목은 바꿀 수
            없습니다.
          </span>
        </p>
        <p>
          <b>3</b>
          <span>
            <strong>12개 항목의 합계로 순위를 정합니다.</strong> 합계가 같으면 공동 순위입니다. 혼자
            플레이할 때도 같은 규칙을 적용합니다.
          </span>
        </p>
      </div>
      <div className="rules-grid">
        {CATEGORIES.map((category) => (
          <div key={category}>
            <strong>{LABELS[category]}</strong>
            <span>{RULES[category]}</span>
          </div>
        ))}
      </div>
      <div className="help-callout">
        <strong>상단 합계 63점 이상: 보너스 35점</strong>
        <p>
          에이스부터 식스까지의 합계입니다. 최고점은 325점입니다. 같은 눈 다섯 개는 풀 하우스로
          인정하며, 추가 야추 보너스와 조커 규칙은 없습니다.
        </p>
      </div>
      <p className="help-text">
        키보드 <kbd>1</kbd>–<kbd>5</kbd>로 보관, <kbd>Space</kbd>로 굴립니다. 점수와 메뉴는{' '}
        <kbd>Tab</kbd>과 <kbd>Enter</kbd>로 선택합니다. 입력칸과 대화상자에서는 게임 단축키가
        작동하지 않습니다.
      </p>
    </>
  );
}
