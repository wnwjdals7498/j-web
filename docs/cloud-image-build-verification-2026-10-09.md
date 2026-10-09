# 최종 소스 Web 이미지 빌드와 검증 (Task26)

클라우드에서 Web 시험 이미지를 최종 소스 `237bfeb1833f4dc7b27e578dfc01ff8d649bd300`로 재생성했다. 이미지 ID는 `sha256:cd6c616e3ced2d3e475f01cf0a57c8efb7a9ec06e74ed57d308e7659a2c655f1`, 태그는 `jweb-isolated-hosting:task26-75402e1`이다. 생성 당시 코드 커밋 `75402e1f7a3133acef97b3db8c0c86e3dc05eb36`과 이후 시험 보강 커밋에서 동일 이미지 ID를 확인했다. Git 소스는 깨끗했고 설치 입력 44개 해시를 기록했다.

## 빌드 공간과 보존

원래 실패 build record `61rhprtbmfu2i4k17r5uvk9ml`은 2026-10-09 06:53:46 UTC에 시작했고 VFS의 `COPY vsftpd.conf` snapshot 준비 중 ResourceExhausted/ENOSPC로 실패했다. Dockerfile의 7개 COPY와 권한 RUN을 읽기 전용 BuildKit 입력을 사용하는 설치 RUN 하나로 합쳤다. 고정 Node/OS 패키지 단계의 cache는 재사용했고 현재 파일 설치 단계는 새로 실행했다. 실행 container에는 runtime mount가 없다. 실제 설치 파일 42개의 SHA-256·root 소유권·helper/sudoers/config 모드가 소스와 일치한다. 이미지의 Node는 고정 22.18.0이며 시험 driver는 22.18.0/24.19.0이다.

첫 새 이미지와 최종 이미지 각각의 추가 사용량은 약 294MiB였다. 기존 이미지 `sha256:f56fc0347a04254317c97886ad21a3986182f48e1e53c4c1c082381b6217e93e`와 첫 새 이미지 `sha256:c093d116598711384f59ab2399b1b1e6d21f536b92d691fa13240987601d8343`도 유지했다.

추가 customer-auth 진단은 시작에 성공한 뒤 gateway 처리에서 디스크 0바이트와 ENOSPC를 재현했다. pub/analyzer/Node cache 24,342개 파일·429,668,209바이트를 SHA-256·모드·소유권·mtime 검증 뒤 `/tmp/task26-cache-preserved-xr4eav8_`로 보존 이동하고 원래 경로를 symlink로 유지했다. 읽기 전용 하위층이라 이 이동의 루트 공간 회수는 0이었다. 이를 공간 확보 성공으로 집계하지 않았다.

원래 실패 빌드의 로그·JSON·Docker Desktop build bundle을 보존한 뒤 그 빌드의 미공유·불변·회수 가능 COPY cache 3개만 full ID로 지정해 회수했다:

- `p8ejhn1t5lijsuaj7h1pb5stm` — sshd_config COPY
- `uh7iqtohjx2x87w5wia3f4vy1` — sudoers COPY
- `0kzi71r5av7uhn4en2mc763z3` — helper COPY

여유 공간은 1,211,518,976 → 2,134,974,464바이트로 늘었다. 광범위 prune·이미지/컨테이너/볼륨/소스/사용자 자료 삭제는 하지 않았다. 각 선택의 du 메타데이터·명령·결과와 보존 manifest는 외부 증거 디렉터리에 있다.

## 실행한 검증

| 검사 | Node 22.18.0 | Node 24.19.0 |
| --- | --- | --- |
| build/typecheck/lint/format, unit/helper | 7 + 1 통과 | 7 + 1 통과 |
| 새 이미지 설치 bytes·소유권·mount·HTTPS 음성 검사 | 통과 | 통과 |
| 실제 root hosting/SFTP/FTPS/HTTPS/중단 journal | 5 통과 | 5 통과 |
| 실제 Web PostgreSQL·OIDC·HTTPS | 15 통과 | 15 통과 |
| 실제 Groupware Web BFF·배포 후 Origin 권한 | 6 통과 | 6 통과 |
| 별도 customer-auth 자원 진단 | 19 통과 | 19 통과 |

최종 실행은 모두 exit 0·실패/skip 0이다. 새 이미지 검증에서는 `compose.task25.yaml`과 helper runtime mount를 사용하지 않았다. 별도 customer-auth 시험은 Web 이미지 인수 횟수로 합산하지 않는다. 0.5초 간격의 customer-auth 디스크 최소 여유는 Node22 484,392,960바이트, Node24 472,842,240바이트였다.

기존 전용 이미지의 protocols.py에는 Task25에서 추가한 contains/notContains 검사가 없었다. 이전 pass 수는 해당 HTTP 내용 검사 실행을 증명하지 못한다. 새 이미지가 명세상 공개 연락처를 숨겨야 한다는 잘못된 시험 기대값을 잡았다. 공개 연락처 게시·입력 script escape·실제 토큰/비밀번호 미노출로 시험을 바로잡았다. 오래된 이미지가 두 내용 검사를 조용히 무시하면 실패하도록 음성 assertion도 추가했다. 페이지 목록 시험의 무작위 UUID 첫 행 가정은 실제 after 페이지 순회·정확한 생성 site ID 전체 비교로 보강했다. 잘못된 probe query를 포함한 중간 실패는 모두 별도 보존했다.

과거 두 번째 customer-auth child 시작 실패는 sanitized 메시지만 있어 상세 원인이 미확정이다. 이번 gateway ENOSPC는 시작 이후의 다른 단계이므로 같은 원인으로 단정하지 않는다. cache 회수 뒤 양쪽 driver에서 19개가 실제 실행·통과했다. 과거 실패/skip·이번 실패·사라진 결과를 통과로 계산하지 않았다.

## 증거와 범위

실행 기록은 `/workspace/.suite-runtime/j-groupware/task26-*`의 log/exit·image build metadata·file hash·resource JSON이다. 공개 검증 목록과 해시는 [Groupware 증거 JSON](../../j-groupware/docs/cloud-task26-web-image-results.json)에 있다. source 변경은 Dockerfile.test, hosting.test.mjs의 음성 assertion, hosting.integration.test.ts의 공개 연락처/secret/페이지 검사다.

이 작업의 전체 196개 BFF 재실행은 하지 않았다. 앞선 Task25 전체 실행과 이번 영향 범위 검증을 구분한다. 신규 기능·실제 VM 인수·회사 노트북 설치·운영 배포·CA trust·방화벽·영구 credential·PR/병합은 수행하지 않았다. 소스 진척 130/34/8과 whole_suite_verified=false를 유지한다.
