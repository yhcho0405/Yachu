import { appendFileSync } from 'node:fs';
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `\n### 검증 결과\n- 상태: ${process.env.JOB_STATUS}\n- 커밋: ${process.env.GITHUB_SHA}\n- 로컬 브라우저 검사: ${process.env.LOCAL_BROWSER || 'skipped'}\n- 실제 프로세스 재시작 검사: ${process.env.PERSISTENCE || 'skipped'}\n- 배포 후 브라우저 검사: ${process.env.LIVE_BROWSER || 'skipped'}\n- 검사 구성: Chromium (1/2/3/4인 전체 경기, 재경기, 복구), Firefox (모바일 레이아웃 및 기본 흐름)\n- 증빙: 이 실행의 local-browser-results 및 live-browser-results 아티팩트.\n- 쿠키, 인증 헤더 및 운영 Secret 노출을 막기 위해 Playwright trace/HAR는 저장하지 않습니다.\n`,
  );
