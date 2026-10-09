# 21차 콘텐츠·미리보기·DNS 공개 계약 검증

실제 코드와 독립 API 기능을 구현했다. H7 수동 파일 교체/보존·공개 배포,
T2 visitor·정식 UI/고객 VM 정책과 인수는 보류한다.

- [contracts](../packages/contracts/src/index.ts): 최초 게시 `@j-web/contracts@0.1.0`.
  사이트/호스팅/계정 원문1회·부분 실패, 콘텐츠/revision·preview·DNS 안내와
  도메인/기술 입력 상한을 공유한다. 배포 실행 DTO는 H7 미승인으로 남는다.
- [ContentStore](../apps/server/src/content.ts)와
  [migration003](../deploy/migrations/003-page-content.sql): tenant/site FK 아래
  PG 콘텐츠를 저장하며 기존 helper와 같은 advisory lock, DB row lock,
  expectedRevision으로 동시/stale 저장을409로 거절한다. 삭제는 FK cascade다.
- UTF8/제어문자·추가 필드와 정적 PNG subset의 CRC/형식/압축 해제 상한을
  검증한다. [정확 입력 규칙](../packages/contracts/README.md)을 따른다.
  이미지 URL/경로·SVG·animation은 받지 않는다. HTML 텍스트를 escape하며
  readonly preview CSP는 script를 차단한다.
- preview에는 가입 무관 고정 gateway의 익명 widget 한 줄이 있다.
  visitor 엔진이나 공개 배포 완료를 뜻하지 않는다.
- [Hosting](../apps/server/src/hosting.ts)은 tenant pagination, 실제 용량/마운트
  결과와 저장 상태/실패 단계를 반환한다. 최대4개씩 usage를 읽는다.
  DNS A/hosts 주소는 제공된 IPv4의 안내이며 DNS 변경/연결 성공 주장 없다.

Node22.18/24.19 각각 check의6 unit+1 helper, integration14/2files,
registry consumer1이 exit0/skip0이다. npm 하위 명령도 해당 Node PATH로
고정했다. 실제 j-auth/Keycloak의 Web aud 회원·권한, PG migration·revision,
다른 tenant404, 동시 저장200/409, 새 API instance의 같은 콘텐츠, 잘못된
로고/필드·byte overflow400을 확인했다. preview/저장 뒤 실제 HTTPS로 SFTP의
수동 index 파일이 동일한 것을 확인했으며 deploy 경로는404다.
계정/FTP/HTTPS 작업은 owned 임시 hosting 컨테이너만 사용했다.

최초 registry 조회404 뒤 승인된 loopback publisher로 첫 버전을 게시했다.
pack SHA512와 fresh exact-version consumer/lock integrity를 두 Node에서 확인했다.
게시 버전을 덮어쓰지 않았다. 첫 TypeScript 검사에서 Node type의 zlib info
결과 선언 누락을 명시 타입으로 보완했다. 실제 두 Node PNG decode가 통과했다.

로그는 `/workspace/.suite-runtime/j-groupware/web-content-{check,integration}-final-node{22,24}`와
`web-content-registry-node{22,24}`의 `.log/.exit`다. BFF와 제품군 진행표는
j-groupware의 별도 실제 회귀 결과로 갱신한다.
실제 시스템 설치·OS account/CA trust/timer·운영 자격/외부 송신은 미실행이다.
시험 컨테이너의 계정/파일만 생성·삭제하며 회사 노트북을 사용하지 않았다.
