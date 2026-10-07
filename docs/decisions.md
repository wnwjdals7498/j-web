# j-web 설계 결정

j-web만의 설계 결정을 적는다. 제품군 공통 결정은 [`j-groupware/docs/architecture.md`](https://github.com/wnwjdals7498/j-groupware/blob/main/docs/architecture.md)(이하 architecture.md)의 S 번호를 따르고 여기서는 링크만 한다. PMT는 통합 project `j-groupware-suite`의 분류 `j-web`에 같은 번호로 기록한다(S16).

정리일: 2026-10-07. 통합 정리에서 결정을 번호 순서로 다시 배열하고 결정 13을 확정했다. 번호는 바뀌지 않았다.

## 0. 범위

- **범위:**
  - 고객 서버의 선택 서비스(API + `jgw_web`)다.
  - 고객이 j-groupware "웹 관리" 메뉴에서 도메인을 입력하면, 고객 서버에 그룹웨어와 분리된 사이트 호스팅을 셋팅한다: 사이트 디렉터리, Nginx 사이트 블록, SFTP/FTPS 계정.
  - 고정 템플릿 1종으로 만든 정적 페이지를 배포한다. 고객은 사이트 계정으로 파일을 직접 올릴 수도 있다.
  - 모든 사이트 페이지에는 상담 위젯 스니펫이 들어간다. j-talk에 가입한 고객은 사이트 출처가 허용 출처로 등록된다(architecture.md S7).
- **범위 밖:** 카페24 등 외부 호스팅 업로드(결정 2), DNS 관리(결정 3).
- **완료 기준:**
  - `web:write`를 가진 하위 회원이 도메인을 입력하면 사이트 호스팅이 셋팅되고, 템플릿 페이지가 배포되어 그 도메인(hosts 등록)으로 HTTPS에 열린다.
  - 사이트 계정으로 SFTP·FTPS 업로드가 되고, 평문 FTP와 다른 사이트 접근은 거부된다.
  - j-talk 가입 고객은 허용 출처 등록까지 된다. DNS는 안내만 한다.
- **배치:**
  - j-web API는 내부 포트로만 열고 j-groupware가 중계한다.
  - 사이트는 같은 Nginx의 별도 server 블록으로, 사이트 계정은 별도 sshd 인스턴스·FTPS로 연다(S6).
- **관련 공통 결정:** S2(서비스·DB), S3(권한), S4(토큰 전달), S5(화면), S6(외부 진입·관리 SSH 분리), S7(위젯), S12~S14.

## 1. 서비스 형태와 호스팅

### 결정 1. 서비스 형태와 화면
- **결정 (사용자):** j-web은 선택 서비스다. 화면은 j-groupware "웹 관리" 메뉴이고(j-groupware 결정 14), 카페24 웹호스팅 관리 화면을 참조한다. j-web은 API만 만든다(S5).

### 결정 2. 호스팅 제공 범위
- **결정 (사용자):** j-web이 웹 호스팅을 직접 제공한다. 카페24 등 외부 호스팅 업로드는 하지 않는다(backlog가 아니라 범위 제외).
- **이유:** 외부 호스팅 계정·비밀번호를 받아 보관하는 문제가 사라진다.

### 결정 3. DNS 별도 관리
- **결정 (사용자):**
  - j-web은 DNS 레코드를 만들거나 바꾸지 않는다.
  - 웹 관리 화면과 API 응답에 연결할 레코드(사이트 도메인 A 레코드 → 고객 서버 주소)와 "DNS는 등록처·DNS 서비스에서 별도 관리" 안내를 적는다.
  - 로컬·VM 검증은 hosts로 대신한다.

### 결정 4. 호스팅 위치
- **결정 (사용자):**
  - 고객 서버 안에 둔다.
  - 같은 Nginx에서 `gw.<tenant>` 블록과 분리된 사이트 server 블록(server_name = 사이트 도메인)을 `/etc/nginx/jweb.d/`에 둔다. include는 j-groupware 기본 설정에 있다(j-groupware 결정 8).
  - 사이트 파일과 계정은 그룹웨어 데이터와 분리한 사이트 디렉터리(`/srv/jweb/sites/<siteId>`)에 둔다.
- **이유:** 추가 서버 없이 서비스 가입 모델을 따르고, 사이트가 그룹웨어 데이터와 분리된다.

### 결정 5. 파일 접근 프로토콜
- **결정 (사용자):**
  - 사이트 계정은 SFTP(OpenSSH chroot)가 기본이다. FTP 클라이언트용으로 FTPS(명시적 TLS)를 두고, 평문 FTP는 거부한다.
  - **사이트용 sshd 분리 (보안, S6):**
    - 사이트 SFTP는 운영자 SSH와 다른 sshd 인스턴스(`sshd-jweb.service`, 별도 설정 파일·포트, 기본 2222, 설정 가능)로 띄운다.
    - 설정: `Match Group jweb-sftp`, `ForceCommand internal-sftp`, `ChrootDirectory`. 터널링·포워딩·셸은 금지하고 비밀번호 인증은 이 인스턴스에서만 허용한다.
    - 운영자 sshd는 키 인증만 쓰고 방화벽에서 운영자 출처로 제한한다.
  - FTPS 서버 제품(vsftpd·pure-ftpd 등)과 패시브 포트 범위는 H5에서 공식 문서로 조사해 정한다.
  - j-web 자신의 템플릿 배포는 같은 서버의 로컬 파일 쓰기다.

### 결정 6. 사이트 계정 비밀번호 보관
- **결정 (사용자):**
  - 비밀번호는 화면에서 입력하거나 생성한다. SFTP/FTPS 인증 저장소에 해시만 둔다.
  - `jgw_web`에는 원문이나 복호화할 수 있는 값을 저장하지 않는다.
  - 원문은 생성·재설정 응답에서 1회만 보여 주고 로그에 남기지 않는다. 잊으면 `web:write` 보유자가 재설정한다.

### 결정 7. 테스트 호스팅
- **결정 (사용자):**
  - 로컬에서는 버전 고정 Docker Compose로 SFTP·FTPS 서버와, 같은 볼륨을 서빙하는 Nginx를 띄워 고객 서버 호스팅 구성을 재현한다.
  - 테스트 도메인은 `.test`를 hosts에 등록한다. 로컬 완료 후 고객 서버 VM(실제 Nginx·OpenSSH·FTPS)에서 다시 검증한다.

## 2. 페이지와 연동

### 결정 8. 템플릿과 콘텐츠 입력
- **결정 (사용자):** 고정 템플릿 1종에 입력 필드(사이트명, 소개, 연락처, 로고 이미지)를 받는다. 서버가 HTML 이스케이프 후 정적 `index.html`·css를 만들고, 미리보기 → 배포 순서로 진행한다.
- **이유:** 완료 기준을 가장 작게 만족하고 XSS 경로가 적다.

### 결정 9. j-talk 위젯 연동
- **결정:**
  - **스니펫 (사용자):** 템플릿에 j-talk 가입 여부와 관계없이 항상 스니펫 한 줄을 넣는다(S7).

    ```html
    <script src="https://gw.<tenant>.jgw.test/ext/talk/v1/widget.min.js" async></script>
    ```

    j-talk이 없으면 gateway가 빈 스크립트를 주고, 있으면 항상 최신 위젯이 뜬다. 그래서 가입·해지 때 사이트를 다시 배포하지 않는다.
  - 정적 사이트라 손님 구분자 서명은 쓰지 않는다(익명 방문자).
  - **허용 출처:** 배포 성공 응답에 사이트 출처(`https://<도메인>`)를 담는다. j-groupware가 사용자 Bearer로 j-talk 허용 출처 API에 등록한다. `talk:write`가 없거나 j-talk 미가입이면 안내만 보여 준다(j-groupware 결정 14).
- **이유:** 서비스 호출을 j-groupware → 서비스 한 방향으로 유지한다(architecture.md S7).

## 3. 인증과 권한

### 결정 10. 기능 권한
- **결정:** role client `j-web`에 두 role을 둔다(S3 카탈로그).
  - `web:read`: 웹 관리 메뉴, 사이트 목록·상태·DNS 안내
  - `web:write`: 사이트 생성·삭제, 콘텐츠 편집·배포, 계정 비밀번호 재설정. `web:read`를 포함한다.
  - j-groupware가 전달한 Bearer를 검증한다(aud `j-web`, S4).

### 결정 11. 사이트 HTTPS
- **결정 (사용자):** 테스트 도메인은 로컬 CA 인증서로 HTTPS를 연다. Let's Encrypt 등 실제 인증서 발급은 공개 DNS와 인터넷 노출이 필요하므로 backlog다.

## 4. 데이터·검증·배포

### 결정 12. 저장소·DB·테스트·배포
- **결정:**
  - S11 골격(`apps/server`, `packages/contracts`)을 쓰고, contracts는 레지스트리에 게시한다(S10).
  - 고객 서버 PostgreSQL에 database `jgw_web`과 전용 계정을 둔다(S2). 모든 테이블에 `tenant_id`를 둔다(S8).
  - Vitest로 실제 j-auth·Keycloak·PostgreSQL·로컬 테스트 호스팅을 대상으로 검증한다. web 권한 회원은 j-auth 회원 관리 API로 만들고 지운다(S12). 웹 관리 화면 e2e는 j-groupware G20에서 한다.

### 결정 13. 호스팅 셋팅 권한 경로
- **결정 (AI 위임, 후보 A 채택):**
  - j-web API 서버는 비root 사용자 `jweb`로 실행한다.
  - 특권 작업은 root 소유 전용 helper `/usr/local/sbin/jweb-helper` 하나로만 한다. sudoers는 `jweb`에게 이 파일 하나만 `NOPASSWD`로 허용한다.
  - **helper 하위 명령(고정):**
    - `site-create`, `site-delete`
    - `account-create`(비밀번호는 stdin), `account-passwd`, `account-delete`
    - `nginx-apply`
    - `remove-all`: 해지용(S14)
  - **입력 재검증:**
    - `siteId`는 UUID다.
    - 도메인은 소문자 RFC 1123 형식이고, 설정한 허용 접미사(실습은 `.test`)로 끝나야 한다.
    - 계정 이름은 `^jw-[a-z0-9]{4,24}$`다.
    - 경로는 입력에서 받지 않고 고정 루트 `/srv/jweb/sites/<siteId>`에서 계산한다.
  - **Nginx 설정:** helper가 고정 템플릿에 검증된 `siteId`·도메인만 넣어 직접 렌더링한다. j-web이 만든 설정 파일을 받지 않는다. `nginx -t`가 실패하면 직전 파일로 되돌리고 오류를 낸다.
  - **실행 방식:** 셸을 거치지 않고 인자 배열로 실행한다. 환경 변수는 비우고, 로그에는 비밀번호를 남기지 않는다.
  - **사이트 계정:**
    - 시스템 사용자(셸 `nologin`, 그룹 `jweb-sftp`)다.
    - chroot 디렉터리는 root 소유이고, 웹 루트 `public/`만 계정이 쓸 수 있다.
    - FTPS가 같은 계정을 쓰게 할지(local users)는 H5 조사에서 정하고 helper가 감춘다.
  - **해지 (S14):** `remove-all`이 순서대로 정리한다: 모든 사이트 블록 삭제 → `nginx -t`·reload → SFTP/FTPS 계정 삭제 → 사이트 디렉터리를 백업 폴더로 이동. `provision-service --remove j-web`이 호출한다.
- **이유:**
  - OpenSSH chroot SFTP에는 시스템 계정이 필요해 C안(가상 사용자)의 이점이 적다.
  - B안(작업 큐)은 비동기 상태 관리가 늘어난다.
  - A안은 특권 경로가 파일 하나이고, 입력을 helper가 다시 검증해 명령 삽입·경로 조작을 막는다.

## 5. 작업 구성

PMT 통합 project 분류 `j-web`. Work "j-web 최소 구현"의 완료 기준은 0장과 같다.

| Item | 완료 기준 요약 | 선행 |
| --- | --- | --- |
| H1 저장소 골격 | S11 골격, `jgw_web`·전용 계정·마이그레이션, 로컬 HTTPS·포트, Git 제외 env | j-auth I4, X1 |
| H2 contracts | 사이트·콘텐츠·배포·계정 API schema·DTO, 사이트 상태 모델, 도메인 검증 규칙, DNS 안내 응답, 비밀번호 1회 표시 형식, 오류 코드, 레지스트리 게시 | H1 |
| H4 인증·권한 게이트 | `@j-auth/contracts` 설치, 결정 10 검증, 허용 tenant, `web:*`·기본 거부, 401·403·404·503 | H2, j-auth I2·I4 |
| H5 로컬 테스트 호스팅 | 버전 고정 Compose SFTP·FTPS·Nginx, 공유 볼륨 서빙, 로컬 CA HTTPS·FTPS TLS·평문 FTP 거부, hosts, FTPS 서버 조사 메모 | H1 |
| H6 호스팅 셋팅 엔진 | 사이트 테이블(tenant_id, 도메인 unique), 도메인 검증·중복 409, 결정 13 helper(하위 명령·재검증·Nginx 렌더링·`nginx -t`·복구·`remove-all`), 사이트용 sshd 분리 설정, 해시만 저장·원문 1회, DNS 안내, 삭제 시 백업 | H4, H5 |
| H7 템플릿·배포 | 입력 필드·HTML 이스케이프, 로고 검증, 미리보기, 원자적 교체·직전 버전 보관, 항상 위젯 스니펫, 응답에 사이트 출처 | H6 |
| H8 완료 기준 테스트 | 실제 의존성 Vitest: 생성 → 배포 → 도메인 HTTPS, SFTP·FTPS 업로드·평문 FTP 거부, 사이트·tenant 격리, 401·403, 도메인 409, helper 입력 거절(잘못된 도메인·경로), `remove-all` 후 블록·계정 없음, 로그·DB 비밀번호 원문 없음, 503 | H6, H7, j-auth I6 |
| H9 고객 서버 검증 | `provision-service`로 설치·해지, 실제 Nginx·OpenSSH(분리 인스턴스)·FTPS, j-groupware 웹 관리 화면 → 사이트 열림, 위젯·허용 출처, VM 대상 H8 | H8, j-groupware G10·G18·G20, j-talk T7 |
| H3 | 완료: 변경 요청은 모두 반영됨(j-auth 결정 13·16, j-groupware 결정 8·14, architecture.md) | - |

backlog: 실제 인증서 발급(ACME), 사이트별 디스크 용량 제한, 다중 템플릿·다중 페이지, 접속 로그·통계, 사이트 백업·복구 화면, SFTP SSH 키 인증, OIDC 전환.
