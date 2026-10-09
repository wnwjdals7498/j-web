# j-web 기능 명세

작성일: 2026-10-08. 상태: **구현·인수 시험 전**. [목록](features.md), [결정](decisions.md), [공통 기준](../../j-groupware/docs/suite-feature-specifications.md)을 따른다. 고객 서버의 사이트 호스팅과 템플릿 1종 정적 페이지를 제공한다. 화면은 j-groupware다.

## 입력·출력·데이터

| 대상 | 최소 계약 |
| --- | --- |
| 사이트 | tenant·UUID siteId·소문자 RFC1123 도메인·허용 접미사·셋팅 상태·계정 참조·콘텐츠/배포 참조. 도메인 충돌은 409이며 실제 server_name 충돌이 나지 않게 한다. |
| 응답 | 사이트 상태·도메인·용량·디스크 여유, 계정/포트·DNS A 레코드 안내. 계정 비밀번호는 생성/재설정 응답 1회다. |
| 콘텐츠 | 사이트명·소개·연락처·로고. 서버가 입력 검증과 HTML escape 뒤 고정 템플릿으로 만든다. |
| 파일 | 서버가 고정 루트 `/srv/jweb/sites/<siteId>`에서 경로를 계산한다. root 소유 chroot 아래 `public/`만 사이트 계정이 쓴다. `/srv/jweb` 별도 데이터 디스크를 확인한다. |
| helper | `site-create`, `site-delete`, `account-create`, `account-passwd`, `account-delete`, `nginx-apply`, `remove-all`만 허용. UUID·도메인·계정 재검증, 비밀번호 stdin·셸 미사용·환경 제한이다. |

정상 흐름: 도메인 입력 → 권한/중복/접미사/마운트 확인 → helper 디렉터리·계정·Nginx 구성 → `nginx -t` → 사이트 상태·DNS 안내 → 콘텐츠 미리보기 → 원자적 배포 → HTTPS 조회. 실패는 실제 남은 단계/구성을 확인하고 재시도하며 성공 상태로 덮지 않는다.

Nginx 설정은 helper가 고정 템플릿으로 렌더링한다. API가 만든 설정 파일이나 임의 경로·셸 문장을 받지 않는다. 검증 실패는 직전 설정 복구다. 삭제/해지는 계정·사이트 블록 제거와 파일 백업이 포함되며 영구 삭제 기능으로 확대하지 않는다.

## 기능별 계약

