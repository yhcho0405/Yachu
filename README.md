# 다이스 아틀리에 · Dice Atelier

가입 없이 친구와 즐기는 1–4인 온라인 야추. Three.js로 만든 주사위와 테이블, 한국어 점수판, 저장되는 경기와 재접속을 제공합니다.

## 로컬 실행

Node.js 24 이상과 npm을 설치한 뒤:

```sh
npm ci
npx playwright install chromium firefox
npm run dev
```

http://127.0.0.1:8787 에서 플레이합니다. `dev` 한 명령은 클라이언트를 빌드하고 **실제 Wrangler/workerd의 Workers와 SQLite Durable Objects**를 함께 실행합니다. 코드 수정 후 명령을 다시 실행하면 클라이언트도 갱신됩니다. Worker 수정은 Wrangler가 감지합니다. 개발 전용 `.dev.vars`는 최초 실행 시 암호학적 난수로 생성되며 Git에서 제외됩니다. 운영 Secret은 로컬 실행에 필요하지 않습니다.

## 검사

```sh
npm run check             # TypeScript + ESLint + 규칙/상태/SQLite 단위 검사
npm run build             # 동일 커밋 번호의 클라이언트와 /version.json
npm run build:worker      # Wrangler 실제 Worker 번들 확인, 업로드 없음
npm run test:e2e          # 로컬 Wrangler + 독립 브라우저 실제 게임
npm run test:persistence  # 실제 workerd 중지/재시작 후 복구
```

브라우저 테스트는 Chromium의 독립 쿠키 컨텍스트로 1/2/3/4인 전체 경기와 재경기를 실행하고, Firefox에서도 360px 화면과 게임 조작을 확인합니다. `PLAYWRIGHT_BASE_URL`을 배포 URL로 지정하면 동일한 정상 사용자 흐름을 실서비스에서 검증합니다. `EXPECTED_COMMIT`으로 서버와 정적 클라이언트의 배포 커밋을 확인합니다. 테스트에는 운영 인증 우회/강제 주사위 API가 없습니다. 테스트 보고서에 인증 쿠키가 남지 않도록 trace와 HAR를 기록하지 않습니다.

## 구성

- `src/client`: React HTML UI, 순차 요청 큐와 복구, Three.js 장면, Web Audio.
- `src/shared`: 12개 규칙 항목, 스냅샷/명령 타입, 주사위 방향 수학.
- `src/server`: Worker 라우팅, 세션 Registry, 방별 GameRoom, SQLite 원자 저장, 권위 게임 엔진.
- `wrangler.jsonc`: 인프라 설정의 유일한 원본. Worker `dice-atelier`, Static Assets, `GameRoom`/`SessionRegistry` SQLite 마이그레이션.
- `.github/workflows/deploy.yml`: PR 검사와 main 검증/자동 배포/실서비스 브라우저 검사.

클라이언트·API·WebSocket은 같은 `workers.dev` 출처입니다. 상대 경로와 현재 출처에서 계산한 WebSocket URL을 사용합니다. Pages, 외부 DB, D1, KV, 제3자 쿠키는 사용하지 않습니다.

## 게임

각 턴에 다섯 주사위를 최대 3번 굴립니다. 1–5 키 또는 주사위/숫자 버튼으로 보관합니다. 사용하지 않은 항목을 선택한 뒤 점수를 확정합니다. 0점은 별도 확인이 필요합니다. 에이스~식스 합이 63이면 보너스35; 풀하우스는 같은 눈5개도 인정; 스몰15·라지30·야추50. 12개 항목을 마치면 순위를 표시하며 동점은 공동 순위입니다. 이 규칙의 최고점은325입니다.

3~4인과 재접속 정책은 이 프로젝트의 확장입니다. 임의의 턴 제한은 없습니다. 경기 중 연결이 끊긴 시간은 **한 경기 전체에서 누적120초**까지 허용하고 재접속으로 초기화하지 않습니다. 명시적인 퇴장은 즉시 기권이며 로비 방장은 남은 참가자에게 위임합니다. 로비 연결 끊김은120초 대기 후 자리에서 나갑니다. 모든 참가자가 나간 방은 짧은 정리 유예 뒤 삭제됩니다. 자세한 수명과 복구 정책은 [서버 문서](docs/server.md)를 참고하세요.

## 배포

`main` push가 유일한 운영 배포 경로입니다. 등록된 GitHub Actions Secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `SESSION_SECRET`을 배포 단계에만 전달합니다. PR 코드에는 운영 비밀을 제공하지 않습니다.

Wrangler `--secrets-file`의 공식 동시 업로드 기능으로 Worker 코드와 `SESSION_SECRET` 런타임 비밀을 한 번에 배포합니다. 비밀 파일은 OS 임시 디렉터리에0600 권한으로 만들고 즉시 삭제합니다. 값은 소스/vars/VITE 변수/아티팩트에 들어가지 않습니다. 서버는 Secret이 없거나32자보다 짧으면 인증을 생략하지 않고503을 반환합니다.

검사에 실패하면 배포하지 않으며, 배포 후 브라우저 검사가 실패하면 Actions도 실패합니다. main 작업은 직렬화하고 배포 직전에 최신main SHA를 확인합니다. 검사한 체크아웃 그대로 배포합니다. 계정의 Cloudflare Git 연동을 추가로 켜지 마세요.

자세한 운영/복구는 [배포 문서](docs/deployment.md), 실제 수행 결과는 [검증 기록](docs/verification.md), 원작 관찰은 [참고 자료](docs/references.md), 직접 제작 자산과 라이선스는 [자산 문서](docs/assets.md)를 참고하세요.
