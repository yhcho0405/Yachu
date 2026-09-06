# 개발 기록

2026-09-06: 두 사용자 명세를 확인. 빈 yhcho0405/Yachu 저장소를 복제했고 규칙/보호 설정이 없는 초기 main 상태임을 확인했다. GitHub Actions Secret 3개의 이름만 확인했으며 값을 조회하거나 복사하지 않았다.

구조: React/Vite/Three.js 클라이언트, 동일 출처 Worker API + Static Assets, GameRoom/SessionRegistry SQLite Durable Objects. 계약은 src/shared/protocol.ts. 원본 인프라 설정은 wrangler.jsonc 하나다. Pages/D1/KV는 사용하지 않는다.

병렬 작업: UI·네트워크, 3D·오디오·참고자료, 서버·규칙·영속성. 루트 작업은 통합/브라우저 검사와 CI 배포.

실행 방법(작성 중): npm ci, npm run check, npm run dev, npm run test:e2e. 브라우저 테스트는 실제 wrangler dev를 띄운다. 생산 비밀값 없이 빌드/테스트한다. 자세한 수행 결과는 검증 완료 후 docs/verification.md에 기록한다.

16:17 KST: 실제 wrangler dev127.0.0.1:8787 기동. scripts/persistence.mjs의 독립workerd 재시작 검증이 통과했다. 쿠키 세션과 좌석, 주사위, 턴, 버전, 동일requestId의 원본응답이 디스크에서 복구됨을 확인했다. 그래픽 초기스크린샷의 펠트가림과보관면높이 결함을수정했다. UI 최종CSS를 기다리는 동안 임시기본CSS로 런타임검사를 시작했다(최종납품용아님).

17:02 KST: 전체 브라우저 검사10개(독립1~4인 전 경기·재경기, 모바일Chromium/Firefox, 복구, 로컬권한)373.6초에 모두 통과. 타입/린트/28개 단위검사 및 클라이언트 큐 회귀도 통과. 최종UI 스타일/가독성, 저성능그래픽 초기화, 세션·방 만료UI를 마감하고 코드 형식을 정리했다. 배포용main 반영과 실제GitHub Actions/운영브라우저 검증이 다음 단계다. 코드와임시데이터, 생성된버전파일, 실제비밀값은Git제외정책으로 구분했다.