| 기능 ID | PMT Item | 입력·정상 동작·출력 | 권한·실패 경계 | 인수 시험 |
| --- | --- | --- | --- | --- |
| WB-01 | H6 | 목록→도메인/상태/사용량/디스크 여유 | web:read, tenant 필터·경로/secret 비노출 | WB-T01 |
| WB-02 | H6 | site 도메인/고객 주소→A 레코드 안내 | DNS 변경 호출 없음·외부 서비스 성공 주장 없음 | WB-T01 |
| WB-03 | H6 | 도메인→디렉터리/계정/Nginx·로컬 CA HTTPS 셋팅 | web:write, 규격 400·중복 409·helper 장애 503 | WB-T02 |
| WB-04 | H6 | siteId→블록/계정 제거·파일 백업 | web:write, 다른 site/tenant 404·실패 시 부분 상태 표시 | WB-T02 |
| WB-05 | H6 | 계정 비밀번호 입력/생성→SFTP/FTPS 계정·원문 1회 | web:write, 인증 저장소 해시·jgw_web 원문 없음 | WB-T03 |
| WB-06 | H6 | site 계정 재설정→새 비밀번호 1회 | web:write, 이전 암호 거절·원문 목록/로그 없음 | WB-T03 |
| WB-07 | H4 | j-web aud token→tenant·web 권한 | 401/403·다른 tenant 404·JWKS 장애 503 | WB-T01 |
| WB-10 | H7 | 필드/로고→검증된 콘텐츠 | web:write, 로고 형식/크기 H2 고정·임의 경로 불가 | WB-T04 |
| WB-11 | H7 | 콘텐츠→HTML escape 미리보기 | web:write, 입력 script 미실행·운영 파일은 아직 불변 | WB-T04 |
| WB-12 | H7 | 현재 저장 revision의 템플릿 index만 원자 교체·직전 managed version·origin 반환 | web:write, 수동/드리프트 index는 409, 임의 파일은 보존, 실패 시 직전 페이지 유지 | WB-T04 |
| WB-13 | H7 | 생성 템플릿→위젯 script 항상 포함 | 가입 무관·정적 사이트 익명·비밀키 없음 | WB-T04 |
| WB-20 | H6 | 고정 하위 명령→검증·특권 작업·Nginx 검사 | sudoers 1파일·임의 명령/경로/환경 주입 거절 | WB-T02 |
| WB-21 | H6 | 별도 server block→site HTTPS 서빙 | gw 블록 분리·로컬 CA/SAN·다른 사이트 자료 접근 불가 | WB-T02 |
| WB-22 | H6 | 별도 sshd·기본 2222→internal-sftp/chroot | 사이트 계정의 shell/forwarding/다른 site 접근 거절 | WB-T03 |
| WB-23 | H5·H6 | 명시 TLS FTPS→site 파일 업로드 | 평문 FTP 거절·패시브 포트/제품 H5 조사 | WB-T03 |
| WB-24 | H6 | 마운트/du→site 용량·데이터 디스크 여유 | 마운트 누락 시 시스템 디스크에 쓰지 않고 실패 표시 | WB-T02 |
| WB-25 | H6 | remove-all→블록 삭제·검사/reload·계정 삭제·백업 | 오류 중단·실제 정리 상태 기록·다른 서비스 보존 | WB-T05 |
| WB-30 | H1 | jgw_web·전용 계정·migration | 모든 업무 표 tenant·다른 DB 접속 거절 | WB-T05 |
| WB-31 | H2 | site/콘텐츠/계정/배포·상태·DNS DTO 게시 | 미정 제품/필드/로고/상태를 소비자와 고정 | WB-T05 |
| WB-32 | H5 | 고정 Compose SFTP/FTPS/Nginx·공유 볼륨 | 로컬 CA·hosts·실제 TLS/업로드 증명 | WB-T03 |
| WB-33 | H9 | VM 실제 Nginx/sshd/FTPS·화면→site 열림 | 출처 등록은 BFF·가입/권한 조건, VM H8 재검증 | WB-T05 |

## 인수 시험

| ID | 관찰할 결과 |
| --- | --- |
| WB-T01 | read/write 권한·사이트 목록/용량·DNS 안내, 직접 쓰기 403·다른 tenant 404·JWKS 장애 503, DNS API 호출 없음. |
| WB-T02 | 정상 사이트 생성·도메인 규격/접미사/중복·helper 명령/UUID/계정/경로 주입 거절, 마운트 누락·nginx -t 실패 복구·부분 실패 재시도, gw 블록과 다른 site 보존. |
| WB-T03 | 실제 SFTP·명시 TLS FTPS 업로드·HTTPS 서빙, 평문 FTP·셸·포워딩·다른 site 거절, 암호 교체·DB/로그/목록 원문 없음. FTPS 제품별 passive 연결도 확인. |
| WB-T04 | script 입력 escape·로고 경계·미리보기 시 운영 파일 불변·원자 deploy/same revision retry/hash drift 거절·기존 수동 index 충돌 보존·직전 managed version 보관·가입 무관 위젯 삽입·정적 페이지 비밀값 없음. |
| WB-T05 | contracts 설치·DB/migration·설치/해지 remove-all·파일 백업, VM 실제 H8·사이트 HTTPS·BFF 출처 등록과 권한 없음 안내. |

## 확정 관문

H2에서 site 상태/부분 실패 응답·endpoint·DTO·로고 MIME/크기·배포 동시성/수동 업로드와 교체 관계·직전 버전 보관 방식을 고정한다. H5에서 공식 자료로 FTPS 제품·local users 연동·패시브 포트를 선택해 helper 계약과 함께 기록한다. 사이트별 quota·실제 인증서 발급·DNS 관리·외부 호스팅·다중 템플릿/페이지·백업/통계 화면은 기존 범위 제외다.
