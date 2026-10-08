# 격리 호스팅 시험과 고정 helper 계약

`jweb-helper.mjs`의 설치 위치는 `/usr/local/sbin/jweb-helper`로 고정된다. root 소유·그룹/기타 쓰기 불가 파일만 실행하며 `jweb.sudoers`는 해당 파일만 허용한다. 운영 설치는 이 시험 Compose로 하지 않는다.

helper는 하위 명령 1개와 최대 8KB JSON stdin을 받는다. `site-create`는 `{siteId,domain}`, `site-delete`·`nginx-apply`는 `{siteId}`, `account-create`·`account-passwd`는 `{siteId,account,password}`, `account-delete`는 `{siteId,account}`, `remove-all`은 `{}`다. 추가 필드·임의 경로·설정·명령·환경 전달은 불가하다. 비밀번호는 `chpasswd` stdin에만 전달하고 manifest에는 남기지 않는다.

고정 경로는 `/srv/jweb/sites/<UUID>/public`, `/var/lib/jweb/<UUID>.json`, `/etc/nginx/jweb.d/<UUID>.conf`, `/etc/jweb/tls/`다. root 소유 `/etc/jweb/helper.json`의 `{tenant,domainSuffix}`가 허용 범위를 결정한다. 계정은 `jw-` 접두사, root 소유 chroot와 nologin shell, `jweb-sftp` 그룹을 사용한다. FTPS 허용 목록도 관리 계정에서만 생성한다. CA 개인 키와 모든 비밀 파일은 설치자가 root 전용으로 공급해야 한다.

Nginx는 실제 검사와 reload 후 active로 기록한다. 실패하면 직전 사이트 설정을 복구하고 복구 reload 성공 여부를 보고한다. 제거는 Nginx 구성 제거·검사·reload 뒤 계정 제거와 사이트 파일 백업 이동을 한다. 백업 의도를 먼저 기록하므로 이동 뒤 재시도도 같은 백업으로 완료한다. 백업·DB를 영구 삭제하는 명령은 없다. 동시 helper는 root 전용 디렉터리 잠금으로 거절하며 강제 종료 뒤 남은 잠금은 관리자가 실행 중 프로세스와 단계를 확인하고 복구해야 한다.

## 실제 시험 구성

고정 Node 22.18.0 Debian bookworm image digest와 Debian 보안 업데이트 버전을 `Dockerfile.test`에 명시한다. 실제 Nginx 1.22.1, OpenSSH 9.2p1, vsftpd 3.0.3, sudo를 같은 OS 계정·파일시스템에서 사용한다. 기존 gateway 시험의 Nginx 1.30.5와 버전을 구분한다. 공식 근거: [OpenSSH chroot](https://man.openbsd.org/sshd_config#ChrootDirectory), [vsftpd TLS·local users](https://security.appspot.com/vsftpd/vsftpd_conf.html), [Nginx symlink 제한](https://nginx.org/en/docs/http/ngx_http_core_module.html#disable_symlinks).

시험 Compose는 host 포트를 열지 않는다. SFTP 2222, 명시 TLS FTPS 21·passive 56110–56119, HTTPS 443에 컨테이너 내부에서 실제 접속한다. Python FTPS 시험 클라이언트는 TLS data 연결의 세션을 재사용하므로 서버의 `require_ssl_reuse=YES`를 완화하지 않는다. SFTP는 실제 host key를 고정하며 시험 비밀번호는 sshpass 파일 디스크립터 stdin에 보낸다.

이 클라우드는 Docker named volume과 root가 같은 overlay 장치를 사용한다. 시험만 SYS_ADMIN와 loop device cgroup 권한을 제한적으로 추가하고, **컨테이너 자신의 64MiB 파일만** ext4로 포맷·마운트한다. host 디렉터리나 실제 디스크를 전달하지 않으며 정상 종료 시 unmount한다. 운영 helper의 disk 검사를 우회하지 않는다. 이 검증은 고객 VM의 별도 20GB 디스크·실제 방화벽·systemd·CA 운영 신뢰 설치 인수를 뜻하지 않는다.

```sh
npm run build
JWEB_TEST_TENANT=owned-test-tenant docker compose -f deploy/hosting/compose.test.yaml build
npm run test:hosting
npm run test:integration
```

Docker proxy/buildx 설정이 필요한 클라우드는 저장소 밖의 private `DOCKER_CONFIG`를 사용한다. TLS 키·테스트 env·비밀번호·빌드 proxy는 저장소에 넣지 않는다. Compose build context에서 `.npmrc`, env, 키, Git과 의존성 디렉터리를 제외한다.
