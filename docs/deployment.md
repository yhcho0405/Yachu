# 배포·업데이트·복구

## 운영 배포

GitHub Actions의 main push만 사용한다. 등록된 세 Secrets의 값을 로컬에서 조회할 필요가 없다. Actions는 고정 SHA의 공식checkout/setup-node/upload-artifact를 사용하며 contents:read만 요청한다. 운영 배포 실행은 충돌하지 않게 직렬화하고, 배포 직전에main 최신 SHA와 현재SHA를 비교한다. 더 오래된 커밋이면 배포 전에 실패한다.

1. npm ci → 타입/정적/단위 검사.
2. 클라이언트와 Worker를 같은 Git SHA로 빌드한다.
3. 최신 main SHA 확인 후 wrangler deploy로 올린다. --secrets-file로 기존 SESSION_SECRET을 같은 업로드의 런타임 비밀로 전달한다. 임시파일은 출력하지 않고 finally에서 삭제한다.
4. Wrangler가 출력한 workers.dev URL에서 서버·클라이언트 버전 일치와 HTML 진입점을 확인한다. 빌드된 모든 JS/CSS 청크, 썸네일3개와 BGM7개를 병렬 HEAD 요청으로 검사한다. HTTP 상태와 Content-Type을 함께 확인하여 SPA 대체 응답을 성공으로 오인하지 않는다.
5. Actions 요약에 URL/SHA/상태를 기록하고 인증 정보 없는 공개 점검 보고서를7일 보관한다.

2026-09-07 사용자의 요청에 따라 개발에서 완료한 전체 경기·영상 캡처·재시작 검사를 매 운영 배포에서 반복하지 않는다. main 배포 작업의 최대 시간은15분이며 브라우저 설치도 생략한다. 빠른 기본 검사와 빌드가 실패하면 배포하지 않고, 배포 후 공개 점검 실패도 Actions 실패로 기록한다.

전체 검증은 개발 명령, PR 및 Actions의 Run workflow 수동 실행에 유지한다. 이 경로는 운영 배포와 Secrets 사용 없이 같은 Wrangler 설정의 실제 workerd에서 Chromium 야추1~4인·티카투카2인/컴퓨터·아발론5/10인 전체 경기와 재경기, 게임 전환·격리, Firefox UI, 아발론 수신자별 정보 경계 및 세 게임의 실제 프로세스 재시작 복구를 검사한다. 전체 작업75분·개별 경기10분·조작15초·재시도0 제한은 이 개발 검증에만 적용한다. main에서 생략된 전체 검사를 통과로 집계하지 않는다.

CLOUDFLARE_API_TOKEN과 계정ID는 Worker 런타임으로 전달하지 않는다. SESSION_SECRET은 배포마다 바꾸지 않는다. 기존 비밀과 Durable Object 바인딩/마이그레이션을 보존한다. 실제값 없는 예시는 루트.env.example에만 둔다.

