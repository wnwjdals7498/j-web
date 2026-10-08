# 클라우드 실제 웹 호스팅 구현·검증

2026-10-08. 작업 브랜치 `codex/cloud-auth-foundation-20261008`. 고객 VM 설치·배포와 별개인 격리 검증이다.

- root helper 고정 7개 명령, 경로·UUID·도메인·계정 재검증, stdin 암호, sudoers 1개 파일·환경 제한, root 잠금, 실제 Nginx 검사/reload 복구, 계정 제거와 재시도 가능한 파일 백업.
- 실제 j-auth Code+PKCE·j-web aud token exchange·회원 read/write 권한에 기반한 생성·동일 id 재시도·비밀번호 재설정·삭제 API. DB는 의도/단계/안전한 오류를 먼저 기록하며 암호 원문은 저장하지 않는다. 다른 tenant·권한 없는 변경은 거절한다.
- 별도 ext4 파일시스템과 실제 `du`·statfs, 실제 OS 계정을 공유하는 OpenSSH internal-sftp 2222, vsftpd 명시 TLS FTPS 21/passive 56110–56119, 사이트 Nginx HTTPS. 평문 FTP·shell·forwarding·다른 사이트 접근 및 심볼릭 링크 서빙을 거절한다.
- root `npm run check`: build/typecheck/단위 검사 2개+helper 보안 검사 1개/lint/format 통과.
- 실제 j-auth·PG·helper 웹 통합 **11/11**, Node 22.18.0와 24.19.0에서 각각 exit 0·skip 0.
- 실제 SFTP/FTPS/HTTPS·helper 호스팅 **4/4**, Node 22.18.0와 24.19.0에서 각각 exit 0·skip 0. daemon은 고정 Node 22/Debian 보안 버전을 사용하며 runner 버전과 구분한다.

비밀값 없는 증거: 테스트 소스와 실행 결과. private 원시 보고서는 저장소 밖 `/workspace/.suite-runtime/j-web/hosting-*`에 있다. 초기 Docker 설정 쓰기/DNS 실패, overlay 마운트 거절, 파일 읽기 모드/FTPS secure chroot fixture 실패를 통과로 세지 않았다. 수정 후 전체 재실행으로 확인했다.

64MiB 컨테이너 전용 ext4 시험은 실제 고객 서버의 별도 20GB 디스크·방화벽·systemd·CA 신뢰 설치·화면/BFF 인수가 아니다. 운영 설치, 영구 credential 발급, 외부 DNS 수정/송신과 배포는 실행하지 않았다. 콘텐츠/로고/수동 업로드와 템플릿 배포 교체 정책, 위젯 및 서비스 installer 연결은 별도 작업이다. local contracts 0.1.0은 외부 registry 미게시다.
