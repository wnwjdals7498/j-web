# j-web

고객 VM에서 도메인별 웹 호스팅(Nginx 사이트 블록·SFTP/FTPS 계정)을 셋팅하고 템플릿 페이지를 생성·배포하는 선택 서비스. 화면은 j-groupware "웹 관리" 메뉴. DNS는 별도 관리.

현재 상태: 계획 단계(설계 결정·PMT Item 등록 완료, 구현 전). 결정은 `docs/decisions.md`.

Part of the j-groupware suite. See `j-groupware/docs/architecture.md`.

전용 DB·회원 조회 권한과 데이터 디스크 검사를 구현했습니다. `npm run check`, 준비된 cloud fixture의 `npm run test:integration`으로 검사합니다. [구현·검증과 남은 범위](docs/cloud-foundation-verification-2026-10-08.md). 실제 호스팅 셋팅·특권 helper·파일 전송·배포는 미완료입니다.
