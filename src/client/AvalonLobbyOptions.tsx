import {
  AVALON_OPTIONAL_ROLES,
  AVALON_ROLE_LABELS,
  AVALON_ROLE_DESCRIPTIONS,
  getAvalonConfigWarnings,
  getAvalonRoles,
  getAvalonStartIssues,
  type AvalonConfig,
  type AvalonRoomState,
} from '../shared/avalon';
import type { Intent } from '../shared/protocol';

export default function AvalonLobbyOptions({
  room,
  canEdit,
  onIntent,
}: {
  room: AvalonRoomState;
  canEdit: boolean;
  onIntent: (intent: Intent) => void;
}) {
  const issues = getAvalonStartIssues(room.players.length, room.config);
  const roles = issues.length
    ? ['멀린', '암살자', ...room.config.optionalRoles.map((role) => AVALON_ROLE_LABELS[role])]
    : getAvalonRoles(room.players.length, room.config).map((role) => AVALON_ROLE_LABELS[role]);
  const update = (config: AvalonConfig) =>
    onIntent({ type: 'av_config', phaseId: room.phaseId, proposalId: null, config });
  return (
    <section className="avalon-lobby-options" aria-label="아발론 역할과 옵션">
      <h3>역할과 옵션</h3>
      <p>멀린과 암살자는 항상 포함합니다. 역할은 시작할 때 무작위로 배정합니다.</p>
      <div className="avalon-role-options">
        {AVALON_OPTIONAL_ROLES.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              data-testid={`av-option-${role}`}
              disabled={!canEdit}
              checked={room.config.optionalRoles.includes(role)}
              onChange={(event) =>
                update({
                  ...room.config,
                  optionalRoles: event.target.checked
                    ? [...room.config.optionalRoles, role]
                    : room.config.optionalRoles.filter((value) => value !== role),
                })
              }
            />
            <span>
              <strong>{AVALON_ROLE_LABELS[role]}</strong>
              <small>{AVALON_ROLE_DESCRIPTIONS[role]}</small>
            </span>
          </label>
        ))}
      </div>
      <label className="avalon-lady-option">
        <input
          type="checkbox"
          data-testid="av-option-lady"
          disabled={!canEdit}
          checked={room.config.ladyOfLake}
          onChange={(event) => update({ ...room.config, ladyOfLake: event.target.checked })}
        />
        <span>
          <strong>호수의 여인</strong>
          <small>
            2·3·4번째 원정 뒤 한 명의 진영을 비공개로 확인합니다. 승부가 이미 결정된 단계는
            건너뜁니다.
          </small>
        </span>
      </label>
      <p className="avalon-role-roster" data-testid="av-role-config">
        현재 구성: {roles.join(' · ')}
      </p>
      {getAvalonConfigWarnings(room.players.length, room.config).map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      {issues.length > 0 && (
        <ul className="avalon-start-issues" data-testid="av-start-issues">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <p>옵션을 바꾸면 준비 상태가 해제됩니다. 경기 시작 후 역할·좌석·옵션을 변경할 수 없습니다.</p>
    </section>
  );
}
