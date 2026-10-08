# 웹 DB·회원 조회·데이터 디스크 검사

실행일 2026-10-08. WB-30의 전용 DB 기반을 구현했고 WB-07·WB-24는 일부 구현이다. 실제 사이트 생성·계정·helper·SFTP/FTPS·템플릿 배포를 완료로 처리하지 않는다. `@j-web/contracts` 0.1.0은 저장소 안의 조회 기반 계약이며 미게시다.

jgw_web 전용 non-superuser, tenant_id 업무 표, 전역 domain unique, UUID siteId·상태 enum, parameter query, checksum migration 및 transaction/advisory lock을 사용한다. 실제 DB 권한과 postgres DB 접속 거절, migration checksum 변조 탐지·rollback을 검증한다.

`GET /web/sites`는 UUID after/next·최대 100개 페이지와 id/domain/state를 반환하고 `GET /web/sites/:id`는 자기 tenant만 읽는다. 실제 j-web 단일 aud·고객 tenant·azp=j-groupware·sid·회원 이름을 검증한다. web:read 회원과 web:write 복합 role 회원은 조회 가능, 권한 없는 회원은 403, 다른 tenant JWT/다중 aud/쿠키/위조 token은 401, 다른 tenant siteId는 404다. tenant/source query 주입은 400이다. POST 사이트 생성은 아직 제공하지 않아 404이며 web:write의 실제 변경 경로는 남아 있다. 테스트가 DB에 만든 site row를 읽은 것은 호스팅 셋팅 완료를 뜻하지 않는다.

`disk.ts`는 고정 `/srv/jweb`의 symlink, 실제 mountinfo·device·writable 여부를 확인하고 statfs 용량·여유를 반환한다. 시스템 filesystem bind, tmpfs, readonly·중복 mount를 거절한다. ext4/xfs/btrfs의 filesystem 루트에 직접 붙인 별도 디스크만 허용한다. `npm run disk:probe`는 인자를 받지 않고 마운트·쓰기 없이 검사한다. cloud에 별도 데이터 디스크가 없는 실제 실패 경로를 검증했다. mount parser의 성공 경로는 명시적인 unit fixture이며 실제 20GB 디스크 인수 증거가 아니다. site별 du와 helper 쓰기 전 연동은 미구현이다.

`npm ci --ignore-scripts` → `npm run check`. 실제 시험은 checkout 밖 JW_TEST_ENV/JAUTH_TEST_ENV와 isolated-cloud marker가 필요하다. JW의 TENANT, DB_HOST/DB_PORT/DB_PASSWORD, PORT, TLS_CERTIFICATE/TLS_KEY 및 KC_PUBLIC_URL을 외부 env에 지정한다. 운영 env에 Keycloak master 자격을 넣지 않는다. main은 loopback HTTPS다. cloud DB 55046, test HTTP 55047/55051에서 S12 실제 j-auth API 고객·가입·회원 및 Code/PKCE→축소 token으로 검증한다. 실제 DB stop/start 중 503·데이터 보존, 새 verifier의 실제 JWKS 연결 실패 503을 검사했다. 최종 Node 22.18.0·24.19.0 증거는 `.suite-runtime/j-web/membership-node{22,24}-final-results.json`이다.

기술 근거: [node-postgres pool](https://node-postgres.com/apis/pool), [Fastify JSON schema](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/). H2·H5의 endpoint·입력·상태·FTPS/helper 선택은 구현자 작업이다. 수동 SFTP 파일과 템플릿 배포의 덮어쓰기 경계(WB-12)는 제품 정책으로 남겼다. WB-20은 H5 실제 호스팅 fixture와 root helper의 실패/rollback 계약이 선행이며 운영 호스트에 설치하지 않았다.

최종 결과: Node 22.18.0·24.19.0 실제 integration 각각 7/7, skip 0, runner exit 0. `npm run check`의 build·typecheck·unit 2개·lint·format도 통과했다. 별도 디스크 없음의 실제 거절과 unit의 mount parser 결과를 구별했다. 형제 BFF와 충돌했던 최초 54246 DB port를 55046으로 옮겨 전용 volume을 보존하고, 최종 55046/55047/55051 구성에서 재검증했다.
