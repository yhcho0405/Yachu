import { DieIcon } from '../../components';
export default function TikatukaHelp() {
  return (
    <div className="tikatuka-help">
      <p className="help-text">
        두 사람이 각각 세 줄, 줄마다 세 칸을 사용합니다. 차례마다 자동으로 굴린 주사위를 배치하거나
        상대 주사위를 공격합니다. 혼자 시작하면 컴퓨터와 대전합니다.
      </p>
      <h3>진행과 주사위</h3>
      <ol className="help-steps">
        <li>
          선공은 무작위로 정합니다. 선공의 첫 주사위는 공격으로 제거되지 않는 실드 주사위입니다.
        </li>
        <li>
          주사위가 멈추면 표시된 줄을 선택하세요. 바뀔 점수를 확인하고 배치 또는 공격을 확정합니다.
        </li>
        <li>
          일반 주사위와 같은 눈의 상대 일반 주사위가 대응 줄에 있으면 그 줄을 공격합니다. 해당 눈의
          일반 주사위를 모두 제거하고 보너스 실드 주사위를 굴립니다.
        </li>
        <li>
          일반 주사위는 내 대응 줄에 빈칸이 있어야 사용할 수 있습니다. 공격에는 굴린 주사위를
          사용하며 내 보드에 배치하지 않습니다.
        </li>
        <li>
          보너스 실드 주사위는 양쪽 보드의 빈칸이 있는 줄에 놓을 수 있습니다. 실드 주사위는 같은
          눈의 공격을 받아도 남습니다.
        </li>
      </ol>
      <h3>줄 점수</h3>
      <p className="help-text">
        줄의 눈을 더합니다. 같은 눈 두 개는 그 눈의 3배, 세 개는 5배입니다. 주사위 종류와 관계없이
        같은 방식으로 계산합니다.
      </p>
      <div className="tika-help-scores">
        <div>
          <span>
            <DieIcon value={4} />
            <DieIcon value={4} />
          </span>
          <strong>4 + 4 → 12점</strong>
        </div>
        <div>
          <span>
            <DieIcon value={4} />
            <DieIcon value={4} />
            <DieIcon value={4} />
          </span>
          <strong>4 + 4 + 4 → 20점</strong>
        </div>
      </div>
      <h3>타짜의 손놀림</h3>
      <p className="help-text">
        경기당 한 번, 배치 전 주사위를 다른 눈으로 다시 굴릴 수 있습니다. 원래 주사위와 새 후보 중
        하나를 직접 고릅니다.
      </p>
      <h3>홀드와 경기 종료</h3>
      <p className="help-text">
        홀드를 선택하면 이번 경기에서 더 이상 주사위를 굴리거나 배치하지 않습니다. 홀드는 취소할 수
        없습니다.
      </p>
      <p className="help-text">
        두 사람이 모두 보드를 채우거나 홀드하면 경기가 끝납니다. 각 줄을 비교해 더 많은 줄에서 이긴
        사람이 승리합니다. 이긴 줄 수가 같으면 총점으로 비교하고, 총점도 같으면 공동 1위입니다.
      </p>
    </div>
  );
}
