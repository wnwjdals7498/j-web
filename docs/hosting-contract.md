# H2 호스팅 하위 계약

2026-10-09. 사이트 설치와 독립 콘텐츠/readonly preview 계약이다. 내부 j-web API이며 정식 화면은 별도 구현이다. 모든 변경은 실제 j-web 단일 aud 회원 Bearer와 `web:write`, 조회는 `web:read`를 요구한다. 브라우저 cookie를 직접 받지 않는다.

| 경로 | 입력과 결과 |
| --- | --- |
| POST `/web/sites` | `{domain,password?}` → 201 `{id,domain,state:active,account,password}`. 암호 생략 시 난수 생성. 도메인 충돌 409. |
| GET `/web/sites/:id/hosting` | 상태·계정·실제 단계/오류·du bytes·데이터 디스크 bytes·HTTPS origin·SFTP/FTPS 포트·DNS A 안내. 암호 없음. 고객 IPv4 미설정이면 안내 address는 null. 실제 DNS 변경 호출 없음. |
| POST `/web/sites/:id/retry` | `{password?}` → 동일 id의 실패한 생성 작업 재시도·새 암호 1회. active·삭제 중·관리하지 않는 기존 행은 409. |
| POST `/web/sites/:id/account-password` | `{password?}` → `{id,account,password}`. 실제 OS 암호 교체 후 200. |
| DELETE `/web/sites/:id` | 실제 helper 블록·계정 제거·파일 백업 뒤 `{id,backupId}`. 성공 전 DB 행 삭제 없음. |

별도 마운트 확인 뒤 DB에 생성 의도를 먼저 기록한다. helper 실패는 503 `{code,message,requestId,siteId,phase}`이며 같은 id를 보존한다. DB의 단계는 `site_create/account_create/nginx_apply/active/delete`, 상태는 기존 creating/active/deleting/failed다. 암호나 stdout/stderr를 DB·로그·오류에 저장하지 않는다. DB 연결의 사이트별 advisory lock은 여러 프로세스의 같은 사이트 변경을 직렬화한다. helper 잠금은 실제 OS 작업을 한 번에 하나만 허용한다.

도메인은 소문자 RFC1123·고정 접미사, 계정명은 UUID에서 계산한 `jw-` 이름이다. API는 임의 계정·tenant·경로·Nginx 설정을 받지 않는다. 다른 tenant/없는 id는 쓰기에도 404다. contracts 0.1.0은 최초 loopback registry에 게시하고 exact consumer/integrity를 확인했다. [콘텐츠 입력·미리보기·DNS 계약과 검증](cloud-content-contract-verification-2026-10-09.md)을 따른다. H7 공개 배포/수동 업로드 교체·보존 정책은 결정하지 않았다.
