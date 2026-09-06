import { appendFileSync } from 'node:fs';
const production = process.env.GITHUB_EVENT_NAME === 'push';
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `\n### 검증 결과\n- 상태: ${process.env.JOB_STATUS}\n- 커밋: ${process.env.GITHUB_SHA}\n- 실행 경로: ${production ? '운영 빠른 배포' : '개발 전체 검증 (배포 없음)'}\n- 로컬 브라우저 검사: ${process.env.LOCAL_BROWSER || 'skipped'}\n- 실제 프로세스 재시작 검사: ${process.env.PERSISTENCE || 'skipped'}\n- 운영 버전·자산 확인: ${process.env.LIVE_SMOKE || 'skipped'}\n- main은 타입·정적·단위 검사와 빌드 후 배포하고 서버/클라이언트 SHA, 화면 진입점, 게임 청크·썸네일·BGM을 확인합니다.\n- 전체 경기·재경기·복구·브라우저 캡처는 개발 과정 및 PR/수동 실행에서 수행하며 운영 배포마다 반복하지 않습니다. skipped는 통과를 뜻하지 않습니다.\n- 증빙: 실행 경로에 따라 local-browser-results 또는 live-smoke-results 아티팩트.\n- 쿠키, 인증 헤더 및 운영 Secret을 기록하지 않습니다.\n`,
  );