일반 개발 명령 `npm run dev`는 Wrangler CLI를 사용한다. CI 브라우저 서버 `npm run dev:ci`는 이미 빌드한 클라이언트와 Wrangler dry-run Worker 번들을 읽는다. 루트 Wrangler 설정을 공식 SDK 도우미로 변환하고, 잠금 파일에 고정된 Wrangler 자신의 Miniflare/workerd를 실행한다. 정적 자산 라우팅·헤더, API, WebSocket, SQLite Durable Objects는 모두 실제 workerd 안에서 처리한다. 별도 Node.js 게임 서버나 독립 인프라 설정은 없다. Wrangler 개발 프록시의 CI 종료 문제를 피하기 위한 실행 방식이며 [경위와 검증 기록](verification.md#ci-실행-중-확인한-문제)을 남겼다.

## 비용과 한도

2026-09-06 17:18 KST에 로그인된 Cloudflare 대시보드의 Workers plans 화면에서 **Free / Current plan**을 직접 확인했다. 플랜이나 결제 설정을 변경하지 않았다. Cloudflare 공식 문서(2026-09-06 조회)는 SQLite-backed Durable Objects의 Workers Free 사용을 지원한다. 무료 한도와 초과 시 동작은 계정 플랜에 의존하며 무제한 서비스를 뜻하지 않는다. 앱은 상시타이머 없이 WebSocket Hibernation/Alarm, DPR 상한과 정적자산 직접 제공을 사용한다. Registry는 작은 친구 모임을 위한 단일객체이며 대규모공개서비스의 병목이 될 수 있다. 유료플랜/결제설정은 이 프로젝트에서 변경하지 않는다. 대시보드에 표시된 Free 한도는 Workers 요청 100,000회/일과 CPU 10ms/요청, Durable Objects 요청 100,000회/일·13,000 GB-s/일·SQL 읽기 5,000,000행/일·쓰기 100,000행/일·저장 5GB다. 이 값은 당시 표시된 계정 플랜의 한도이며, 미래의 잔여량을 보장하지 않는다. 같은 날 17:19 KST 배포 전 Workers & Pages 화면은 프로젝트 없음, 당일 요청 0/100,000, CPU 0ms로 표시했다. 공개 서비스로 확대하기 전 사용량을 확인해야 한다.

## 업데이트와 복구

- 변경을검증한 뒤 main에 반영한다. DO 클래스이름이나 v1 마이그레이션을 재작성하지 않는다. 스키마 변경은 추가마이그레이션과 이전상태 읽기 지원으로 진행한다.
- /api/health와/version.json의commit이 같은지 확인한다. API는no-store다. SPA 직접링크도 동작하고 /api/*는SPA로 내려가지 않는다.
- 오류가 생기면 Actions로그의 실패단계를 확인한다. 토큰/쿠키/환경변수 전체를 로그에출력하지 않는다.
- 일반 코드복구는 저장 형식을 읽을 수 있는 수정 커밋을main에 반영하여 같은검증과배포경로로 수행한다. SQLite는 유지하고 DO 마이그레이션은 되돌리지 않는다. 멀티게임 형식2 저장 후에는 이를 모르는 야추 전용 cdf76f0 코드로 그대로 복귀하면 안 된다. 문제 기능을 수정하거나 노출을 제한하더라도 형식2와 기존 야추 읽기 지원을 유지한다.
- Cloudflare PITR을 이용한 저장소복원은 현재경기를 되돌릴 수 있는 운영작업이므로 정상코드롤백과 구별한다. 복구시점과 영향방을 확인한 뒤 계정관리자가 수행한다.
- 아발론 저장 이후에는 해당 내부 역할·제출 구조를 읽을 수 있는 코드를 유지한다. 아발론을 모르는 `11ff82f` 이전 코드를 일반 복구 대상으로 사용하지 않는다. 아발론 저장 검증과 수신자별 투영을 유지하는 수정 커밋으로 복구한다.
- 세션비밀 교체는 모든기존자격증명 복구를 막으므로 사건대응이 필요할 때만 계획한다. 평상시배포는 기존값을 유지한다.

## 공식 근거

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static Assets 보안 헤더](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Secrets: 코드와 비밀 동시 업로드](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub Actions 배포](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [SQLite transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Objects 요금과 무료한도](https://developers.cloudflare.com/durable-objects/platform/pricing/)

## 기존 경기의 배포 호환성

배포 전에 기존 클라이언트로 야추 방을 열어 자리·경기 ID·점수·눈을 기록하고 연결을 유지한다. 새 버전 배포 후 같은 방에서 기존 명령을 확인하고, 새로고침 후 같은 세션과 자리가 유지되는지 확인한다. 이를 로컬 fixture 검사만으로 운영 배포에서 확인했다고 표현하지 않는다. 수행한 실제 결과·커밋·Actions 링크는 검증 기록에 남긴다.

원작 대조가 끝나지 않은 티카투카 규칙은 문서의 미확정 상태를 유지한다. CI 통과가 원작 전체 규칙 확인을 대신하지 않는다.
