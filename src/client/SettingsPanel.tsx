import type { Dispatch, SetStateAction } from 'react';
import type { Settings } from './settings';
export default function SettingsPanel({
  settings,
  setSettings,
}: {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
}) {
  return (
    <>
      <div className="settings-list">
        <label>
          <span>
            <strong>전체 음소거</strong>
            <small>효과음과 배경 음악을 끕니다.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.muted}
            onChange={(event) =>
              setSettings((value) => ({ ...value, muted: event.target.checked }))
            }
          />
        </label>
        <label>
          <span>
            <strong>효과음</strong>
            <small>게임 동작과 버튼 소리</small>
          </span>
          <input
            aria-label="효과음 볼륨"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.sfx}
            onChange={(event) =>
              setSettings((value) => ({ ...value, sfx: Number(event.target.value) }))
            }
          />
        </label>
        <label>
          <span>
            <strong>배경 음악</strong>
            <small>로비와 게임에서 재생되는 음악</small>
          </span>
          <input
            aria-label="배경 음악 볼륨"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.music}
            onChange={(event) =>
              setSettings((value) => ({ ...value, music: Number(event.target.value) }))
            }
          />
        </label>
        <label>
          <span>
            <strong>효과 줄이기</strong>
            <small>주사위와 카메라의 움직임을 줄입니다.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(event) =>
              setSettings((value) => ({ ...value, reducedMotion: event.target.checked }))
            }
          />
        </label>
      </div>
      <p className="modal-note">설정은 모든 게임에 적용되며 이 브라우저에 저장됩니다.</p>
    </>
  );
}
