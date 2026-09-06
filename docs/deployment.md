# 배포·업데이트·복구

## 운영 배포

GitHub Actions의 main push만 사용한다. 등록된 세 Secrets의 값을 로컬에서 조회할 필요가 없다. Actions는 고정 SHA의 공식checkout/setup-node/upload-artifact를 사용하며 contents:read만 요청한다. 운영 배포 실행은 충돌하지 않게 직렬화하고, 배포 직전에main 최신 SHA와 현재SHA를 비교한다. 더 오래된 커밋이면 배포 전에 실패한다.

1. npm ci → 타입/정적/단위 검사.
2. 같은 `wrangler.jsonc`에서 파생한 실제 workerd 로컬 서버에서 Chromium 1~4인 전 경기 및 Firefox UI 검사.
3. 실제 workerd 재시작 후 세션/턴/주사위/중복처리 복구 검사.
4. 빌드한 클라이언트와 Worker에 같은Git SHA를 넣는다. 이 검사된 코드를 wrangler deploy로 올린다.
5. --secrets-file로 SESSION_SECRET을 같은 업로드의 런타임비밀로 전달한다. 파일을 출력하지 않으며 임시파일은 finally에서 삭제한다.
6. Wrangler가 출력한 workers.dev URL에서 동일한 정상 사용자 브라우저 검사를 재실행한다.
7. Actions요약에 URL/SHA/상태를 기록하고 쿠키 없는 스크린샷과 보고서를7일 보관한다.

CLOUDFLARE_API_TOKEN과 계정ID는 Worker 런타임으로 전달하지 않는다. SESSION_SECRET은 배포마다 바꾸지 않는다. 기존 비밀과 Durable Object 바인딩/마이그레이션을 보존한다. 실제값 없는 예시는 루트.env.example에만 둔다.

일반 개발 명령 `npm run dev`는 Wrangler CLI를 사용한다. CI 브라우저 서버 `npm run dev:ci`는 이미 빌드한 클라이언트와 Wrangler dry-run Worker 번들을 읽는다. 루트 Wrangler 설정을 공식 SDK 도우미로 변환하고, 잠금 파일에 고정된 Wrangler 자신의 Miniflare/workerd를 실행한다. 정적 자산 라우팅·헤더, API, WebSocket, SQLite Durable Objects는 모두 실제 workerd 안에서 처리한다. 별도 Node.js 게임 서버나 독립 인프라 설정은 없다. Wrangler 개발 프록시의 CI 종료 문제를 피하기 위한 실행 방식이며 [경위와 검증 기록](verification.md#ci-실행-중-확인한-문제)을 남겼다.

## 비용과 한도

2026-09-06 17:18 KST에 로그인된 Cloudflare 대시보드의 Workers plans 화면에서 **Free / Current plan**을 직접 확인했다. 플랜이나 결제 설정을 변경하지 않았다. Cloudflare 공식 문서(2026-09-06 조회)는 SQLite-backed Durable Objects의 Workers Free 사용을 지원한다. 무료 한도와 초과 시 동작은 계정 플랜에 의존하며 무제한 서비스를 뜻하지 않는다. 앱은 상시타이머 없이 WebSocket Hibernation/Alarm, DPR 상한과 정적자산 직접 제공을 사용한다. Registry는 작은 친구 모임을 위한 단일객체이며 대규모공개서비스의 병목이 될 수 있다. 유료플랜/결제설정은 이 프로젝트에서 변경하지 않는다. 대시보드에 표시된 Free 한도는 Workers 요청 100,000회/일과 CPU 10ms/요청, Durable Objects 요청 100,000회/일·13,000 GB-s/일·SQL 읽기 5,000,000행/일·쓰기 100,000행/일·저장 5GB다. 이 값은 당시 표시된 계정 플랜의 한도이며, 미래의 잔여량을 보장하지 않는다. 같은 날 17:19 KST 배포 전 Workers & Pages 화면은 프로젝트 없음, 당일 요청 0/100,000, CPU 0ms로 표시했다. 공개 서비스로 확대하기 전 사용량을 확인해야 한다.

## 업데이트와 복구

- 변경을검증한 뒤 main에 반영한다. DO 클래스이름이나 v1 마이그레이션을 재작성하지 않는다. 스키마 변경은 추가마이그레이션과 이전상태 읽기 지원으로 진행한다.
- /api/health와/version.json의commit이 같은지 확인한다. API는no-store다. SPA 직접링크도 동작하고 /api/*는SPA로 내려가지 않는다.
- 오류가 생기면 Actions로그의 실패단계를 확인한다. 토큰/쿠키/환경변수 전체를 로그에출력하지 않는다.
- 일반 코드복구는 이전정상커밋의 변경을되돌리는 새커밋을main에 반영하여 같은검증과배포경로로 수행한다. SQLite는 유지한다. DO 마이그레이션은 되돌리지 않는다.
- Cloudflare PITR을 이용한 저장소복원은 현재경기를 되돌릴 수 있는 운영작업이므로 정상코드롤백과 구별한다. 복구시점과 영향방을 확인한 뒤 계정관리자가 수행한다.
- 세션비밀 교체는 모든기존자격증명 복구를 막으므로 사건대응이 필요할 때만 계획한다. 평상시배포는 기존값을 유지한다.

## 공식 근거

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static Assets 보안 헤더](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Secrets: 코드와 비밀 동시 업로드](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub Actions 배포](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [SQLite transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Objects 요금과 무료한도](https://developers.cloudflare.com/durable-objects/platform/pricing/)
